"""Tests for FQN parsing, analysis service, and lineage API routes."""
from __future__ import annotations

import pandas as pd
import pytest

from services.analysis_svc import (
    build_asset_tree,
    compute_summary,
    get_edge_page,
    get_flow_pairs,
    parse_fqn,
)
from tests.conftest import EDGES_ROWS, PROCESSES_ROWS


# ---------------------------------------------------------------------------
# parse_fqn
# ---------------------------------------------------------------------------

def test_parse_fqn_column():
    r = parse_fqn("/sys/db/schema/table/col")
    assert r["type"] == "column"
    assert r["system"] == "sys"
    assert r["database"] == "db"
    assert r["schema"] == "schema"
    assert r["table"] == "table"
    assert r["column"] == "col"


def test_parse_fqn_table():
    r = parse_fqn("/sys/db/schema/table")
    assert r["type"] == "table"
    assert r["table"] == "table"
    assert "column" not in r


def test_parse_fqn_dataprocess():
    r = parse_fqn("/sys/dataprocess/abc123")
    assert r["type"] == "dataprocess"
    assert r["process_id"] == "abc123"


def test_parse_fqn_unresolved():
    assert parse_fqn("UNRESOLVED")["type"] == "unresolved"
    assert parse_fqn("")["type"] == "unresolved"
    assert parse_fqn("not_an_fqn")["type"] == "unresolved"


def test_parse_fqn_no_leading_slash():
    r = parse_fqn("db/schema/table/col")
    assert r["type"] == "unresolved"


def test_parse_fqn_preserves_raw():
    raw = "/sys/db/s/t/c"
    assert parse_fqn(raw)["raw"] == raw


# ---------------------------------------------------------------------------
# compute_summary
# ---------------------------------------------------------------------------

def test_compute_summary_counts():
    edges_df = pd.DataFrame(EDGES_ROWS)
    processes_df = pd.DataFrame(PROCESSES_ROWS)
    s = compute_summary(edges_df, processes_df)
    assert s["total_edges"] == 3
    assert s["total_processes"] == 2
    assert s["unique_databases"] == 2  # db1, db2
    assert s["unique_tables"] >= 2
    assert s["unique_columns"] >= 3


def test_compute_summary_confidence_dist():
    edges_df = pd.DataFrame(EDGES_ROWS)
    s = compute_summary(edges_df, pd.DataFrame(PROCESSES_ROWS))
    assert "HIGH" in s["confidence_distribution"]
    assert s["confidence_distribution"]["HIGH"] >= 2


def test_compute_summary_query_type():
    s = compute_summary(pd.DataFrame(EDGES_ROWS), pd.DataFrame(PROCESSES_ROWS))
    assert s["query_type_distribution"].get("INSERT", 0) == 2


# ---------------------------------------------------------------------------
# build_asset_tree
# ---------------------------------------------------------------------------

def test_build_asset_tree_structure():
    edges_df = pd.DataFrame(EDGES_ROWS)
    tree = build_asset_tree(edges_df)
    assert len(tree) >= 1
    db_names = [d["database"] for d in tree]
    assert "db1" in db_names


def test_build_asset_tree_table_columns():
    edges_df = pd.DataFrame(EDGES_ROWS)
    tree = build_asset_tree(edges_df)
    for db in tree:
        for schema in db["schemas"]:
            for table in schema["tables"]:
                assert "columns" in table
                assert isinstance(table["as_source"], int)
                assert isinstance(table["as_target"], int)
                assert isinstance(table["source_process_count"], int)
                assert isinstance(table["target_process_count"], int)


def test_build_asset_tree_process_counts():
    edges_df = pd.DataFrame(EDGES_ROWS)
    tree = build_asset_tree(edges_df)
    tables = {t["table"]: t for db in tree for schema in db["schemas"] for t in schema["tables"]}

    # table_b is written to by two distinct processes (abc, def) across e1 and e3
    assert tables["table_b"]["target_process_count"] == 2
    # table_a is only ever read by process "abc", even though it appears in two edges
    assert tables["table_a"]["as_source"] == 2
    assert tables["table_a"]["source_process_count"] == 1


# ---------------------------------------------------------------------------
# get_edge_page
# ---------------------------------------------------------------------------

def test_edge_page_no_filter():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df)
    assert result["total"] == 3


def test_edge_page_confidence_filter():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df, confidence="HIGH")
    assert result["total"] == 2


def test_edge_page_direction_filter():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df, direction="writes_to")
    assert result["total"] == 2


def test_edge_page_target_type_filter():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df, target_type="dataprocess")
    assert result["total"] == 1


def test_edge_page_source_type_filter():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df, source_type="column")
    assert result["total"] == 3


def test_edge_page_type_options():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df)
    assert result["source_type_options"] == ["column"]
    assert result["target_type_options"] == ["column", "dataprocess"]


def test_edge_page_source_search():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df, source_search="table_a")
    assert result["total"] == 2


def test_edge_page_target_search():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df, target_search="table_b")
    assert result["total"] == 2


def test_edge_page_search_is_case_insensitive():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df, source_search="TABLE_A")
    assert result["total"] == 2


def test_edge_page_sort_source_fqn_asc():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df, sort_by="source_fqn", sort_dir="asc")
    fqns = [r["source_fqn"] for r in result["rows"]]
    assert fqns == sorted(fqns)


def test_edge_page_sort_source_fqn_desc():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df, sort_by="source_fqn", sort_dir="desc")
    fqns = [r["source_fqn"] for r in result["rows"]]
    assert fqns == sorted(fqns, reverse=True)


def test_edge_page_pagination():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df, page=1, page_size=2)
    assert len(result["rows"]) == 2
    assert result["total_pages"] == 2


def test_edge_page_options_returned():
    df = pd.DataFrame(EDGES_ROWS)
    result = get_edge_page(df)
    assert "confidence_options" in result
    assert "HIGH" in result["confidence_options"]


# ---------------------------------------------------------------------------
# get_flow_pairs
# ---------------------------------------------------------------------------

def test_flow_pairs_writes_to_only():
    df = pd.DataFrame(EDGES_ROWS)
    pairs = get_flow_pairs(df)
    for p in pairs:
        assert p["source_table"] != p["target_table"]


def test_flow_pairs_count():
    df = pd.DataFrame(EDGES_ROWS)
    pairs = get_flow_pairs(df)
    assert len(pairs) >= 1
    assert pairs[0]["edge_count"] >= 1


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

def test_lineage_summary_api(client, lineage_folder):
    resp = client.get(f"/api/lineage/summary?folder={lineage_folder}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_edges"] == 3
    assert data["total_processes"] == 2


def test_lineage_assets_api(client, lineage_folder):
    resp = client.get(f"/api/lineage/assets?folder={lineage_folder}")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
    assert len(resp.json()) >= 1


def test_lineage_edges_api(client, lineage_folder):
    resp = client.get(f"/api/lineage/edges?folder={lineage_folder}")
    assert resp.status_code == 200
    assert resp.json()["total"] == 3


def test_lineage_processes_api(client, lineage_folder):
    resp = client.get(f"/api/lineage/processes?folder={lineage_folder}")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_lineage_flow_api(client, lineage_folder):
    resp = client.get(f"/api/lineage/flow?folder={lineage_folder}")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_lineage_no_bundle(client, tmp_path):
    resp = client.get(f"/api/lineage/summary?folder={tmp_path}")
    assert resp.status_code == 404
