"""Tests for FQN parsing, analysis service, and lineage API routes."""
from __future__ import annotations

import pandas as pd
import pytest

from services.analysis_svc import (
    build_asset_tree,
    compute_summary,
    get_edge_page,
    get_flow_pairs,
    get_lineage_graph,
    get_mapping_graph,
    parse_fqn,
)
from tests.conftest import EDGES_ROWS, PROCESSES_ROWS


# ---------------------------------------------------------------------------
# parse_fqn
# ---------------------------------------------------------------------------

def test_parse_fqn_column():
    r = parse_fqn("/sys/platform/db/schema/table/col")
    assert r["type"] == "column"
    assert r["system"] == "sys"
    assert r["platform"] == "platform"
    assert r["database"] == "db"
    assert r["schema"] == "schema"
    assert r["table"] == "table"
    assert r["column"] == "col"


def test_parse_fqn_table():
    r = parse_fqn("/sys/platform/db/schema/table")
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
    raw = "/sys/platform/db/s/t/c"
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


def test_flow_pairs_process_mediated_schema():
    # Some pipelines split direct column->column flow into a "read_by"
    # column->process edge plus a "writes_to" process->column edge (no
    # direct column-to-column edge at all) instead of encoding "writes_to"
    # as a direct copy. get_flow_pairs must still surface table->table flow
    # by joining on process_fqn, not by assuming edge=="writes_to" rows are
    # already table-to-table.
    rows = [
        {
            "edge": "read_by",
            "source_fqn": "/sys1/platform1/db1/schema1/stg_table/col1",
            "source_type": "column",
            "target_fqn": "/sys1/dataprocess/proc1",
            "target_type": "dataprocess",
            "process_fqn": "/sys1/dataprocess/proc1",
        },
        {
            "edge": "writes_to",
            "source_fqn": "/sys1/dataprocess/proc1",
            "source_type": "dataprocess",
            "target_fqn": "/sys1/platform1/db1/schema1/final_table/col2",
            "target_type": "column",
            "process_fqn": "/sys1/dataprocess/proc1",
        },
    ]
    df = pd.DataFrame(rows)
    pairs = get_flow_pairs(df)
    assert len(pairs) == 1
    assert pairs[0]["source_table"] == "db1.schema1.stg_table"
    assert pairs[0]["target_table"] == "db1.schema1.final_table"
    assert pairs[0]["process_count"] == 1


# ---------------------------------------------------------------------------
# get_lineage_graph
# ---------------------------------------------------------------------------

def test_lineage_graph_structure():
    edges_df = pd.DataFrame(EDGES_ROWS)
    processes_df = pd.DataFrame(PROCESSES_ROWS)
    graph = get_lineage_graph(edges_df, processes_df)

    # Node ids are opaque ("n0", "n1", ...) — assert on the real identifiers
    # (full_name / process_fqn) and every id is unique and unsafe-char-free.
    node_ids = [n["id"] for n in graph["nodes"]]
    assert len(node_ids) == len(set(node_ids))
    assert all(all(c.isalnum() or c == "_" for c in nid) for nid in node_ids)

    def id_for(**match):
        return next(n["id"] for n in graph["nodes"] if all(n.get(k) == v for k, v in match.items()))

    table_a = id_for(type="table", full_name="db1.schema1.table_a")
    table_b = id_for(type="table", full_name="db1.schema1.table_b")
    table_c = id_for(type="table", full_name="db2.schema2.table_c")
    proc_abc = id_for(type="process", process_fqn="/sys1/dataprocess/abc")
    proc_def = id_for(type="process", process_fqn="/sys1/dataprocess/def")

    edge_tuples = {(e["source"], e["target"], e["kind"]) for e in graph["edges"]}
    assert (table_a, proc_abc, "input") in edge_tuples
    assert (proc_abc, table_b, "output") in edge_tuples
    assert (table_c, proc_def, "input") in edge_tuples
    assert (proc_def, table_b, "output") in edge_tuples
    # e1 and e2 both put table_a -> abc, deduped into a single edge
    assert len(graph["edges"]) == 4


