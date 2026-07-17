from __future__ import annotations

import math
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

logger = logging.getLogger(__name__)

PAGE_SIZE_DEFAULT = 100
PAGE_SIZE_MAX = 500


def _safe(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, float):
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return None if math.isnan(float(v)) else float(v)
    if isinstance(v, np.bool_):
        return bool(v)
    if isinstance(v, pd.Timestamp):
        return None if pd.isna(v) else v.isoformat()
    if hasattr(v, "item"):
        try:
            return v.item()
        except Exception:
            return str(v)
    if isinstance(v, (list, dict)):
        return v
    return v


def _to_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    records = []
    for row in df.to_dict(orient="records"):
        records.append({k: _safe(v) for k, v in row.items()})
    return records


@lru_cache(maxsize=32)
def _cached_read(path: str, mtime: float) -> pd.DataFrame:
    logger.debug("Parquet cache miss: %s", path)
    return pd.read_parquet(path)


def read_df(path: Path) -> pd.DataFrame:
    return _cached_read(str(path), round(path.stat().st_mtime, 3))


def get_schema(path: Path) -> dict[str, Any]:
    schema = pq.read_schema(str(path))
    meta = pq.read_metadata(str(path))
    return {
        "columns": [{"name": n, "dtype": str(schema.field(n).type)} for n in schema.names],
        "row_count": meta.num_rows,
        "file_size": path.stat().st_size,
    }


def get_page(path: Path, page: int = 1, page_size: int = PAGE_SIZE_DEFAULT) -> dict[str, Any]:
    page_size = min(max(1, page_size), PAGE_SIZE_MAX)
    df = read_df(path)
    total = len(df)
    total_pages = max(1, math.ceil(total / page_size))
    page = max(1, min(page, total_pages))

    start = (page - 1) * page_size
    slice_df = df.iloc[start : start + page_size].copy()

    # Stringify object columns that hold lists/dicts (not JSON-serialisable inline)
    for col in slice_df.select_dtypes(include="object").columns:
        slice_df[col] = slice_df[col].apply(
            lambda x: x
            if x is None or isinstance(x, (str, int, float, bool))
            else str(x)
        )

    return {
        "rows": _to_records(slice_df),
        "columns": list(df.columns),
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


def to_json_array(path: Path) -> list[dict[str, Any]]:
    df = read_df(path).copy()
    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].apply(
            lambda x: x
            if x is None or isinstance(x, (str, int, float, bool))
            else str(x)
        )
    return _to_records(df)
