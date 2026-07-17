from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, Response

from services.filesystem import safe_resolve
from services.parquet_svc import get_page, get_schema, to_json_array

router = APIRouter()
logger = logging.getLogger(__name__)


def _require_parquet(path: str) -> Path:
    try:
        p = safe_resolve(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not p.exists():
        raise HTTPException(404, f"File not found: {path}")
    if p.suffix.lower() != ".parquet":
        raise HTTPException(400, "Not a .parquet file")
    return p


@router.get("/schema")
def parquet_schema(path: str) -> dict:
    p = _require_parquet(path)
    try:
        return get_schema(p)
    except Exception as exc:
        logger.exception("Schema read failed: %s", exc)
        raise HTTPException(500, str(exc))


@router.get("/rows")
def parquet_rows(path: str, page: int = 1, page_size: int = 100) -> dict:
    p = _require_parquet(path)
    try:
        return get_page(p, page=page, page_size=page_size)
    except Exception as exc:
        logger.exception("Row read failed: %s", exc)
        raise HTTPException(500, str(exc))


@router.get("/as-json")
def parquet_as_json(path: str) -> JSONResponse:
    p = _require_parquet(path)
    try:
        data = to_json_array(p)
        return JSONResponse(content=data)
    except Exception as exc:
        logger.exception("JSON conversion failed: %s", exc)
        raise HTTPException(500, str(exc))


@router.get("/download")
def parquet_download(path: str, format: str = "json") -> Response:
    p = _require_parquet(path)
    stem = p.stem

    if format == "parquet":
        content = p.read_bytes()
        return Response(
            content=content,
            media_type="application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{stem}.parquet"'},
        )

    try:
        data = to_json_array(p)
        text = json.dumps(data, indent=2, ensure_ascii=False)
        return Response(
            content=text.encode(),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{stem}.json"'},
        )
    except Exception as exc:
        logger.exception("Download failed: %s", exc)
        raise HTTPException(500, str(exc))
