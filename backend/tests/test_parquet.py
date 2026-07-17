"""Tests for parquet service and router."""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from services.parquet_svc import _safe, get_page, get_schema, to_json_array


def make_parquet(tmp_path: Path, n: int = 10, name: str = "test.parquet") -> Path:
    df = pd.DataFrame({"id": range(n), "val": [f"v{i}" for i in range(n)]})
    p = tmp_path / name
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), p)
    return p


def test_get_schema(tmp_path: Path):
    p = make_parquet(tmp_path, 5)
    s = get_schema(p)
    assert s["row_count"] == 5
    assert any(c["name"] == "id" for c in s["columns"])


def test_get_page_first(tmp_path: Path):
    p = make_parquet(tmp_path, 25)
    result = get_page(p, page=1, page_size=10)
    assert result["total"] == 25
    assert result["total_pages"] == 3
    assert len(result["rows"]) == 10
    assert result["rows"][0]["id"] == 0


def test_get_page_last(tmp_path: Path):
    p = make_parquet(tmp_path, 25)
    result = get_page(p, page=3, page_size=10)
    assert len(result["rows"]) == 5
    assert result["rows"][0]["id"] == 20


def test_get_page_clamps_high(tmp_path: Path):
    p = make_parquet(tmp_path, 5)
    result = get_page(p, page=99, page_size=10)
    assert result["page"] == 1


def test_get_page_clamps_zero(tmp_path: Path):
    p = make_parquet(tmp_path, 5)
    result = get_page(p, page=0, page_size=10)
    assert result["page"] == 1


def test_page_size_max_capped(tmp_path: Path):
    p = make_parquet(tmp_path, 10)
    result = get_page(p, page=1, page_size=9999)
    assert result["page_size"] == 500


def test_nan_sanitised(tmp_path: Path):
    df = pd.DataFrame({"a": [1.0, float("nan"), 3.0]})
    p = tmp_path / "nan.parquet"
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), p)
    result = get_page(p, page=1, page_size=10)
    assert result["rows"][1]["a"] is None


def test_to_json_array(tmp_path: Path):
    p = make_parquet(tmp_path, 3)
    rows = to_json_array(p)
    assert len(rows) == 3
    assert rows[0]["id"] == 0


def test_safe_values():
    assert _safe(None) is None
    assert _safe(float("nan")) is None
    assert _safe(float("inf")) is None
    assert _safe(np.int64(42)) == 42
    assert _safe(np.bool_(True)) is True
    assert _safe("hello") == "hello"


# -- API smoke tests --

def test_parquet_schema_api(client, edges_parquet: Path):
    resp = client.get(f"/api/parquet/schema?path={edges_parquet}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["row_count"] == 3


def test_parquet_rows_api(client, edges_parquet: Path):
    resp = client.get(f"/api/parquet/rows?path={edges_parquet}&page=1&page_size=10")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 3
    assert len(data["rows"]) == 3


def test_parquet_as_json_api(client, edges_parquet: Path):
    resp = client.get(f"/api/parquet/as-json?path={edges_parquet}")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    assert len(resp.json()) == 3


def test_parquet_not_found(client):
    resp = client.get("/api/parquet/schema?path=/nonexistent/edges.parquet")
    assert resp.status_code == 404


def test_parquet_download_json(client, edges_parquet: Path):
    resp = client.get(f"/api/parquet/download?path={edges_parquet}&format=json")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