def test_lineage_graph_process_node_uses_process_name():
    edges_df = pd.DataFrame(EDGES_ROWS)
    processes_df = pd.DataFrame(PROCESSES_ROWS)
    graph = get_lineage_graph(edges_df, processes_df)
    proc_node = next(n for n in graph["nodes"] if n.get("process_fqn") == "/sys1/dataprocess/abc")
    assert proc_node["label"] == "INSERT into db1.schema1.table_b"
    assert proc_node["query_type"] == "INSERT"
    assert proc_node["process_code"] == "INSERT INTO table_b SELECT col1 FROM table_a"


def test_lineage_graph_without_processes_df_falls_back_to_short_id():
    edges_df = pd.DataFrame(EDGES_ROWS)
    graph = get_lineage_graph(edges_df, None)
    proc_node = next(n for n in graph["nodes"] if n.get("process_fqn") == "/sys1/dataprocess/abc")
    assert proc_node["label"] == "abc"


VIEW_ROWS = [
    # p1 reads base_table and writes my_view (target tagged "view")
    {
        "edge": "read_by",
        "source_fqn": "/sys1/platform1/db1/schema1/base_table/col1",
        "source_type": "column",
        "target_fqn": "/sys1/dataprocess/p1",
        "target_type": "dataprocess",
        "process_fqn": "/sys1/dataprocess/p1",
    },
    {
        "edge": "writes_to",
        "source_fqn": "/sys1/dataprocess/p1",
        "source_type": "dataprocess",
        "target_fqn": "/sys1/platform1/db1/schema1/my_view",
        "target_type": "view",
        "process_fqn": "/sys1/dataprocess/p1",
    },
    # p2 reads my_view (source tagged "view") and writes final_table
    {
        "edge": "read_by",
        "source_fqn": "/sys1/platform1/db1/schema1/my_view",
        "source_type": "view",
        "target_fqn": "/sys1/dataprocess/p2",
        "target_type": "dataprocess",
        "process_fqn": "/sys1/dataprocess/p2",
    },
    {
        "edge": "writes_to",
        "source_fqn": "/sys1/dataprocess/p2",
        "source_type": "dataprocess",
        "target_fqn": "/sys1/platform1/db1/schema1/final_table",
        "target_type": "table",
        "process_fqn": "/sys1/dataprocess/p2",
    },
]


def test_lineage_graph_marks_views():
    # A view's FQN is the same depth as a table's, so only the edges' own
    # source_type/target_type tag tells them apart — from either side of an edge.
    graph = get_lineage_graph(pd.DataFrame(VIEW_ROWS), None)
    is_view = {n["full_name"]: n["is_view"] for n in graph["nodes"] if n["type"] == "table"}
    assert is_view == {
        "db1.schema1.base_table": False,
        "db1.schema1.my_view": True,
        "db1.schema1.final_table": False,
    }


def test_lineage_graph_without_type_columns_has_no_views():
    df = pd.DataFrame(VIEW_ROWS).drop(columns=["source_type", "target_type"])
    graph = get_lineage_graph(df, None)
    tables = [n for n in graph["nodes"] if n["type"] == "table"]
    assert len(tables) == 3
    assert not any(n["is_view"] for n in tables)


# ---------------------------------------------------------------------------
# get_mapping_graph
# ---------------------------------------------------------------------------

def _row(edge, source_fqn, target_fqn, source_type, target_type):
    return {
        "edge": edge,
        "source_fqn": source_fqn,
        "source_type": source_type,
        "target_fqn": target_fqn,
        "target_type": target_type,
        "process_fqn": "/sys1/dataprocess/p1",
    }


