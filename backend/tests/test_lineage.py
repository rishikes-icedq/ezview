"""Tests for FQN parsing, analysis service, and lineage API routes."""
from __future__ import annotations

from collections import Counter

import pandas as pd
import pytest

from services.analysis_svc import (
    apply_bi_names,
    build_asset_tree,
    compute_summary,
    get_column_lineage,
    get_edge_page,
    get_flow_pairs,
    get_lineage_graph,
    get_mapping_graph,
    has_bi_assets,
    parse_asset,
    parse_fqn,
)
from services.bi_names_svc import BiNames
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


def test_edge_page_has_every_column_of_the_file_in_its_order_and_every_row_has_them_all():
    df = pd.DataFrame(EDGES_ROWS).assign(process_fqn=None, expression="a + b", is_temporary_source=False, evidence_kind=None)
    result = get_edge_page(df)
    assert result["columns"] == list(df.columns)
    assert all(list(row) == list(df.columns) for row in result["rows"])
    # nothing is left out by a filter that matches nothing either: the columns are the file's, not the page's
    assert get_edge_page(df, confidence="NO-SUCH-LEVEL")["rows"] == [] and get_edge_page(df, confidence="NO-SUCH-LEVEL")["columns"] == list(df.columns)


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
# Views without a data process (and stored procedures)
# ---------------------------------------------------------------------------

V = "/sys1/platform1/db1/schema1"


def _typed_row(edge, source_fqn, target_fqn, source_type, target_type, process_fqn):
    return {
        "edge": edge,
        "source_fqn": source_fqn,
        "source_type": source_type,
        "target_fqn": target_fqn,
        "target_type": target_type,
        "process_fqn": process_fqn,
    }


# The pipeline gives a view no dataprocess: its maps_to rows carry the view's own
# FQN as process_fqn. A real process (p1, a stored-procedure call) still exists
# alongside, tied to its stored procedure by a "contextualizes" edge.
NO_PROCESS_VIEW_ROWS = [
    # v1 <- base_table (a table-level row plus two column-level rows, one duplicated)
    _typed_row("maps_to", f"{V}/base_table", f"{V}/v1", "table", "view", f"{V}/v1"),
    _typed_row("maps_to", f"{V}/base_table/a", f"{V}/v1/x", "column", "column", f"{V}/v1"),
    _typed_row("maps_to", f"{V}/base_table/b", f"{V}/v1/y", "column", "column", f"{V}/v1"),
    _typed_row("maps_to", f"{V}/base_table/b", f"{V}/v1/y", "column", "column", f"{V}/v1"),
    # v2 <- v1 and other_table
    _typed_row("maps_to", f"{V}/v1", f"{V}/v2", "view", "view", f"{V}/v2"),
    _typed_row("maps_to", f"{V}/other_table", f"{V}/v2", "table", "view", f"{V}/v2"),
    # p1 reads v2 and writes final_table
    _typed_row("read_by", f"{V}/v2", "/sys1/platform1/dataprocess/p1", "view", "dataprocess", "/sys1/platform1/dataprocess/p1"),
    _typed_row("writes_to", "/sys1/platform1/dataprocess/p1", f"{V}/final_table", "dataprocess", "table", "/sys1/platform1/dataprocess/p1"),
    # sp_load is a stored procedure whose FQN is table-shaped
    _typed_row("contextualizes", f"{V}/sp_load", "/sys1/platform1/dataprocess/p1", "stored_procedure", "dataprocess", "/sys1/platform1/dataprocess/p1"),
]


def test_lineage_graph_view_without_process_links_sources_directly():
    graph = get_lineage_graph(pd.DataFrame(NO_PROCESS_VIEW_ROWS), None)
    name = {n["id"]: n.get("full_name") or n["process_fqn"] for n in graph["nodes"]}

    # no process node is invented for a view — only the real p1 exists
    assert [n["process_fqn"] for n in graph["nodes"] if n["type"] == "process"] == ["/sys1/platform1/dataprocess/p1"]

    links = {(name[e["source"]], name[e["target"]], e["kind"]) for e in graph["edges"]}
    assert links == {
        ("db1.schema1.base_table", "db1.schema1.v1", "direct"),   # table + column rows collapse to one edge
        ("db1.schema1.v1", "db1.schema1.v2", "direct"),           # a view can feed a view
        ("db1.schema1.other_table", "db1.schema1.v2", "direct"),
        ("db1.schema1.v2", "/sys1/platform1/dataprocess/p1", "input"),   # real processes are untouched
        ("/sys1/platform1/dataprocess/p1", "db1.schema1.final_table", "output"),
    }
    is_view = {n["full_name"]: n["is_view"] for n in graph["nodes"] if n["type"] == "table"}
    assert is_view["db1.schema1.v1"] and is_view["db1.schema1.v2"]
    assert not is_view["db1.schema1.base_table"]


def test_lineage_graph_view_with_real_process_has_no_direct_edges():
    # Older pipelines gave a view a CREATE_VIEW process: that path must be unchanged.
    graph = get_lineage_graph(pd.DataFrame(VIEW_ROWS), None)
    assert {e["kind"] for e in graph["edges"]} == {"input", "output"}
    assert sum(1 for n in graph["nodes"] if n["type"] == "process") == 2


def _sp_graph(rows, processes=None):
    graph = get_lineage_graph(pd.DataFrame(rows), None if processes is None else pd.DataFrame(processes))
    by_id = {n["id"]: n for n in graph["nodes"]}
    sps = {n["label"]: n for n in graph["nodes"] if n["type"] == "stored_procedure"}
    procs = {n["process_fqn"]: n for n in graph["nodes"] if n["type"] == "process"}
    calls = {(by_id[e["source"]]["label"], by_id[e["target"]]["label"]) for e in graph["edges"] if e["kind"] == "calls"}
    return graph, by_id, sps, procs, calls


def _proc(n):
    return f"/sys1/platform1/dataprocess/{n}"


def _io_rows(proc_fqn, src, dst):
    return [
        _typed_row("read_by", f"{V}/{src}", proc_fqn, "table", "dataprocess", proc_fqn),
        _typed_row("writes_to", proc_fqn, f"{V}/{dst}", "dataprocess", "table", proc_fqn),
    ]


def test_stored_procedure_node_contains_the_process_it_contextualizes():
    rows = NO_PROCESS_VIEW_ROWS + [
        # sp_load calls sp_helper: a nested call has no process, and must not disturb the rest
        _typed_row("calls", f"{V}/sp_load", f"{V}/sp_helper", "stored_procedure", "stored_procedure", None),
    ]
    processes = [{"process_fqn": _proc("p1"), "process_name": "CALL schema1.sp_load", "process_type": "sql", "query_type": "storedprocedure"}]
    graph, by_id, sps, procs, calls = _sp_graph(rows, processes)

    load = sps["sp_load"]
    # the container's name is the last segment of the stored procedure's FQN
    assert load["fqn"] == f"{V}/sp_load" and load["full_name"] == "db1.schema1.sp_load"
    p1 = procs[_proc("p1")]
    assert p1["parent_id"] == load["id"]
    assert p1["process_type"] == "sql" and p1["query_type"] == "storedprocedure"
    assert set(sps) == {"sp_load", "sp_helper"}
    assert calls == {("sp_load", "sp_helper")}
    # a stored procedure is not a table, whichever edge mentions it
    assert not any(n["type"] == "table" and n["label"].startswith("sp_") for n in graph["nodes"])


def test_process_without_a_stored_procedure_has_no_container():
    graph, _, sps, procs, calls = _sp_graph(VIEW_ROWS)
    assert procs and not sps and not calls
    assert all(n["parent_id"] is None and n["process_type"] is None for n in procs.values())


def test_stored_procedure_with_several_processes_and_calls():
    rows = (
        _io_rows(_proc("p1"), "t1", "t2")
        + _io_rows(_proc("p2"), "t2", "t3")
        # sp_a ran both processes, and calls sp_b (which ran nothing) and sp_c
        + [
            _typed_row("contextualizes", f"{V}/sp_a", _proc("p1"), "stored_procedure", "dataprocess", _proc("p1")),
            _typed_row("contextualizes", f"{V}/sp_a", _proc("p2"), "stored_procedure", "dataprocess", _proc("p2")),
            _typed_row("calls", f"{V}/sp_a", f"{V}/sp_b", "stored_procedure", "stored_procedure", None),
            _typed_row("calls", f"{V}/sp_a", f"{V}/sp_c", "stored_procedure", "stored_procedure", None),
            _typed_row("calls", f"{V}/sp_a", f"{V}/sp_c", "stored_procedure", "stored_procedure", None),  # duplicate
            _typed_row("calls", f"{V}/sp_b", f"{V}/sp_b", "stored_procedure", "stored_procedure", None),  # self-call: dropped
        ]
    )
    graph, by_id, sps, procs, calls = _sp_graph(rows)
    assert {p["parent_id"] for p in procs.values()} == {sps["sp_a"]["id"]}
    assert set(sps) == {"sp_a", "sp_b", "sp_c"}
    assert calls == {("sp_a", "sp_b"), ("sp_a", "sp_c")}
    assert sum(1 for e in graph["edges"] if e["kind"] == "calls") == 2
    # table<->process edges stay on the processes, so a client can fold them onto the container
    io = {(by_id[e["source"]]["label"], by_id[e["target"]]["label"], e["kind"]) for e in graph["edges"] if e["kind"] != "calls"}
    assert io == {("t1", "p1", "input"), ("p1", "t2", "output"), ("t2", "p2", "input"), ("p2", "t3", "output")}


def test_process_claimed_by_several_stored_procedures_goes_to_the_first_by_fqn():
    rows = _io_rows(_proc("p1"), "src", "dst") + [
        _typed_row("contextualizes", f"{V}/sp_b", _proc("p1"), "stored_procedure", "dataprocess", _proc("p1")),
        _typed_row("contextualizes", f"{V}/sp_a", _proc("p1"), "stored_procedure", "dataprocess", _proc("p1")),
    ]
    _, _, sps, procs, _ = _sp_graph(rows)
    assert procs[_proc("p1")]["parent_id"] == sps["sp_a"]["id"]


