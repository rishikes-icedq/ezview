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
    parse_asset,
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
    field = parse_asset(f"{PB}/m1/Sales%20Data/Amount", "bifield")
    assert (field["type"], field["asset_type"]) == ("column", "bitable")
    assert (field["database"], field["schema"], field["table"], field["column"]) == ("powerbi", "m1", "Sales Data", "Amount")   # %20 decoded

    measure = parse_asset(f"{PB}/m1/Total%20Amount", "bimeasure")
    assert (measure["type"], measure["asset_type"], measure["table"], measure["column"]) == ("column", "bimodel", "(model)", "Total Amount")
    assert parse_asset(f"{PB}/m1", "bimodel")["table"] == "(model)"      # a model is the table its measures are columns of
    assert parse_asset(f"{PB}/r1", "bireport")["schema"] == "(reports)"
    tile = parse_asset(f"{PB}/d1/t1", "bitile")
    assert (tile["asset_type"], tile["schema"], tile["table"]) == ("bitile", "d1", "t1")
    assert parse_asset(f"{PB}/m1/Sales%20Data", "bitable")["asset_type"] == "bitable"

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
    links = {(name[e["source"]], name[e["target"]], e["kind"]) for e in graph["edges"]}

    # a field is not a table of its own: it rolls up into its data table, a measure into its model
    assert {n["full_name"] for n in graph["nodes"] if n["type"] == "table"} == {
        "ip.dbo.orders",
        "powerbi.m1.Sales Data", "powerbi.m1.(model)", "powerbi.(reports).r1", "powerbi.d1.t1",
        "powerbi.m2.Lonely", "powerbi.m2.(model)",
    }
    assert links == {
        # the SQL process that loads the data table keeps its read/write edges
        ("ip.dbo.orders", BI_PROC, "input"),
        (BI_PROC, "powerbi.m1.Sales Data", "output"),
        (BI_PROC, "powerbi.m2.Lonely", "output"),
        # everything without a process: "used by" edges
        ("powerbi.m1.Sales Data", "powerbi.m1.(model)", "uses"),   # a measure reads its fields (one edge for every field)
        ("ip.dbo.orders", "powerbi.m1.(model)", "uses"),
        ("powerbi.m1.(model)", "powerbi.(reports).r1", "uses"),
        ("powerbi.m1.(model)", "powerbi.d1.t1", "uses"),
        ("powerbi.(reports).r1", "powerbi.d1.t1", "uses"),
        ("powerbi.m2.Lonely", "powerbi.m2.(model)", "uses"),       # implied by the FQN: no measure reads it
        ("ip.dbo.orders", "powerbi.m2.(model)", "uses"),
    }
    # (measure -> measure inside one model, and field -> measure's table == model, add no self-loop)
    assert all(name[e["source"]] != name[e["target"]] for e in graph["edges"])


def test_power_bi_nodes_carry_their_asset_type_and_a_readable_label():
    nodes = {n["full_name"]: n for n in get_lineage_graph(pd.DataFrame(POWERBI_ROWS), None)["nodes"] if n["type"] == "table"}
    assert nodes["powerbi.m1.Sales Data"]["asset_type"] == "bitable" and nodes["powerbi.m1.Sales Data"]["label"] == "Sales Data"
    # models, reports and tiles only have GUIDs: show the kind and the start of the id
    assert (nodes["powerbi.m1.(model)"]["asset_type"], nodes["powerbi.m1.(model)"]["label"]) == ("bimodel", "Model m1")
    assert (nodes["powerbi.(reports).r1"]["asset_type"], nodes["powerbi.(reports).r1"]["label"]) == ("bireport", "Report r1")
    assert (nodes["powerbi.d1.t1"]["asset_type"], nodes["powerbi.d1.t1"]["label"]) == ("bitile", "Tile t1")
    assert "asset_type" not in nodes["ip.dbo.orders"]


def test_power_bi_summary_counts_bi_assets_apart_from_databases():
    s = compute_summary(pd.DataFrame(POWERBI_ROWS), pd.DataFrame([{"process_fqn": BI_PROC}]))
    # one physical table and column; the model ids, data tables and fields are not databases/schemas/tables
    assert (s["unique_databases"], s["unique_schemas"], s["unique_tables"], s["unique_columns"]) == (1, 1, 1, 1)
    assert s["bi_assets"] == {"models": 2, "reports": 1, "tiles": 1, "tables": 2, "fields": 1, "measures": 2}
    assert {"pbsys", "dbsys"} <= set(s["system_names"])


def test_summary_has_no_bi_assets_for_a_database_bundle():
    assert "bi_assets" not in compute_summary(pd.DataFrame(NO_PROCESS_VIEW_ROWS), pd.DataFrame())


def test_power_bi_assets_tree_groups_fields_under_their_data_table():
    tree = {d["database"]: d for d in build_asset_tree(pd.DataFrame(POWERBI_ROWS))}
    assert set(tree) == {"ip", "powerbi"}
    model = {t["table"]: t for t in {s["schema"]: s for s in tree["powerbi"]["schemas"]}["m1"]["tables"]}
    assert model["Sales Data"]["columns"] == ["Amount"]                  # the field, not a table named "Amount"
    assert model["(model)"]["columns"] == ["Other", "Total Amount"]      # a model's columns are its measures
    assert {s["schema"] for s in tree["powerbi"]["schemas"]} == {"m1", "m2", "(reports)", "d1"}


def test_power_bi_data_mapping_links_source_table_to_data_table():
    graph = get_mapping_graph(pd.DataFrame(POWERBI_ROWS))
    name = {n["id"]: n["full_name"] for n in graph["nodes"]}
    assert {(name[e["source"]], name[e["target"]], e["column_count"]) for e in graph["edges"]} == {
        ("ip.dbo.orders", "powerbi.m1.Sales Data", 1),
    }
    assert next(n for n in graph["nodes"] if n["full_name"] == "powerbi.m1.Sales Data")["asset_type"] == "bitable"


def test_power_bi_flow_pairs_go_from_the_source_table_to_the_data_table():
    pairs = {(p["source_table"], p["target_table"]) for p in get_flow_pairs(pd.DataFrame(POWERBI_ROWS))}
    assert pairs == {("ip.dbo.orders", "powerbi.m1.Sales Data"), ("ip.dbo.orders", "powerbi.m2.Lonely")}


def test_percent_encoded_names_are_shown_decoded():
    rows = _io_rows(_proc("p1"), "Dim%20-%20Date", "out")
    nodes = {n["full_name"] for n in get_lineage_graph(pd.DataFrame(rows), None)["nodes"] if n["type"] == "table"}
    assert nodes == {"db1.schema1.Dim - Date", "db1.schema1.out"}
    assert "Dim - Date" in {t["table"] for d in build_asset_tree(pd.DataFrame(rows)) for s in d["schemas"] for t in s["tables"]}


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