T = "/sys1/platform1/db1/schema1"
MAPPING_ROWS = [
    # src_table -> my_view: a table-level row plus two column-level rows (one duplicated)
    _row("maps_to", f"{T}/src_table", f"{T}/my_view", "table", "view"),
    _row("maps_to", f"{T}/src_table/a", f"{T}/my_view/x", "column", "column"),
    _row("maps_to", f"{T}/src_table/b", f"{T}/my_view/y", "column", "column"),
    _row("maps_to", f"{T}/src_table/b", f"{T}/my_view/y", "column", "column"),
    # my_view -> final_table: table-level row only
    _row("maps_to", f"{T}/my_view", f"{T}/final_table", "view", "table"),
    # other_src -> other_dst: column-level rows only (no table-level row)
    _row("maps_to", f"{T}/other_src/c", f"{T}/other_dst/d", "column", "column"),
    # a mapping within one table is not table-to-table lineage
    _row("maps_to", f"{T}/src_table/a", f"{T}/src_table/b", "column", "column"),
    # read/write edges and processes are not part of the data mapping
    _row("read_by", f"{T}/src_table/a", "/sys1/dataprocess/p1", "column", "dataprocess"),
    _row("writes_to", "/sys1/dataprocess/p1", f"{T}/my_view/x", "dataprocess", "column"),
]


def test_mapping_graph_links_tables_through_maps_to_only():
    graph = get_mapping_graph(pd.DataFrame(MAPPING_ROWS))
    name = {n["id"]: n["full_name"] for n in graph["nodes"]}
    links = {(name[e["source"]], name[e["target"]]): e["column_count"] for e in graph["edges"]}
    assert links == {
        ("db1.schema1.src_table", "db1.schema1.my_view"): 2,   # distinct column pairs, duplicate counted once
        ("db1.schema1.my_view", "db1.schema1.final_table"): 0,  # table-level row only
        ("db1.schema1.other_src", "db1.schema1.other_dst"): 1,  # column-level rows only
    }
    assert all(e["kind"] == "mapping" for e in graph["edges"])
    # no process nodes, and the same-table mapping did not create a node or self-loop
    assert all(n["type"] == "table" for n in graph["nodes"])
    assert not any(e["source"] == e["target"] for e in graph["edges"])


def test_mapping_graph_marks_views_and_has_unique_safe_ids():
    graph = get_mapping_graph(pd.DataFrame(MAPPING_ROWS))
    is_view = {n["full_name"]: n["is_view"] for n in graph["nodes"]}
    assert is_view["db1.schema1.my_view"] is True
    assert is_view["db1.schema1.src_table"] is False
    ids = [n["id"] for n in graph["nodes"]]
    assert len(ids) == len(set(ids))
    assert all(all(c.isalnum() or c == "_" for c in i) for i in ids)


def test_mapping_graph_without_maps_to_edges_is_empty():
    rows = [r for r in MAPPING_ROWS if r["edge"] != "maps_to"]
    assert get_mapping_graph(pd.DataFrame(rows)) == {"nodes": [], "edges": []}


def test_mapping_graph_without_edge_column_is_empty():
    df = pd.DataFrame(MAPPING_ROWS).drop(columns=["edge"])
    assert get_mapping_graph(df) == {"nodes": [], "edges": []}


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


def test_lineage_graph_api(client, lineage_folder):
    resp = client.get(f"/api/lineage/graph?folder={lineage_folder}")
    assert resp.status_code == 200
    body = resp.json()
    assert "nodes" in body and "edges" in body
    assert len(body["nodes"]) > 0


def test_lineage_graph_api_defaults_to_all_mode(client, lineage_folder):
    default = client.get(f"/api/lineage/graph?folder={lineage_folder}").json()
    explicit = client.get(f"/api/lineage/graph?folder={lineage_folder}&mode=all").json()
    assert default == explicit
    assert any(n["type"] == "process" for n in default["nodes"])


def test_lineage_graph_api_mapping_mode(client, lineage_folder):
    # The fixture bundle has only read/write edges, so its data-mapping graph is empty —
    # but the mode must be honoured (no process nodes) rather than falling back to "all".
    resp = client.get(f"/api/lineage/graph?folder={lineage_folder}&mode=mapping")
    assert resp.status_code == 200
    body = resp.json()
    assert not any(n["type"] == "process" for n in body["nodes"])
    assert all(e["kind"] == "mapping" for e in body["edges"])


def test_lineage_graph_api_rejects_unknown_mode(client, lineage_folder):
    resp = client.get(f"/api/lineage/graph?folder={lineage_folder}&mode=bogus")
    assert resp.status_code == 422


def test_lineage_no_bundle(client, tmp_path):
    resp = client.get(f"/api/lineage/summary?folder={tmp_path}")
    assert resp.status_code == 404