def test_stored_procedure_is_not_a_table():
    # `contextualizes` links a stored procedure to the process that ran it. Its FQN is
    # table-shaped, but the endpoint is tagged stored_procedure, so it is not an asset.
    df = pd.DataFrame(NO_PROCESS_VIEW_ROWS)
    tables = {n["full_name"] for n in get_lineage_graph(df, None)["nodes"] if n["type"] == "table"}
    assert tables == {f"db1.schema1.{t}" for t in ("base_table", "v1", "v2", "other_table", "final_table")}

    asset_tables = {t["table"] for db in build_asset_tree(df) for s in db["schemas"] for t in s["tables"]}
    assert asset_tables == {"base_table", "v1", "v2", "other_table", "final_table"}
    assert compute_summary(df, pd.DataFrame())["unique_tables"] == 5
    # flow pairs never treat the stored procedure as a source table either
    assert all("sp_load" not in p["source_table"] for p in get_flow_pairs(df))


# ---------------------------------------------------------------------------
# Power BI bundles
# ---------------------------------------------------------------------------
#
# Power BI assets are /system/powerbi/<model|report|dashboard id>/…: their depth
# collides with database objects (a field is as deep as a table, a measure as deep
# as a schema), so only the endpoint's source_type/target_type tag tells them apart.

PB = "/pbsys/powerbi"
SQL = "/dbsys/sqlserver/ip/dbo"
BI_PROC = "/dbsys/sqlserver/dataprocess/p1"   # newer bundles put the platform before "dataprocess"

POWERBI_ROWS = [
    # a SQL process loads the model's data table "Sales Data" from the physical table orders
    _typed_row("read_by", f"{SQL}/orders/amount", BI_PROC, "column", "dataprocess", BI_PROC),
    _typed_row("read_by", f"{SQL}/orders", BI_PROC, "table", "dataprocess", BI_PROC),
    _typed_row("writes_to", BI_PROC, f"{PB}/m1/Sales%20Data/Amount", "dataprocess", "bifield", BI_PROC),
    _typed_row("writes_to", BI_PROC, f"{PB}/m1/Sales%20Data", "dataprocess", "bitable", BI_PROC),
    _typed_row("maps_to", f"{SQL}/orders/amount", f"{PB}/m1/Sales%20Data/Amount", "column", "bifield", BI_PROC),
    _typed_row("maps_to", f"{SQL}/orders", f"{PB}/m1/Sales%20Data", "table", "bitable", BI_PROC),
    # no process in between from here on
    _typed_row("read_by", f"{PB}/m1/Sales%20Data/Amount", f"{PB}/m1/Total%20Amount", "bifield", "bimeasure", None),
    _typed_row("read_by", f"{PB}/m1/Total%20Amount", f"{PB}/m1/Other", "bimeasure", "bimeasure", None),   # inside one model
    _typed_row("read_by", f"{SQL}/orders", f"{PB}/m1", "table", "bimodel", None),
    _typed_row("read_by", f"{PB}/m1", f"{PB}/r1", "bimodel", "bireport", None),
    _typed_row("read_by", f"{PB}/m1", f"{PB}/d1/t1", "bimodel", "bitile", None),
    _typed_row("read_by", f"{PB}/r1", f"{PB}/d1/t1", "bireport", "bitile", None),
    # a second model with a data table that no measure reads
    _typed_row("writes_to", BI_PROC, f"{PB}/m2/Lonely", "dataprocess", "bitable", BI_PROC),
    _typed_row("read_by", f"{SQL}/orders", f"{PB}/m2", "table", "bimodel", None),
]


def test_parse_asset_reads_power_bi_endpoints_by_their_type_tag():
    # a table, a field and a measure are all INSIDE their model: they roll up into it, as a column does into a table
    field = parse_asset(f"{PB}/m1/Sales%20Data/Amount", "bifield")
    assert (field["type"], field["asset_type"], field["bi_type"]) == ("column", "bimodel", "bifield")
    assert (field["database"], field["schema"], field["table"], field["column"]) == ("powerbi", "m1", "(model)", "Sales_Data_Amount")   # as an id spells it
    assert (field["member_table"], field["member_name"]) == ("Sales Data", "Amount")                                                  # %20 decoded

    measure = parse_asset(f"{PB}/m1/Total%20Amount", "bimeasure")
    assert (measure["type"], measure["asset_type"], measure["table"], measure["column"]) == ("column", "bimodel", "(model)", "Total_Amount")
    assert parse_asset(f"{PB}/m1", "bimodel")["table"] == "(model)"      # a model is the table its measures are columns of
    assert parse_asset(f"{PB}/r1", "bireport")["schema"] == "(reports)"
    tile = parse_asset(f"{PB}/d1/t1", "bitile")
    assert (tile["asset_type"], tile["schema"], tile["table"]) == ("bitile", "d1", "t1")
    sem_table = parse_asset(f"{PB}/m1/Sales%20Data", "bitable")
    assert (sem_table["asset_type"], sem_table["bi_type"], sem_table["schema"], sem_table["member_table"]) == ("bimodel", "bisemtable", "m1", "Sales Data")

    # the same FQN without the tag is read by depth, as any database object
    assert parse_asset(f"{PB}/m1/Sales%20Data/Amount")["type"] == "table"
    assert "asset_type" not in parse_asset(f"{PB}/m1/Sales%20Data/Amount")
    # a tag whose FQN has the wrong depth does not resolve
    assert parse_asset(f"{PB}/m1", "bifield")["type"] == "unresolved"


def test_parse_fqn_dataprocess_with_platform_segment():
    r = parse_fqn(BI_PROC)
    assert (r["type"], r["system"], r["platform"], r["process_id"]) == ("dataprocess", "dbsys", "sqlserver", "p1")


def test_power_bi_graph_chains_source_table_to_report():
    graph = get_lineage_graph(pd.DataFrame(POWERBI_ROWS), None)
    nodes = {n["id"]: n for n in graph["nodes"]}
    name = {i: n.get("full_name") or n["process_fqn"] for i, n in nodes.items()}
    links = {(name[e["source"]], name[e["target"]], e["kind"], bool(e.get("summary"))) for e in graph["edges"]}

    # a table of a model, a field and a measure are not nodes of their own: they are inside their model's node
    assert {n["full_name"] for n in graph["nodes"] if n["type"] == "table"} == {
        "ip.dbo.orders", "powerbi.m1.(model)", "powerbi.(reports).r1", "powerbi.d1.t1", "powerbi.m2.(model)",
    }
    assert {(n["member_kind"], n["label"], n["parent_id"] == next(i for i, x in nodes.items() if x.get("full_name") == f"powerbi.{n['model_id']}.(model)"))
            for n in graph["nodes"] if n["type"] == "bi_member"} == {
        ("table", "Sales Data", True), ("table", "Lonely", True),      # the tables the edges name, as written
        ("field", "Sales Data[Amount]", True), ("measure", "Total Amount", True), ("measure", "Other", True),
    }
    assert links == {
        # the SQL process that loads the model's tables keeps its read/write edges: to the model (what a closed model
        # shows, flagged as the roll-up) and to the table it writes (what an open one shows)
        ("ip.dbo.orders", BI_PROC, "input", False),
        (BI_PROC, "powerbi.m1.(model)", "output", True),
        (BI_PROC, "powerbi.m2.(model)", "output", True),
        (BI_PROC, "powerbi.m1.(model).Sales Data", "output", False),
        (BI_PROC, "powerbi.m2.(model).Lonely", "output", False),
        # everything without a process: `read_by` links. The source table -> model edge is not drawn again: the process is
        # already the way that table reaches the model
        ("powerbi.m1.(model)", "powerbi.(reports).r1", "uses", False),
        ("powerbi.m1.(model)", "powerbi.d1.t1", "uses", False),
        ("powerbi.(reports).r1", "powerbi.d1.t1", "uses", False),
        # a measure built on a field / another measure of its model: a link between the two, drawn inside the model
        ("powerbi.m1.(model).Sales_Data_Amount", "powerbi.m1.(model).Total_Amount", "uses", False),
        ("powerbi.m1.(model).Total_Amount", "powerbi.m1.(model).Other", "uses", False),
    }
    # (measure -> measure inside one model adds no self-loop)
    assert all(name[e["source"]] != name[e["target"]] for e in graph["edges"])


def test_power_bi_links_are_drawn_as_the_name_the_data_gives_them():
    # read_by stays what it was; a link that only `maps_to` edges say (a bundle writes its field -> measure and
    # field -> field links that way) is a maps_to: never a read_by that the data does not have
    rows = [_typed_row("maps_to", f"{PB}/m1/Sales/Amount", f"{PB}/m1/Total", "bifield", "bimeasure", None),
            _typed_row("read_by", f"{PB}/m1", f"{PB}/r1", "bimodel", "bireport", None),
            _typed_row("maps_to", f"{PB}/m1/Sales/Amount", f"{PB}/m2/Sales/Amount", "bifield", "bifield", None),   # rolls up to model -> model…
            _typed_row("read_by", f"{PB}/m1", f"{PB}/m2", "bimodel", "bimodel", None)]                              # …which is also a read_by
    graph = get_lineage_graph(pd.DataFrame(rows), None)
    name = {n["id"]: n.get("full_name") for n in graph["nodes"]}
    links = {(name[e["source"]], name[e["target"]]): e["kind"] for e in graph["edges"]}
    assert links[("powerbi.m1.(model).Sales_Amount", "powerbi.m1.(model).Total")] == "direct"      # maps_to (the legend's colour for it)
    assert links[("powerbi.m1.(model)", "powerbi.(reports).r1")] == "uses"                          # read_by
    assert links[("powerbi.m1.(model)", "powerbi.m2.(model)")] == "uses"                            # read_by wins where both say it


