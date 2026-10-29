"""Shared fixtures: in-memory parquet files written to tmp_path."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app import app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


# ------------------------------------------------------------------
# Minimal edges DataFrame
# ------------------------------------------------------------------
# FQNs here follow the real pipeline convention: /system/platform/database/
# schema/table[/column] — an explicit platform segment right after the
# system name, one level deeper than a bare /system/database/schema/table.
EDGES_ROWS = [
    {
        "edge_id": "e1",
        "edge": "writes_to",
        "source_fqn": "/sys1/platform1/db1/schema1/table_a/col1",
        "source_type": "column",
        "target_fqn": "/sys1/platform1/db1/schema1/table_b/col2",
        "target_type": "column",
        "process_fqn": "/sys1/dataprocess/abc",
        "transform_type": "DIRECT_COPY",
        "expression": "",
        "confidence": "HIGH",
        "is_temporary_source": False,
        "is_temporary_target": False,
        "resolution_type": "column_resolved",
    },
    {
        "edge_id": "e2",
        "edge": "read_by",
        "source_fqn": "/sys1/platform1/db1/schema1/table_a/col1",
        "source_type": "column",
        "target_fqn": "/sys1/dataprocess/abc",
        "target_type": "dataprocess",
        "process_fqn": "/sys1/dataprocess/abc",
        "transform_type": "DIRECT_COPY",
        "expression": "",
        "confidence": "HIGH",
        "is_temporary_source": False,
        "is_temporary_target": False,
        "resolution_type": "column_resolved",
    },
    {
        "edge_id": "e3",
        "edge": "writes_to",
        "source_fqn": "/sys1/platform1/db2/schema2/table_c/col3",
        "source_type": "column",
        "target_fqn": "/sys1/platform1/db1/schema1/table_b/col4",
        "target_type": "column",
        "process_fqn": "/sys1/dataprocess/def",
        "transform_type": "CONSTANT",
        "expression": "'foo'",
        "confidence": "MEDIUM",
        "is_temporary_source": False,
        "is_temporary_target": False,
        "resolution_type": "column_resolved",
    },
]

PROCESSES_ROWS = [
    {
        "process_fqn": "/sys1/dataprocess/abc",
        "process_name": "INSERT into db1.schema1.table_b",
        "process_type": "sql",
        "process_code": "INSERT INTO table_b SELECT col1 FROM table_a",
        "query_type": "INSERT",
        "last_seen_at": "2026-06-01T00:00:00Z",
    },
    {
        "process_fqn": "/sys1/dataprocess/def",
        "process_name": "INSERT into db1.schema1.table_b (2)",
        "process_type": "sql",
        "process_code": "INSERT INTO table_b SELECT 'foo' FROM table_c",
        "query_type": "INSERT",
        "last_seen_at": "2026-06-02T00:00:00Z",
    },
]


@pytest.fixture()
def lineage_folder(tmp_path: Path) -> Path:
    """Write processes.parquet + edges.parquet to a temp folder."""
    edges_df = pd.DataFrame(EDGES_ROWS)
    processes_df = pd.DataFrame(PROCESSES_ROWS)
    pq.write_table(pa.Table.from_pandas(edges_df, preserve_index=False), tmp_path / "edges.parquet")
    pq.write_table(pa.Table.from_pandas(processes_df, preserve_index=False), tmp_path / "processes.parquet")
    manifest = {
        "systemUrn": "/sys1",
        "payload": {"processes": {"rowCount": 2}, "edges": {"rowCount": 3}},
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    return tmp_path


@pytest.fixture()
def edges_parquet(tmp_path: Path) -> Path:
    df = pd.DataFrame(EDGES_ROWS)
    path = tmp_path / "edges.parquet"
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), path)
    return path


@pytest.fixture()
def processes_parquet(tmp_path: Path) -> Path:
    df = pd.DataFrame(PROCESSES_ROWS)
    path = tmp_path / "processes.parquet"
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), path)
    return path