def test_a_table_of_a_model_a_process_writes_is_linked_to_the_process_and_the_models_link_is_its_roll_up():
    rows = [_typed_row("read_by", f"{SQL}/orders", BI_PROC, "table", "dataprocess", BI_PROC),
            _typed_row("writes_to", BI_PROC, f"{PB}/m1/Sales", "dataprocess", "bitable", BI_PROC),
            _typed_row("read_by", f"{SQL}/orders", f"{PB}/m1", "table", "bimodel", None)]
    graph = get_lineage_graph(pd.DataFrame(rows), None)
    name = {n["id"]: n.get("full_name") or n["process_fqn"] for n in graph["nodes"]}
    links = {(name[e["source"]], name[e["target"]], e["kind"]): bool(e.get("summary")) for e in graph["edges"]}
    assert links == {
        ("ip.dbo.orders", BI_PROC, "input"): False,
        (BI_PROC, "powerbi.m1.(model)", "output"): True,          # to the whole model: left out by the client while the model is open
        (BI_PROC, "powerbi.m1.(model).Sales", "output"): False,   # to the table
    }


def test_power_bi_nodes_carry_their_asset_type_and_a_readable_label():
    nodes = {n["full_name"]: n for n in get_lineage_graph(pd.DataFrame(POWERBI_ROWS), None)["nodes"] if n["type"] == "table"}
    # models, reports and tiles only have GUIDs until their names are known: show the start of the id
    assert (nodes["powerbi.m1.(model)"]["asset_type"], nodes["powerbi.m1.(model)"]["label"]) == ("bimodel", "m1")
    assert (nodes["powerbi.(reports).r1"]["asset_type"], nodes["powerbi.(reports).r1"]["label"]) == ("bireport", "r1")
    assert (nodes["powerbi.d1.t1"]["asset_type"], nodes["powerbi.d1.t1"]["label"]) == ("bitile", "t1")
    assert "details" not in nodes["powerbi.m1.(model)"]
    assert "asset_type" not in nodes["ip.dbo.orders"]


def test_power_bi_summary_counts_bi_assets_apart_from_databases():
    s = compute_summary(pd.DataFrame(POWERBI_ROWS), pd.DataFrame([{"process_fqn": BI_PROC}]))
    # one physical table and column; the model ids, data tables and fields are not databases/schemas/tables
    assert (s["unique_databases"], s["unique_schemas"], s["unique_tables"], s["unique_columns"]) == (1, 1, 1, 1)
    assert s["bi_assets"] == {"models": 2, "reports": 1, "dashboards": 0, "tiles": 1, "tables": 2, "fields": 1, "measures": 2}
    assert s["bi_asset_type_names"]["tables"] == "bitable"
    assert {"pbsys", "dbsys"} <= set(s["system_names"])


def test_summary_has_no_bi_assets_for_a_database_bundle():
    assert "bi_assets" not in compute_summary(pd.DataFrame(NO_PROCESS_VIEW_ROWS), pd.DataFrame())


def test_power_bi_assets_tree_lists_a_models_fields_and_measures_as_its_columns():
    tree = {d["database"]: d for d in build_asset_tree(pd.DataFrame(POWERBI_ROWS))}
    assert set(tree) == {"ip", "powerbi"}
    model = {t["table"]: t for t in {s["schema"]: s for s in tree["powerbi"]["schemas"]}["m1"]["tables"]}
    assert set(model) == {"(model)"}                                     # the model's tables are not tables of the tree
    assert model["(model)"]["columns"] == ["Other", "Sales_Data_Amount", "Total_Amount"]     # its fields and measures, as ids spell them
    assert model["(model)"]["column_kinds"] == {"Sales_Data_Amount": "field", "Total_Amount": "measure", "Other": "measure"}
    assert {s["schema"] for s in tree["powerbi"]["schemas"]} == {"m1", "m2", "(reports)", "d1"}


def test_power_bi_data_mapping_links_source_table_to_the_model_it_loads():
    graph = get_mapping_graph(pd.DataFrame(POWERBI_ROWS))
    name = {n["id"]: n["full_name"] for n in graph["nodes"]}
    assert {(name[e["source"]], name[e["target"]], e["column_count"]) for e in graph["edges"]} == {
        ("ip.dbo.orders", "powerbi.m1.(model)", 1),
    }
    assert next(n for n in graph["nodes"] if n["full_name"] == "powerbi.m1.(model)")["asset_type"] == "bimodel"


def test_power_bi_flow_pairs_go_from_the_source_table_to_the_model():
    pairs = {(p["source_table"], p["target_table"]) for p in get_flow_pairs(pd.DataFrame(POWERBI_ROWS))}
    assert pairs == {("ip.dbo.orders", "powerbi.m1.(model)"), ("ip.dbo.orders", "powerbi.m2.(model)")}


def test_percent_encoded_names_are_shown_decoded():
    rows = _io_rows(_proc("p1"), "Dim%20-%20Date", "out")
    nodes = {n["full_name"] for n in get_lineage_graph(pd.DataFrame(rows), None)["nodes"] if n["type"] == "table"}
    assert nodes == {"db1.schema1.Dim - Date", "db1.schema1.out"}
    assert "Dim - Date" in {t["table"] for d in build_asset_tree(pd.DataFrame(rows)) for s in d["schemas"] for t in s["tables"]}


# ---------------------------------------------------------------------------
# Power BI, live-scanner format
# ---------------------------------------------------------------------------
#
# The live scanner tags its endpoints only "table"/"column" and puts the kind in the
# path (/sys/powerbi/<namespace>/<workspace>/<kind>/<id>); a field or measure id is
# "<model id>_<name>". Everything flows through processes, e.g. REFRESH, REPORT_RENDER.

SCAN = "/pbsys/powerbi/default/w1"
MODEL = "11111111-1111-1111-1111-111111111111"
P_REFRESH, P_EVAL, P_REPORT, P_TILE, P_DASH = (f"/pbsys/dataprocess/{n}" for n in ("refresh", "eval", "report", "tile", "dash"))

SCANNER_ROWS = [
    # a refresh loads the model (and its fields) from a database table
    _typed_row("read_by", f"{SQL}/orders", P_REFRESH, "table", "dataprocess", P_REFRESH),
    _typed_row("writes_to", P_REFRESH, f"{SCAN}/semantic_model/{MODEL}", "dataprocess", "table", P_REFRESH),
    _typed_row("writes_to", P_REFRESH, f"{SCAN}/field/{MODEL}_Sales_Amount", "dataprocess", "column", P_REFRESH),
    # a measure is evaluated from the model's own fields: drawn as a link between the two, inside the model
    _typed_row("read_by", f"{SCAN}/field/{MODEL}_Sales_Amount", P_EVAL, "column", "dataprocess", P_EVAL),
    _typed_row("writes_to", P_EVAL, f"{SCAN}/measure/{MODEL}_Total_Amount", "dataprocess", "column", P_EVAL),
    # model -> report -> tile -> dashboard
    _typed_row("read_by", f"{SCAN}/semantic_model/{MODEL}", P_REPORT, "table", "dataprocess", P_REPORT),
    _typed_row("writes_to", P_REPORT, f"{SCAN}/report/r1", "dataprocess", "table", P_REPORT),
    _typed_row("read_by", f"{SCAN}/report/r1", P_TILE, "table", "dataprocess", P_TILE),
    _typed_row("writes_to", P_TILE, f"{SCAN}/tile/t1", "dataprocess", "table", P_TILE),
    _typed_row("read_by", f"{SCAN}/tile/t1", P_DASH, "table", "dataprocess", P_DASH),
    _typed_row("writes_to", P_DASH, f"{SCAN}/dashboard/d1", "dataprocess", "table", P_DASH),
]


def test_parse_asset_reads_the_kind_from_the_path_in_live_scanner_fqns():
    # the "table" tag says nothing: the path does
    model = parse_asset(f"{SCAN}/semantic_model/{MODEL}", "table")
    assert (model["type"], model["asset_type"], model["bi_type"]) == ("table", "bimodel", "bimodel")
    assert (model["database"], model["schema"], model["table"]) == ("powerbi", MODEL, "(model)")

    field = parse_asset(f"{SCAN}/field/{MODEL}_Sales_Amount", "column")
    assert (field["type"], field["asset_type"], field["bi_type"]) == ("column", "bimodel", "bifield")   # rolls up into the model
    assert (field["schema"], field["table"], field["column"]) == (MODEL, "(model)", "Sales_Amount")
    measure = parse_asset(f"{SCAN}/measure/{MODEL}_Total_Amount")
    assert (measure["bi_type"], measure["column"]) == ("bimeasure", "Total_Amount")

    report = parse_asset(f"{SCAN}/report/r1")
    assert (report["asset_type"], report["schema"], report["table"]) == ("bireport", "(reports)", "r1")
    assert parse_asset(f"{SCAN}/dashboard/d1")["asset_type"] == "bidashboard"
    tile = parse_asset(f"{SCAN}/tile/t1")
    assert (tile["asset_type"], tile["schema"], tile["table"]) == ("bitile", "(tiles)", "t1")

    # a field id without the model id in front can't be placed
    assert parse_asset(f"{SCAN}/field/Sales_Amount")["type"] == "unresolved"
    # nothing else is mistaken for a Power BI asset
    assert "asset_type" not in parse_asset(f"{SQL}/orders", "table")
    assert "asset_type" not in parse_asset("/sys/platform/db/schema/report/x", "table")


def test_live_scanner_graph_chains_database_to_dashboard_through_the_processes():
    graph = get_lineage_graph(pd.DataFrame(SCANNER_ROWS), None)
    nodes = {n["id"]: n for n in graph["nodes"]}
    name = {i: n.get("full_name") or n["process_fqn"] for i, n in nodes.items()}

    assert {n["full_name"]: n.get("asset_type") for n in graph["nodes"] if n["type"] == "table"} == {
        "ip.dbo.orders": None,
        f"powerbi.{MODEL}.(model)": "bimodel",
        "powerbi.(reports).r1": "bireport",
        "powerbi.(tiles).t1": "bitile",
        "powerbi.(dashboards).d1": "bidashboard",
    }
    assert {(name[e["source"]], name[e["target"]], e["kind"]) for e in graph["edges"]} == {
        ("ip.dbo.orders", P_REFRESH, "input"), (P_REFRESH, f"powerbi.{MODEL}.(model)", "output"),
        (f"powerbi.{MODEL}.(model)", P_REPORT, "input"), (P_REPORT, "powerbi.(reports).r1", "output"),
        ("powerbi.(reports).r1", P_TILE, "input"), (P_TILE, "powerbi.(tiles).t1", "output"),
        ("powerbi.(tiles).t1", P_DASH, "input"), (P_DASH, "powerbi.(dashboards).d1", "output"),
        (f"powerbi.{MODEL}.(model).Sales_Amount", f"powerbi.{MODEL}.(model).Total_Amount", "uses"),
    }
    # the measure evaluation is not a node of its own: it is the link between the field and the measure
    assert P_EVAL not in {n.get("process_fqn") for n in graph["nodes"]}
    # unnamed assets are labelled by the start of their id
    labels = {n["full_name"]: n["label"] for n in graph["nodes"] if n["type"] == "table"}
    assert labels[f"powerbi.{MODEL}.(model)"] == MODEL[:8] and labels["powerbi.(tiles).t1"] == "t1"


def _members(graph):
    """The field/measure nodes of `graph` by label, plus a lookup of every node by id."""
    nodes = {n["id"]: n for n in graph["nodes"]}
    return {n["label"]: n for n in graph["nodes"] if n["type"] == "bi_member"}, nodes


def test_measure_evaluations_become_fields_and_measures_inside_their_model():
    processes = pd.DataFrame([{"process_fqn": P_EVAL, "process_name": "EVALUATE into Total Amount", "query_type": "POWERBI_MEASURE_EVAL"}])
    graph = get_lineage_graph(pd.DataFrame(SCANNER_ROWS), processes)
    members, nodes = _members(graph)

    # the measure takes its name from the evaluation's; a field has only its id to go by
    assert set(members) == {"Total Amount", "Sales Amount"}
    assert (members["Total Amount"]["member_kind"], members["Sales Amount"]["member_kind"]) == ("measure", "field")
    model = next(n for n in graph["nodes"] if n["type"] == "table" and n.get("asset_type") == "bimodel")
    assert {m["parent_id"] for m in members.values()} == {model["id"]}   # both belong to the one model node
    assert {m["model_id"] for m in members.values()} == {MODEL}
    link = next(e for e in graph["edges"] if nodes[e["source"]]["type"] == "bi_member")
    assert (nodes[link["source"]]["label"], nodes[link["target"]]["label"], link["kind"]) == ("Sales Amount", "Total Amount", "uses")


def test_a_measure_built_from_fields_and_measures_is_linked_from_each_of_them():
    p2 = "/pbsys/dataprocess/eval2"
    rows = SCANNER_ROWS + [
        _typed_row("read_by", f"{SCAN}/field/{MODEL}_Sales_Amount", p2, "column", "dataprocess", p2),
        _typed_row("read_by", f"{SCAN}/measure/{MODEL}_Total_Amount", p2, "column", "dataprocess", p2),
        _typed_row("writes_to", p2, f"{SCAN}/measure/{MODEL}_Margin", "dataprocess", "column", p2),
    ]
    graph = get_lineage_graph(pd.DataFrame(rows), None)
    members, nodes = _members(graph)

    assert set(members) == {"Sales Amount", "Total Amount", "Margin"}   # a member two evaluations use is still one node
    links = {(nodes[e["source"]]["label"], nodes[e["target"]]["label"]) for e in graph["edges"] if nodes[e["source"]]["type"] == "bi_member"}
    assert links == {("Sales Amount", "Total Amount"), ("Sales Amount", "Margin"), ("Total Amount", "Margin")}
    assert len([n for n in graph["nodes"] if n["type"] == "table" and n.get("asset_type") == "bimodel"]) == 1


def test_direct_links_between_a_models_fields_and_measures_are_drawn_inside_the_model():
    # The newer live-scanner bundles have no evaluation process: a measure is just linked from what it is built on.
    other = "22222222-2222-2222-2222-222222222222"
    rows = [r for r in SCANNER_ROWS if r["process_fqn"] != P_EVAL] + [
        _typed_row("read_by", f"{SCAN}/field/{MODEL}_Sales_Amount", f"{SCAN}/measure/{MODEL}_Total_Amount", "column", "column", None),
        _typed_row("read_by", f"{SCAN}/measure/{MODEL}_Total_Amount", f"{SCAN}/measure/{MODEL}_Margin", "column", "column", None),
        _typed_row("read_by", f"{SCAN}/measure/{MODEL}_Margin", f"{SCAN}/measure/{MODEL}_Margin", "column", "column", None),   # itself
        # a measure of another model reading this model's field is a link between two models, not inside one
        _typed_row("read_by", f"{SCAN}/field/{MODEL}_Sales_Amount", f"{SCAN}/measure/{other}_Elsewhere", "column", "column", None),
    ]
    graph = get_lineage_graph(pd.DataFrame(rows), None)
    members, nodes = _members(graph)

    assert set(members) == {"Sales Amount", "Total Amount", "Margin"}
    links = {(nodes[e["source"]]["label"], nodes[e["target"]]["label"]) for e in graph["edges"] if nodes[e["source"]]["type"] == "bi_member"}
    assert links == {("Sales Amount", "Total Amount"), ("Total Amount", "Margin")}
    tables = {n["full_name"]: n for n in graph["nodes"] if n["type"] == "table"}
    assert {m["parent_id"] for m in members.values()} == {tables[f"powerbi.{MODEL}.(model)"]["id"]}
    # …while the cross-model one still links the two models
    assert (f"powerbi.{MODEL}.(model)", f"powerbi.{other}.(model)", "uses") in {
        (nodes[e["source"]].get("full_name"), nodes[e["target"]].get("full_name"), e["kind"]) for e in graph["edges"]
    }


def _attributes(*rows):
    """A bundle's attributes.parquet: (parent urn, parent type, child urn, child type) containment rows."""
    return pd.DataFrame([{"parent_urn": p, "parent_type": pt, "child_urn": c, "child_type": ct, "relation": "contains"} for p, pt, c, ct in rows])


MODEL_URN = f"/{MODEL}"
SALES_ATTRIBUTES = _attributes(
    (MODEL_URN, "semantic_model", f"{MODEL_URN}/Sales", "semantic_table"),
    (MODEL_URN, "semantic_model", f"{MODEL_URN}/Date%20%28UTC%29", "semantic_table"),   # percent-encoded name, listed after Sales
    (f"{MODEL_URN}/Sales", "semantic_table", f"{MODEL_URN}/Sales/Amount", "field"),
    (f"{MODEL_URN}/Sales", "semantic_table", f"{MODEL_URN}/Sales/Region", "field"),
    (f"{MODEL_URN}/Sales", "semantic_table", f"{MODEL_URN}/Sales/Total%20Amount", "measure"),
    (f"{MODEL_URN}/Date%20%28UTC%29", "semantic_table", f"{MODEL_URN}/Date%20%28UTC%29/Day", "field"),
    # another model that is not in this graph gets no nodes
    ("/22222222-2222-2222-2222-222222222222", "semantic_model", "/22222222-2222-2222-2222-222222222222/Elsewhere", "semantic_table"),
)


def test_attributes_give_each_model_its_tables_even_when_nothing_is_linked():
    rows = [r for r in SCANNER_ROWS if r["process_fqn"] != P_EVAL]   # no measure/field links at all
    graph = get_lineage_graph(pd.DataFrame(rows), None, SALES_ATTRIBUTES)
    nodes = {n["id"]: n for n in graph["nodes"]}
    tables = [n for n in graph["nodes"] if n["type"] == "bi_member"]

    assert [(t["member_kind"], t["label"], t["field_count"], t["measure_count"]) for t in tables] == [
        ("table", "Date (UTC)", 1, 0), ("table", "Sales", 2, 1),     # sorted by name, decoded
    ]
    sales = tables[1]
    assert (sales["fields"], sales["measures"]) == (["Amount", "Region"], ["Total Amount"])
    assert {nodes[t["parent_id"]]["full_name"] for t in tables} == {f"powerbi.{MODEL}.(model)"}
    assert {t["model_id"] for t in tables} == {MODEL}
    assert not [e for e in graph["edges"] if nodes[e["source"]]["type"] == "bi_member"]   # no edges: just there


def test_tables_come_along_with_the_linked_fields_and_measures():
    graph = get_lineage_graph(pd.DataFrame(SCANNER_ROWS), None, SALES_ATTRIBUTES)
    kinds = [n["member_kind"] for n in graph["nodes"] if n["type"] == "bi_member"]
    assert sorted(kinds) == ["field", "measure", "table", "table"]


# ---- semantic tables: what a model's tables are loaded from, and what is built on them -----------------------------------

OTHER_MODEL = "22222222-2222-2222-2222-222222222222"


def _sem(model, name):
    return f"{SCAN}/semantic_table/{model}_{name}"


def _two_model_attributes():
    return _attributes(
        (MODEL_URN, "semantic_model", f"{MODEL_URN}/Sales", "semantic_table"),
        (MODEL_URN, "semantic_model", f"{MODEL_URN}/cust-dw", "semantic_table"),          # a hyphen is kept in ids
        (MODEL_URN, "semantic_model", f"{MODEL_URN}/Not%20Linked", "semantic_table"),
        (f"/{OTHER_MODEL}", "semantic_model", f"/{OTHER_MODEL}/Sales", "semantic_table"),
        (f"/{OTHER_MODEL}", "semantic_model", f"/{OTHER_MODEL}/cust-dw", "semantic_table"),
    )


SEMANTIC_ROWS = [
    # the database tables feed the tables of the first model, and the model as a whole (the roll-up of the former)
    _typed_row("read_by", f"{SQL}/orders", _sem(MODEL, "Sales"), "table", "table", None),
    _typed_row("read_by", f"{SQL}/cust_dw", _sem(MODEL, "cust-dw"), "table", "table", None),
    _typed_row("read_by", f"{SQL}/orders", f"{SCAN}/semantic_model/{MODEL}", "table", "table", None),
    _typed_row("read_by", f"{SQL}/cust_dw", f"{SCAN}/semantic_model/{MODEL}", "table", "table", None),
    # the second model is built on the first: table to table (same name), and model to model
    _typed_row("read_by", _sem(MODEL, "Sales"), _sem(OTHER_MODEL, "Sales"), "table", "table", None),
    _typed_row("read_by", _sem(MODEL, "cust-dw"), _sem(OTHER_MODEL, "cust-dw"), "table", "table", None),
    _typed_row("read_by", f"{SCAN}/semantic_model/{MODEL}", f"{SCAN}/semantic_model/{OTHER_MODEL}", "table", "table", None),
]


def test_parse_asset_reads_a_semantic_table_as_part_of_its_model():
    p = parse_asset(_sem(MODEL, "cust-dw"), "table")
    assert (p["bi_type"], p["asset_type"], p["schema"], p["table"], p["column"]) == ("bisemtable", "bimodel", MODEL, "(model)", "cust-dw")
    assert parse_asset(f"{SCAN}/semantic_table/no-model-id")["type"] == "unresolved"


def test_semantic_tables_are_power_bi_tables_in_the_summary_not_database_objects():
    s = compute_summary(pd.DataFrame(SEMANTIC_ROWS), pd.DataFrame())
    assert s["bi_assets"]["tables"] == 4          # Sales and cust-dw, in each of the two models
    assert (s["unique_databases"], s["unique_tables"]) == (1, 2)     # only the two database tables


def test_a_models_tables_are_not_listed_as_its_columns_in_the_asset_tree():
    tree = build_asset_tree(pd.DataFrame(SEMANTIC_ROWS))
    model = next(t for d in tree for s in d["schemas"] for t in s["tables"] if t["table"] == "(model)")
    assert model["columns"] == []


def test_source_tables_feed_the_tables_of_a_model_and_those_feed_the_next_models_tables():
    graph = get_lineage_graph(pd.DataFrame(SEMANTIC_ROWS), None, _two_model_attributes())
    nodes = {n["id"]: n for n in graph["nodes"]}

    def name(i):
        n = nodes[i]
        return f"{n['model_id'][:2] if n['type'] == 'bi_member' else ''}:{n['label']}"

    links = {(name(e["source"]), name(e["target"])) for e in graph["edges"] if "table" in (nodes[e["source"]].get("member_kind"), nodes[e["target"]].get("member_kind"))}
    assert links == {
        (":orders", "11:Sales"), (":cust_dw", "11:cust-dw"),
        ("11:Sales", "22:Sales"), ("11:cust-dw", "22:cust-dw"),
    }
    assert [n["label"] for n in graph["nodes"] if n.get("member_kind") == "table"] == ["cust-dw", "Not Linked", "Sales", "cust-dw", "Sales"]


def test_the_link_between_whole_models_is_marked_as_a_roll_up_of_the_table_links():
    graph = get_lineage_graph(pd.DataFrame(SEMANTIC_ROWS), None, _two_model_attributes())
    nodes = {n["id"]: n for n in graph["nodes"]}
    whole = {(nodes[e["source"]].get("full_name"), nodes[e["target"]].get("full_name")): e for e in graph["edges"]
             if nodes[e["source"]]["type"] == "table" and nodes[e["target"]]["type"] == "table"}
    # source table -> model and model -> model: both are what the table links add up to
    assert whole[("ip.dbo.orders", f"powerbi.{MODEL}.(model)")].get("summary") is True
    assert whole[(f"powerbi.{MODEL}.(model)", f"powerbi.{OTHER_MODEL}.(model)")].get("summary") is True
    # a link nothing is rolled up into is not
    plain = [e for e in graph["edges"] if nodes[e["source"]]["type"] == "bi_member" and e.get("summary")]
    assert not plain


def test_without_attributes_only_the_links_between_whole_models_are_drawn():
    graph = get_lineage_graph(pd.DataFrame(SEMANTIC_ROWS), None)
    nodes = {n["id"]: n for n in graph["nodes"]}
    assert not [n for n in graph["nodes"] if n["type"] == "bi_member"]
    links = {(nodes[e["source"]]["full_name"], nodes[e["target"]]["full_name"]) for e in graph["edges"]}
    assert (f"powerbi.{MODEL}.(model)", f"powerbi.{OTHER_MODEL}.(model)") in links
    assert not any(e.get("summary") for e in graph["edges"])    # nothing to roll up


def test_a_table_the_attributes_do_not_know_is_left_to_the_roll_up():
    rows = SEMANTIC_ROWS + [_typed_row("read_by", f"{SQL}/orders", _sem(MODEL, "Mystery"), "table", "table", None)]
    graph = get_lineage_graph(pd.DataFrame(rows), None, _two_model_attributes())
    assert "Mystery" not in {n["label"] for n in graph["nodes"]}
    assert len([n for n in graph["nodes"] if n.get("member_kind") == "table"]) == 5


def _id_spelled_attributes():
    """The same containment as _two_model_attributes plus a field and a measure, as newer bundles' attributes.parquet writes it:
    the assets' own FQNs, names spelled as in ids ("<model id>_<table>", a field "<model id>_<table>_<column>")."""
    return _attributes(
        (f"{SCAN}/semantic_model/{MODEL}", "semantic_model", _sem(MODEL, "Sales"), "semantic_table"),
        (f"{SCAN}/semantic_model/{MODEL}", "semantic_model", _sem(MODEL, "cust-dw"), "semantic_table"),
        (f"{SCAN}/semantic_model/{MODEL}", "semantic_model", _sem(MODEL, "Not_Linked"), "semantic_table"),
        (f"{SCAN}/semantic_model/{OTHER_MODEL}", "semantic_model", _sem(OTHER_MODEL, "Sales"), "semantic_table"),
        (f"{SCAN}/semantic_model/{OTHER_MODEL}", "semantic_model", _sem(OTHER_MODEL, "cust-dw"), "semantic_table"),
        (_sem(MODEL, "Sales"), "semantic_table", f"{SCAN}/field/{MODEL}_Sales_Amount", "field"),
        (_sem(MODEL, "Sales"), "semantic_table", f"{SCAN}/measure/{MODEL}_Total_Amount", "measure"),
        (f"{SCAN}/workspace/w1", "workspace", f"{SCAN}/semantic_model/{MODEL}", "semantic_model"),     # not about tables: ignored
    )


def test_attributes_that_name_the_assets_by_their_ids_give_the_same_tables_and_links():
    graph = get_lineage_graph(pd.DataFrame(SEMANTIC_ROWS), None, _id_spelled_attributes())
    nodes = {n["id"]: n for n in graph["nodes"]}
    tables = [n for n in graph["nodes"] if n.get("member_kind") == "table"]
    assert [(t["model_id"][:2], t["label"], t["field_count"], t["measure_count"]) for t in tables] == [
        ("11", "cust-dw", 0, 0), ("11", "Not_Linked", 0, 0), ("11", "Sales", 1, 1), ("22", "cust-dw", 0, 0), ("22", "Sales", 0, 0),
    ]
    sales = next(t for t in tables if t["label"] == "Sales" and t["model_id"] == MODEL)
    assert (sales["fields"], sales["measures"]) == (["Amount"], ["Total_Amount"])      # the model and table prefixes are taken off

    def name(i):
        n = nodes[i]
        return f"{n['model_id'][:2] if n['type'] == 'bi_member' else ''}:{n['label']}"

    links = {(name(e["source"]), name(e["target"])) for e in graph["edges"] if "table" in (nodes[e["source"]].get("member_kind"), nodes[e["target"]].get("member_kind"))}
    assert links == {(":orders", "11:Sales"), (":cust_dw", "11:cust-dw"), ("11:Sales", "22:Sales"), ("11:cust-dw", "22:cust-dw")}


COLUMN_ROWS = [
    # a database column feeds a field, that field feeds the same field of the next model, and a measure reads it
    _typed_row("read_by", f"{SQL}/orders/amount", f"{SCAN}/field/{MODEL}_Sales_Amount", "column", "column", None),
    _typed_row("read_by", f"{SCAN}/field/{MODEL}_Sales_Amount", f"{SCAN}/field/{OTHER_MODEL}_Sales_Amount", "column", "column", None),
    _typed_row("read_by", f"{SCAN}/field/{MODEL}_Sales_Amount", f"{SCAN}/measure/{MODEL}_Total_Amount", "column", "column", None),
]
COLUMN_ATTRIBUTES = pd.concat([
    SALES_ATTRIBUTES,
    _attributes(
        (f"/{OTHER_MODEL}", "semantic_model", f"/{OTHER_MODEL}/Sales", "semantic_table"),
        (f"/{OTHER_MODEL}/Sales", "semantic_table", f"/{OTHER_MODEL}/Sales/Amount", "field"),
    ),
], ignore_index=True)


def test_column_lineage_follows_each_field_back_to_its_source_column_and_on_to_the_next_model():
    names = BiNames(path="x", models={MODEL: ("Sales Model", None), OTHER_MODEL: ("Reporting Model", None)})
    result = get_column_lineage(pd.DataFrame(COLUMN_ROWS), COLUMN_ATTRIBUTES, MODEL, "Sales", names)

    assert (result["model"], result["table"], [f["name"] for f in result["fields"]]) == ({"id": MODEL, "name": "Sales Model"}, "Sales", ["Amount", "Region"])
    amount, region = result["fields"]
    assert amount["upstream"] == [[{"kind": "column", "type_name": "column", "label": "ip.dbo.orders.amount", "model": None}]]
    assert amount["downstream"] == [[{"kind": "field", "type_name": "field", "label": "Sales[Amount]", "model": "Reporting Model"}]]
    assert result["type_names"] == {"table": "semantic_table", "field": "field"}      # as the paths in the data spell them
    assert amount["measures"] == {"count": 1, "names": ["Total Amount"]}
    assert (region["upstream"], region["downstream"]) == ([], []) and "measures" not in region


# ---- the names on screen are the data's own: source_type/target_type tags, or the kind segment of a live-scanner path -----

def _names(graph):
    return {n["full_name"]: n.get("type_name") for n in graph["nodes"] if n["type"] == "table"}


def test_live_scanner_nodes_carry_the_kind_the_path_names_not_a_name_of_ours():
    graph = get_lineage_graph(pd.DataFrame(SCANNER_ROWS + SEMANTIC_ROWS[:1]), None, SALES_ATTRIBUTES)
    names = _names(graph)
    assert names[f"powerbi.{MODEL}.(model)"] == "semantic_model"
    assert (names["powerbi.(reports).r1"], names["powerbi.(tiles).t1"], names["powerbi.(dashboards).d1"]) == ("report", "tile", "dashboard")
    assert names["ip.dbo.orders"] is None                       # a database table has none: its tag is plain table/view
    members = {(n["member_kind"], n["label"]): n for n in graph["nodes"] if n["type"] == "bi_member"}
    assert members[("measure", "Total Amount")]["type_name"] == "measure"
    assert members[("field", "Sales[Amount]")]["type_name"] == "field"
    assert members[("table", "Sales")]["type_name"] == "semantic_table"
    assert members[("field", "Sales[Amount]")]["table_type_name"] == "semantic_table"      # the table it lives in


def test_tagged_nodes_carry_the_tag_the_data_gives_them():
    graph = get_lineage_graph(pd.DataFrame(POWERBI_ROWS), None)
    names = _names(graph)
    assert {v for v in names.values() if v} == {"bimodel", "bireport", "bitile"}
    assert names[f"powerbi.m1.(model)"] == "bimodel" and names["powerbi.(reports).r1"] == "bireport"
    # a table of a model is not a node of its own: it is a table inside its model, named by its tag too
    assert {n["type_name"] for n in graph["nodes"] if n.get("member_kind") == "table"} == {"bitable"}


def test_the_summary_labels_the_power_bi_counts_with_the_names_the_data_uses():
    live = compute_summary(pd.DataFrame(SCANNER_ROWS), pd.DataFrame())
    assert live["bi_asset_type_names"] == {"models": "semantic_model", "reports": "report", "dashboards": "dashboard", "tiles": "tile", "fields": "field", "measures": "measure"}
    tagged = compute_summary(pd.DataFrame(POWERBI_ROWS), pd.DataFrame())
    assert tagged["bi_asset_type_names"]["models"] == "bimodel" and tagged["bi_asset_type_names"]["tables"] == "bitable"
    assert "bi_asset_type_names" not in compute_summary(pd.DataFrame(EDGES_ROWS), pd.DataFrame())     # no Power BI


def test_the_asset_tree_gives_the_data_names_of_the_fields_and_measures_it_lists():
    tree = build_asset_tree(pd.DataFrame(SCANNER_ROWS))
    model = next(t for d in tree for s in d["schemas"] for t in s["tables"] if t["table"] == "(model)")
    assert model["column_kinds"] == {"Sales_Amount": "field", "Total_Amount": "measure"}
    assert model["type_names"] == {"field": "field", "measure": "measure"}


# ---- the typed layout: every endpoint tagged bimodel/bitable/bifield/bimeasure/bireport/bitile/bidataflow, no platform segment ---

PBI = "/powerbi-sandbox"
OTHER_MODEL_ID = "22222222-2222-2222-2222-222222222222"
TYPED_ROWS = [
    _typed_row("read_by", f"{SQL}/orders", f"{PBI}/{MODEL}/Sales", "table", "bitable", None),           # a table feeds a table of the model
    _typed_row("read_by", f"{SQL}/orders", f"{PBI}/{MODEL}", "table", "bimodel", None),                # …and, rolled up, the model
    _typed_row("read_by", f"{SQL}/orders/amount", f"{PBI}/{MODEL}/Sales/Amount", "column", "bifield", None),
    _typed_row("read_by", f"{PBI}/{MODEL}/Sales/Amount", f"{PBI}/{MODEL}/Total%20Amount", "bifield", "bimeasure", None),
    _typed_row("read_by", f"{PBI}/{MODEL}/Total%20Amount", f"{PBI}/{MODEL}/Margin", "bimeasure", "bimeasure", None),
    _typed_row("read_by", f"{PBI}/{MODEL}/Sales/Amount", f"{PBI}/{OTHER_MODEL_ID}/Sales/Amount", "bifield", "bifield", None),
    _typed_row("read_by", f"{PBI}/{MODEL}/Sales", f"{PBI}/{OTHER_MODEL_ID}/Sales", "bitable", "bitable", None),
    _typed_row("read_by", f"{PBI}/{MODEL}", f"{PBI}/{OTHER_MODEL_ID}", "bimodel", "bimodel", None),
    _typed_row("read_by", f"{PBI}/{OTHER_MODEL_ID}", f"{PBI}/r1", "bimodel", "bireport", None),
    _typed_row("read_by", f"{PBI}/r1", f"{PBI}/d1/t1", "bireport", "bitile", None),
    _typed_row("read_by", f"{PBI}/df1", f"{PBI}/{MODEL}/Sales/Amount", "bidataflow", "bifield", None),
    _typed_row("read_by", f"{PBI}/df1", f"{PBI}/{MODEL}/Sales", "bidataflow", "bitable", None),
]


def test_parse_asset_reads_the_typed_layout_by_its_tag():
    def p(fqn, tag):
        return parse_asset(fqn, tag)

    model = p(f"{PBI}/{MODEL}", "bimodel")
    assert (model["asset_type"], model["schema"], model["table"], model["type_name"]) == ("bimodel", MODEL, "(model)", "bimodel")
    table = p(f"{PBI}/{MODEL}/Date%20Selection", "bitable")           # a table INSIDE the model: rolls up into it
    assert (table["type"], table["asset_type"], table["column"], table["type_name"]) == ("column", "bimodel", "Date_Selection", "bitable")
    field = p(f"{PBI}/{MODEL}/Date%20Selection/Date%20Selection%20Order", "bifield")
    assert (field["column"], field["type_name"], field["schema"]) == ("Date_Selection_Date_Selection_Order", "bifield", MODEL)
    measure = p(f"{PBI}/{MODEL}/Written%20Premium%20%28New%29", "bimeasure")
    assert (measure["column"], measure["type_name"]) == ("Written_Premium__New_", "bimeasure")
    assert (p(f"{PBI}/r1", "bireport")["table"], p(f"{PBI}/d1/t1", "bitile")["schema"], p(f"{PBI}/df1", "bidataflow")["schema"]) == ("r1", "d1", "(dataflows)")
    assert p(f"{PBI}/{MODEL}/Sales/Amount", "bimodel")["type"] == "unresolved"      # the wrong number of segments for the tag
    # with the platform segment (/<sys>/powerbi/<model id>/…) it reads the same: its tables are inside the model too
    with_platform = parse_asset("/xenon/powerbi/m1/Sales/Amount", "bifield")
    assert (with_platform["type"], with_platform["asset_type"], with_platform["bi_type"]) == ("column", "bimodel", "bifield")
    assert (with_platform["database"], with_platform["schema"], with_platform["table"], with_platform["column"]) == ("powerbi", "m1", "(model)", "Sales_Amount")
    assert (with_platform["member_table"], with_platform["member_name"]) == ("Sales", "Amount")      # as written, not as an id spells it
    sem_table = parse_asset("/xenon/powerbi/m1/Sales", "bitable")
    assert (sem_table["bi_type"], sem_table["asset_type"], sem_table["column"]) == ("bisemtable", "bimodel", "Sales")
    assert parse_asset("/xenon/powerbi/m1", "bimodel")["table"] == "(model)"
    assert parse_asset("/xenon/powerbi/d1/t1", "bitile")["schema"] == "d1"


def test_typed_graph_shows_the_tags_as_the_names_of_its_nodes_and_links_tables_to_tables():
    graph = get_lineage_graph(pd.DataFrame(TYPED_ROWS), None, SALES_ATTRIBUTES)
    nodes = {n["id"]: n for n in graph["nodes"]}
    named = {n["full_name"]: n.get("type_name") for n in graph["nodes"] if n["type"] == "table"}
    assert named[f"powerbi-sandbox.{MODEL}.(model)"] == "bimodel"
    assert (named["powerbi-sandbox.(reports).r1"], named["powerbi-sandbox.d1.t1"], named["powerbi-sandbox.(dataflows).df1"]) == ("bireport", "bitile", "bidataflow")
    members = {(n["member_kind"], n["label"]): n for n in graph["nodes"] if n["type"] == "bi_member"}
    assert members[("table", "Sales")]["type_name"] == "bitable"
    assert members[("field", "Sales[Amount]")]["type_name"] == "bifield"
    assert members[("measure", "Total Amount")]["type_name"] == "bimeasure"

    def name(i):
        n = nodes[i]
        return f"{n['model_id'][:2] if n['type'] == 'bi_member' else ''}:{n['label']}"

    into_tables = {(name(e["source"]), name(e["target"])) for e in graph["edges"] if nodes[e["target"]].get("member_kind") == "table"}
    assert (":orders", "11:Sales") in into_tables
    assert any(nodes[e["source"]].get("asset_type") == "bidataflow" and name(e["target"]) == "11:Sales" for e in graph["edges"])   # a dataflow feeds a table
    inside = {(name(e["source"]), name(e["target"])) for e in graph["edges"] if nodes[e["source"]].get("member_kind") in ("field", "measure")}
    assert inside == {("11:Sales[Amount]", "11:Total Amount"), ("11:Total Amount", "11:Margin")}


def test_the_tables_the_edges_name_are_shown_in_their_model_when_nothing_else_lists_them():
    graph = get_lineage_graph(pd.DataFrame(TYPED_ROWS), None)       # no scan, no attributes.parquet
    nodes = {n["id"]: n for n in graph["nodes"]}
    assert {(n["model_id"], n["label"], n["field_count"]) for n in graph["nodes"] if n.get("member_kind") == "table"} == {(MODEL, "Sales", 1), (OTHER_MODEL_ID, "Sales", 1)}
    links = {(nodes[e["source"]].get("full_name"), nodes[e["target"]]["label"], nodes[e["target"]].get("model_id")) for e in graph["edges"] if nodes[e["target"]].get("member_kind") == "table"}
    assert ("ip.dbo.orders", "Sales", MODEL) in links                                # a source table -> the model's table
    assert (f"powerbi-sandbox.{MODEL}.(model).Sales", "Sales", OTHER_MODEL_ID) in links    # a table -> the table of the model built on it


# the layout of the bundles of 2026-11-12 23:45: /<sys>/powerbi/<id>…, every load a Data Process, field links written as maps_to
V4_ROWS = [
    _typed_row("read_by", f"{SQL}/orders", BI_PROC, "table", "dataprocess", BI_PROC),
    _typed_row("read_by", f"{SQL}/orders/amount", BI_PROC, "column", "dataprocess", BI_PROC),
    _typed_row("writes_to", BI_PROC, f"{PB}/m1/Sales", "dataprocess", "bitable", BI_PROC),
    _typed_row("writes_to", BI_PROC, f"{PB}/m1/Sales/Amount", "dataprocess", "bifield", BI_PROC),
    _typed_row("maps_to", f"{SQL}/orders/amount", f"{PB}/m1/Sales/Amount", "column", "bifield", BI_PROC),
    _typed_row("read_by", f"{SQL}/orders", f"{PB}/m1", "table", "bimodel", None),               # the same load, rolled up to the model
    _typed_row("read_by", f"{PB}/m1/Sales", f"{PB}/m2/Sales", "bitable", "bitable", None),
    _typed_row("maps_to", f"{PB}/m1/Sales/Amount", f"{PB}/m2/Sales/Amount", "bifield", "bifield", None),
    _typed_row("read_by", f"{PB}/m1", f"{PB}/m2", "bimodel", "bimodel", None),
    _typed_row("maps_to", f"{PB}/m2/Sales/Amount", f"{PB}/m2/Total", "bifield", "bimeasure", None),
    _typed_row("read_by", f"{PB}/m2", f"{PB}/r1", "bimodel", "bireport", None),
]


def test_a_load_process_feeds_the_table_of_the_model_and_the_tables_feed_the_next_models_tables():
    graph = get_lineage_graph(pd.DataFrame(V4_ROWS), None)
    nodes = {n["id"]: n for n in graph["nodes"]}
    name = {i: n.get("full_name") or n["process_fqn"] for i, n in nodes.items()}
    links = {(name[e["source"]], name[e["target"]], e["kind"]): bool(e.get("summary")) for e in graph["edges"]}
    m1, m2 = "powerbi.m1.(model)", "powerbi.m2.(model)"
    assert links == {
        ("ip.dbo.orders", BI_PROC, "input"): False,
        (BI_PROC, m1, "output"): True,                              # the roll-up of the load, for a closed model
        (BI_PROC, f"{m1}.Sales", "output"): False,                  # the load of the table, for an open one
        (f"{m1}.Sales", f"{m2}.Sales", "uses"): False,              # table -> table
        (m1, m2, "uses"): True,                                     # …and their roll-up
        (m2, "powerbi.(reports).r1", "uses"): False,
        (f"{m2}.Sales_Amount", f"{m2}.Total", "direct"): False,    # only a maps_to says field -> measure
    }                                                              # (no ip.dbo.orders -> m1: the process is how it gets there)
    assert not [n for n in graph["nodes"] if n["type"] == "table" and n.get("asset_type") == "bitable"]   # no table is a node of its own


# What each row of V4_ROWS says about itself: (confidence, resolution_type, fallback_reason)
_FALLBACK = ("MEDIUM", "table_fallback", "column_unresolvable")
_RESOLVED = ("MEDIUM", "column_resolved", None)
_SURE = ("HIGH", "column_resolved", None)
V4_SAYS = [_FALLBACK, _RESOLVED, _FALLBACK, _RESOLVED, _RESOLVED, _FALLBACK, _FALLBACK, _RESOLVED, _SURE, _SURE, _SURE]


def _says(rows, says):
    return pd.DataFrame([{**row, "confidence": c, "resolution_type": r, "fallback_reason": why} for row, (c, r, why) in zip(rows, says)])


def _basis_of(graph, source, target):
    """The (basis, weakest) of the link between two nodes, named by full_name / process_fqn."""
    name = {n["id"]: n.get("full_name") or n.get("process_fqn") for n in graph["nodes"]}
    edge = next(e for e in graph["edges"] if (name[e["source"]], name[e["target"]]) == (source, target))
    return edge.get("basis"), edge.get("weakest")


def _group(confidence, resolution_type, count, fallback_reason=None):
    return {"confidence": confidence, "resolution_type": resolution_type, **({"fallback_reason": fallback_reason} if fallback_reason else {}), "count": count}


def test_every_drawn_link_says_how_sure_the_pipeline_is_of_the_edges_behind_it():
    graph = get_lineage_graph(_says(V4_ROWS, V4_SAYS), None)
    m1, m2 = "powerbi.m1.(model)", "powerbi.m2.(model)"
    fallback = _group("MEDIUM", "table_fallback", 1, "column_unresolvable")
    # one edge behind the link between two tables
    assert _basis_of(graph, f"{m1}.Sales", f"{m2}.Sales") == ([fallback], "MEDIUM")
    assert _basis_of(graph, BI_PROC, f"{m1}.Sales") == ([fallback], "MEDIUM")
    assert _basis_of(graph, m2 + ".Sales_Amount", m2 + ".Total") == ([_group("HIGH", "column_resolved", 1)], "HIGH")
    assert _basis_of(graph, m2, "powerbi.(reports).r1") == ([_group("HIGH", "column_resolved", 1)], "HIGH")
    # the link between the whole models rests on every edge between their tables and fields and the one between the models:
    # listed weakest first, and it is as sure as the weakest of them
    assert _basis_of(graph, m1, m2) == ([_group("MEDIUM", "column_resolved", 1), fallback, _group("HIGH", "column_resolved", 1)], "MEDIUM")
    # the process that loads the table: its link to the whole model rests on the edges to the table and to its fields, and
    # the link from the source table on the edges that read it
    resolved_twice_and_fallback = [_group("MEDIUM", "column_resolved", 2), fallback]
    assert _basis_of(graph, BI_PROC, m1) == (resolved_twice_and_fallback, "MEDIUM")
    assert _basis_of(graph, "ip.dbo.orders", BI_PROC) == ([_group("MEDIUM", "column_resolved", 2), fallback], "MEDIUM")


def test_a_bundle_without_confidence_gets_no_basis_and_one_that_says_nothing_gets_none_either():
    assert not any("basis" in e or "weakest" in e for e in get_lineage_graph(pd.DataFrame(V4_ROWS), None)["edges"])
    silent = pd.DataFrame([{**row, "confidence": None, "resolution_type": None, "fallback_reason": None} for row in V4_ROWS])
    assert not any("basis" in e for e in get_lineage_graph(silent, None)["edges"])


def test_a_level_the_pipeline_does_not_use_is_counted_but_never_called_the_weakest():
    from services.analysis_svc import _basis, _weakest
    says = [("WEIRD", None, None), ("HIGH", None, None), ("HIGH", None, None)]
    assert _weakest(says) == "HIGH"                                  # only the levels it knows are ranked
    assert _weakest([("WEIRD", None, None)]) is None
    assert _basis(Counter(says)) == [{"confidence": "HIGH", "count": 2}, {"confidence": "WEIRD", "count": 1}]
    assert _weakest([("LOW", None, None), ("high", None, None), ("MEDIUM", None, None)]) == "LOW"


def test_the_data_mapping_links_carry_the_confidence_of_their_maps_to_edges():
    graph = get_mapping_graph(_says(V4_ROWS, V4_SAYS))
    name = {n["id"]: n["full_name"] for n in graph["nodes"]}
    links = {(name[e["source"]], name[e["target"]]): (e["basis"], e["weakest"]) for e in graph["edges"]}
    assert links == {
        ("ip.dbo.orders", "powerbi.m1.(model)"): ([_group("MEDIUM", "column_resolved", 1)], "MEDIUM"),
        ("powerbi.m1.(model)", "powerbi.m2.(model)"): ([_group("MEDIUM", "column_resolved", 1)], "MEDIUM"),
    }


def test_each_step_of_a_column_lineage_path_says_how_sure_the_pipeline_is_of_the_link_to_the_next():
    says = list(V4_SAYS)
    says[4] = ("LOW", "column_resolved", None)       # the source column -> the field of the first model
    result = get_column_lineage(_says(V4_ROWS, says), None, "m2", "Sales")
    (field,) = result["fields"]
    # farthest first: the database column, then the field of m1, then (not drawn) m2's own: each with the link toward it
    assert [(n["label"], n["link"]) for n in field["upstream"][0]] == [
        ("ip.dbo.orders.amount", {"confidence": "LOW", "resolution_type": "column_resolved"}),
        ("Sales[Amount]", {"confidence": "MEDIUM", "resolution_type": "column_resolved"}),
    ]
    assert field["measures"] == {"count": 1, "names": ["Total"], "confidence": "HIGH"}
    first = get_column_lineage(_says(V4_ROWS, says), None, "m1", "Sales")["fields"][0]
    assert first["downstream"][0][0]["link"] == {"confidence": "MEDIUM", "resolution_type": "column_resolved"}


def test_when_two_edges_join_the_same_two_fields_the_step_shows_the_weaker_one():
    rows = [_typed_row("maps_to", f"{PB}/m1/Sales/Amount", f"{PB}/m2/Sales/Amount", "bifield", "bifield", None)] * 2
    says = [("HIGH", "column_resolved", None), ("LOW", "column_resolved", "derived_column")]
    (field,) = get_column_lineage(_says(rows, says), None, "m1", "Sales")["fields"]
    assert field["downstream"][0][0]["link"] == {"confidence": "LOW", "resolution_type": "column_resolved", "fallback_reason": "derived_column"}


def test_column_lineage_without_confidence_has_no_links():
    (field,) = get_column_lineage(pd.DataFrame(V4_ROWS), None, "m1", "Sales")["fields"]
    assert "link" not in field["upstream"][0][0] and "link" not in field["downstream"][0][0]


def test_column_lineage_follows_a_field_through_a_load_process_in_the_platform_layout():
    result = get_column_lineage(pd.DataFrame(V4_ROWS), None, "m1", "Sales")      # the table comes from the edges: no attributes here
    assert result is not None and result["type_names"] == {"table": "bitable", "field": "bifield"}
    (field,) = result["fields"]
    assert field["name"] == "Amount"
    assert [[n["label"] for n in path] for path in field["upstream"]] == [["ip.dbo.orders.amount"]]      # the process is not a step of it
    assert [[n["label"] for n in path] for path in field["downstream"]] == [["Sales[Amount]"]]
    assert get_column_lineage(pd.DataFrame(V4_ROWS), None, "m2", "Sales")["fields"][0]["measures"] == {"count": 1, "names": ["Total"]}


def test_typed_summary_counts_and_names_the_kinds_by_their_tags_including_dataflows():
    s = compute_summary(pd.DataFrame(TYPED_ROWS), pd.DataFrame())
    assert s["bi_assets"] == {"models": 2, "reports": 1, "dashboards": 0, "tiles": 1, "tables": 2, "fields": 2, "measures": 2, "dataflows": 1}
    assert s["bi_asset_type_names"] == {
        "models": "bimodel", "reports": "bireport", "tiles": "bitile", "tables": "bitable", "fields": "bifield", "measures": "bimeasure", "dataflows": "bidataflow",
    }
    assert (s["unique_databases"], s["unique_tables"], s["unique_columns"]) == (1, 1, 1)       # only the database side counts as a database


def test_typed_column_lineage_follows_a_field_from_its_database_column_with_the_tags_as_names():
    result = get_column_lineage(pd.DataFrame(TYPED_ROWS), SALES_ATTRIBUTES, MODEL, "Sales", None)
    amount = result["fields"][0]
    assert amount["upstream"] == [[{"kind": "column", "type_name": "column", "label": "ip.dbo.orders.amount", "model": None}]]
    assert amount["measures"] == {"count": 1, "names": ["Total Amount"]}
    assert result["type_names"] == {"table": "bitable", "field": "bifield"}


def test_column_lineage_of_the_next_model_reads_back_through_both_hops_in_order():
    result = get_column_lineage(pd.DataFrame(COLUMN_ROWS), COLUMN_ATTRIBUTES, OTHER_MODEL, "Sales", None)
    [path] = result["fields"][0]["upstream"]
    assert [n["label"] for n in path] == ["ip.dbo.orders.amount", "Sales[Amount]"]      # farthest source first
    assert result["model"]["name"] == OTHER_MODEL[:8]                                  # no names: the start of the id


def test_column_lineage_is_none_for_a_table_the_bundle_does_not_list():
    assert get_column_lineage(pd.DataFrame(COLUMN_ROWS), COLUMN_ATTRIBUTES, MODEL, "Nope", None) is None
    assert get_column_lineage(pd.DataFrame(COLUMN_ROWS), None, MODEL, "Sales", None) is None


def test_column_lineage_cuts_off_a_big_fan_out_and_says_so():
    rows = [_typed_row("read_by", f"{SQL}/orders/amount", f"{SCAN}/field/{MODEL}_Sales_Amount", "column", "column", None)]
    attrs = [(MODEL_URN, "semantic_model", f"{MODEL_URN}/Sales", "semantic_table"), (f"{MODEL_URN}/Sales", "semantic_table", f"{MODEL_URN}/Sales/Amount", "field")]
    for i in range(30):     # 30 other models each build a copy of the field on it
        other = f"{i:08d}-0000-0000-0000-000000000000"
        rows.append(_typed_row("read_by", f"{SCAN}/field/{MODEL}_Sales_Amount", f"{SCAN}/field/{other}_Sales_Amount", "column", "column", None))
        attrs += [(f"/{other}", "semantic_model", f"/{other}/Sales", "semantic_table"), (f"/{other}/Sales", "semantic_table", f"/{other}/Sales/Amount", "field")]
    result = get_column_lineage(pd.DataFrame(rows), _attributes(*attrs), MODEL, "Sales", None)
    assert len(result["fields"][0]["downstream"]) == 12 and result["truncated"] is True


def test_attributes_say_which_table_each_linked_measure_and_field_lives_in():
    graph = get_lineage_graph(pd.DataFrame(SCANNER_ROWS), None, SALES_ATTRIBUTES)
    linked = {n["label"]: n for n in graph["nodes"] if n["type"] == "bi_member" and n["member_kind"] != "table"}
    # named as written (a field as Table[Column]), each with its table, from the bundle alone: no scan or crawl involved
    assert set(linked) == {"Sales[Amount]", "Total Amount"}
    assert (linked["Sales[Amount]"]["table"], linked["Total Amount"]["table"]) == ("Sales", "Sales")

    without = get_lineage_graph(pd.DataFrame(SCANNER_ROWS), None)   # no attributes: nothing to say where they live
    assert not [n for n in without["nodes"] if n["type"] == "bi_member" and "table" in n]


def test_a_sample_of_a_big_tables_columns_is_kept_but_all_are_counted():
    fields = [f"{MODEL_URN}/Big/col{i}" for i in range(40)]
    attrs = _attributes((MODEL_URN, "semantic_model", f"{MODEL_URN}/Big", "semantic_table"), *[(f"{MODEL_URN}/Big", "semantic_table", f, "field") for f in fields])
    big = next(n for n in get_lineage_graph(pd.DataFrame(SCANNER_ROWS), None, attrs)["nodes"] if n.get("label") == "Big")
    assert big["field_count"] == 40 and len(big["fields"]) == 12


def test_attributes_without_the_containment_columns_or_with_none_add_nothing():
    for attrs in (None, pd.DataFrame(), pd.DataFrame({"parent_urn": ["/a"]})):
        graph = get_lineage_graph(pd.DataFrame(SCANNER_ROWS), None, attrs)
        assert not [n for n in graph["nodes"] if n.get("member_kind") == "table"]


def test_graph_without_measure_evaluations_has_no_fields_or_measures():
    rows = [r for r in SCANNER_ROWS if r["process_fqn"] != P_EVAL]
    assert not [n for n in get_lineage_graph(pd.DataFrame(rows), None)["nodes"] if n["type"] == "bi_member"]


def test_apply_bi_names_names_fields_and_measures_from_the_scan():
    graph = get_lineage_graph(pd.DataFrame(SCANNER_ROWS), None)
    names = BiNames(
        path="scan",
        models={MODEL: ("Sales Model", "Finance")},
        members={MODEL: {"Sales_Amount": "Sales[Amount]", "Total_Amount": "Total Amount (all)"}},
    )
    apply_bi_names(graph, names)
    members, _ = _members(graph)
    assert set(members) == {"Sales[Amount]", "Total Amount (all)"}
    assert members["Sales[Amount]"]["details"] == [{"label": "semantic_model", "value": "Sales Model"}, {"label": "workspace", "value": "Finance"}]


def test_a_database_process_that_reads_and_writes_one_table_is_still_drawn():
    p = "/sys1/platform1/dataprocess/upd"
    rows = [
        _typed_row("read_by", f"{V}/t", p, "table", "dataprocess", p),
        _typed_row("writes_to", p, f"{V}/t", "dataprocess", "table", p),
    ]
    assert [n["process_fqn"] for n in get_lineage_graph(pd.DataFrame(rows), None)["nodes"] if n["type"] == "process"] == [p]


def test_live_scanner_summary_counts_power_bi_assets_apart_from_databases():
    s = compute_summary(pd.DataFrame(SCANNER_ROWS), pd.DataFrame())
    assert s["bi_assets"] == {"models": 1, "reports": 1, "dashboards": 1, "tiles": 1, "tables": 0, "fields": 1, "measures": 1}
    assert (s["unique_databases"], s["unique_schemas"], s["unique_tables"], s["unique_columns"]) == (1, 1, 1, 0)


def test_has_bi_assets_by_tag_or_by_live_scanner_fqn():
    assert has_bi_assets(pd.DataFrame(POWERBI_ROWS))
    assert has_bi_assets(pd.DataFrame(SCANNER_ROWS))
    assert not has_bi_assets(pd.DataFrame(NO_PROCESS_VIEW_ROWS))
    assert not has_bi_assets(pd.DataFrame([{"edge": "read_by", "source_fqn": "/s/p/d/sch/t"}]))   # no type columns at all


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
