"""Power BI names from a crawl snapshot: finding the crawl, reading it, and showing
the names in the lineage graph and the asset tree."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from services.analysis_svc import apply_bi_names, build_asset_tree, get_lineage_graph
from services.bi_names_svc import (
    BiNames, find_crawl_folder, find_scan, load_names, load_scan_containment, load_scan_names, member_key, resolve_names, resolve_snapshot,
    scan_containment,
)
from tests.test_lineage import BI_PROC, MODEL, POWERBI_ROWS, SCANNER_ROWS

CONNECTION = "conn-1"
SNAPSHOT = "20261028141339158"


def _write(snapshot: Path, family: str, rows: list[dict]) -> None:
    (snapshot / family).mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_parquet(snapshot / family / f"{family}.parquet")


def make_crawl(staged: Path, *, connection: str = CONNECTION, crawl: str = "crawl-a", snapshot: str = SNAPSHOT, model_name: str = "Sales Model") -> Path:
    """A crawl snapshot under staged/crawl-metadata/powerbi/<connection>/<crawl>/<snapshot>, named for POWERBI_ROWS."""
    snap = staged / "crawl-metadata" / "powerbi" / connection / crawl / snapshot
    _write(snap, "container", [{"container_urn": "/w1", "container_name": "Sales WS"}])
    _write(snap, "semantic_model", [
        {"semantic_model_urn": "/m1", "semantic_model_name": model_name, "container_urn": "/w1"},
        {"semantic_model_urn": "/m2", "semantic_model_name": "Second Model", "container_urn": "/w1"},
    ])
    _write(snap, "report", [{"report_urn": "/r1", "report_name": "Sales Report", "container_urn": "/w1"}])
    _write(snap, "dashboard", [{"dashboard_urn": "/d1", "dashboard_name": "Exec Dashboard", "container_urn": "/w1"}])
    _write(snap, "tile", [{"tile_urn": "/d1/t1", "tile_name": "Revenue tile", "dashboard_urn": "/d1"}])
    return snap


def make_bundle(staged: Path, *, connection_id: str | None = CONNECTION) -> Path:
    """The Power BI bundle of POWERBI_ROWS under staged/PowerBI/bundle/lineage; returns the folder holding lineage/."""
    bundle = staged / "PowerBI" / "bundle"
    lineage = bundle / "lineage"
    lineage.mkdir(parents=True)
    pd.DataFrame(POWERBI_ROWS).to_parquet(lineage / "edges.parquet")
    pd.DataFrame([{"process_fqn": BI_PROC, "process_name": "SELECT from ip.dbo.orders", "process_type": "sql", "query_type": "SELECT"}]).to_parquet(lineage / "processes.parquet")
    manifest = {"connectionId": connection_id} if connection_id else {}
    (lineage / "manifest.json").write_text(json.dumps(manifest))
    return bundle


def nodes_by_name(graph: dict) -> dict:
    return {n["full_name"]: n for n in graph["nodes"] if n["type"] == "table"}


# ---------------------------------------------------------------------------
# Finding and reading the crawl
# ---------------------------------------------------------------------------

def test_crawl_is_found_through_the_manifest_connection_id(tmp_path):
    snap = make_crawl(tmp_path)
    bundle = make_bundle(tmp_path)
    assert find_crawl_folder(bundle / "lineage", {"connectionId": CONNECTION}) == snap
    assert find_crawl_folder(bundle, {"connectionId": CONNECTION}) == snap   # the folder above lineage/ works too


def test_crawl_of_another_connection_or_without_connection_id_is_not_used(tmp_path):
    make_crawl(tmp_path, connection="conn-other")
    bundle = make_bundle(tmp_path)
    assert find_crawl_folder(bundle, {"connectionId": CONNECTION}) is None
    assert find_crawl_folder(bundle, {}) is None
    assert find_crawl_folder(bundle, None) is None


def test_latest_snapshot_wins_when_there_are_several(tmp_path):
    make_crawl(tmp_path, snapshot="20261001000000000")
    newest = make_crawl(tmp_path, crawl="crawl-b", snapshot="20261102000000000")
    assert find_crawl_folder(make_bundle(tmp_path), {"connectionId": CONNECTION}) == newest


def test_resolve_snapshot_accepts_the_snapshot_or_any_folder_above_it(tmp_path):
    snap = make_crawl(tmp_path)
    assert resolve_snapshot(snap) == snap
    assert resolve_snapshot(snap.parent) == snap                       # crawl-<id>
    assert resolve_snapshot(snap.parent.parent) == snap                # connection folder
    assert resolve_snapshot(tmp_path / "crawl-metadata") == snap
    (tmp_path / "empty").mkdir()
    assert resolve_snapshot(tmp_path / "empty") is None
    assert resolve_snapshot(tmp_path / "nope") is None
    assert resolve_snapshot(snap / "report" / "report.parquet") is None   # a file


def test_load_names_reads_every_asset_family(tmp_path):
    names = load_names(make_crawl(tmp_path))
    assert names.models == {"m1": ("Sales Model", "Sales WS"), "m2": ("Second Model", "Sales WS")}
    assert names.reports == {"r1": ("Sales Report", "Sales WS")}
    assert names.dashboards == {"d1": ("Exec Dashboard", "Sales WS")}
    assert names.tiles == {("d1", "t1"): "Revenue tile"}
    assert names.counts() == {"models": 2, "reports": 1, "dashboards": 1, "tiles": 1}


def test_load_names_copes_with_missing_families_and_blank_names(tmp_path):
    snap = tmp_path / "snap"
    _write(snap, "semantic_model", [
        {"semantic_model_urn": "/m1", "semantic_model_name": "Named", "container_urn": "/gone"},   # workspace not in the crawl
        {"semantic_model_urn": "/m2", "semantic_model_name": None, "container_urn": None},
    ])
    names = load_names(snap)
    assert names.models == {"m1": ("Named", None)}
    assert names.reports == {} and names.tiles == {}


def test_resolve_names_reports_where_the_names_came_from(tmp_path):
    snap = make_crawl(tmp_path)
    bundle = make_bundle(tmp_path)
    manifest = {"connectionId": CONNECTION}

    names, info = resolve_names(bundle, manifest, None)
    assert names is not None and info["status"] == "auto" and info["path"] == str(snap)
    assert info["counts"]["models"] == 2

    other = make_crawl(tmp_path / "elsewhere", model_name="Chosen Model")
    names, info = resolve_names(bundle, manifest, str(other.parent))          # a folder above the snapshot, by hand
    assert names.models["m1"][0] == "Chosen Model" and info["status"] == "manual" and info["path"] == str(other)


def test_resolve_names_missing_and_invalid(tmp_path):
    bundle = make_bundle(tmp_path)
    names, info = resolve_names(bundle, {"connectionId": CONNECTION}, None)
    assert names is None and info["status"] == "missing" and CONNECTION in info["message"]
    assert resolve_names(bundle, {}, None)[1]["status"] == "missing"

    (tmp_path / "not_a_crawl").mkdir()
    for bad in (str(tmp_path / "nope"), str(tmp_path / "not_a_crawl")):
        names, info = resolve_names(bundle, {"connectionId": CONNECTION}, bad)
        assert names is None and info["status"] == "invalid" and info["message"]


# ---------------------------------------------------------------------------
# Names in the graph and the asset tree
# ---------------------------------------------------------------------------

def test_graph_nodes_get_names_and_context():
    graph = get_lineage_graph(pd.DataFrame(POWERBI_ROWS), None)
    names = BiNames(
        path="x",
        models={"m1": ("Sales Model", "Sales WS")},
        reports={"r1": ("Sales Report", "Sales WS")},
        dashboards={"d1": ("Exec Dashboard", "Sales WS")},
        tiles={("d1", "t1"): "Revenue tile"},
    )
    apply_bi_names(graph, names)
    nodes = nodes_by_name(graph)

    model = nodes["powerbi.m1.(model)"]
    assert model["label"] == "Sales Model" and model["details"] == [{"label": "workspace", "value": "Sales WS"}]
    assert nodes["powerbi.(reports).r1"]["label"] == "Sales Report"
    tile = nodes["powerbi.d1.t1"]
    assert tile["label"] == "Revenue tile"
    assert tile["details"] == [{"label": "dashboard", "value": "Exec Dashboard"}, {"label": "workspace", "value": "Sales WS"}]
    table = nodes["powerbi.m1.Sales Data"]
    assert table["label"] == "Sales Data"                                # a data table already carries its own name
    assert table["details"] == [{"label": "semantic_model", "value": "Sales Model"}, {"label": "workspace", "value": "Sales WS"}]
    # m2 is not in the crawl: it keeps its id label and gets no details
    assert nodes["powerbi.m2.(model)"]["label"] == "m2" and "details" not in nodes["powerbi.m2.(model)"]
    # database objects are left alone
    assert "details" not in nodes["ip.dbo.orders"]


def test_asset_tree_labels_models_dashboards_reports_and_tiles():
    names = BiNames(
        path="x",
        models={"m1": ("Sales Model", None)},
        reports={"r1": ("Sales Report", None)},
        dashboards={"d1": ("Exec Dashboard", None)},
        tiles={("d1", "t1"): "Revenue tile"},
    )
    powerbi = next(d for d in build_asset_tree(pd.DataFrame(POWERBI_ROWS), names) if d["database"] == "powerbi")
    schemas = {s["schema"]: s for s in powerbi["schemas"]}
    assert schemas["m1"]["schema_label"] == "Sales Model"
    assert schemas["d1"]["schema_label"] == "Exec Dashboard"
    assert "schema_label" not in schemas["(reports)"] and "schema_label" not in schemas["m2"]
    assert schemas["(reports)"]["tables"][0]["table_label"] == "Sales Report"
    assert schemas["d1"]["tables"][0]["table_label"] == "Revenue tile"
    assert all("table_label" not in t for t in schemas["m1"]["tables"])      # data tables and the model keep their own names
    # no names, no labels
    plain = next(d for d in build_asset_tree(pd.DataFrame(POWERBI_ROWS)) if d["database"] == "powerbi")
    assert not any("schema_label" in s or any("table_label" in t for t in s["tables"]) for s in plain["schemas"])


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

def test_graph_api_uses_the_crawl_found_next_to_the_bundle(client, tmp_path):
    make_crawl(tmp_path)
    bundle = make_bundle(tmp_path)
    graph = client.get("/api/lineage/graph", params={"folder": str(bundle)}).json()
    assert nodes_by_name(graph)["powerbi.m1.(model)"]["label"] == "Sales Model"
    mapping = client.get("/api/lineage/graph", params={"folder": str(bundle), "mode": "mapping"}).json()
    assert nodes_by_name(mapping)["powerbi.m1.Sales Data"]["details"][0] == {"label": "semantic_model", "value": "Sales Model"}
    assets = client.get("/api/lineage/assets", params={"folder": str(bundle)}).json()
    assert any(s.get("schema_label") == "Sales Model" for d in assets for s in d["schemas"])
    info = client.get("/api/lineage/bi-names", params={"folder": str(bundle)}).json()
    assert info["status"] == "auto" and info["counts"]["models"] == 2


def test_a_crawl_chosen_by_hand_beats_the_one_found_next_to_the_bundle(client, tmp_path):
    make_crawl(tmp_path)
    bundle = make_bundle(tmp_path)
    chosen = make_crawl(tmp_path / "other", model_name="Chosen Model")
    params = {"folder": str(bundle), "crawl": str(chosen)}
    assert nodes_by_name(client.get("/api/lineage/graph", params=params).json())["powerbi.m1.(model)"]["label"] == "Chosen Model"
    info = client.get("/api/lineage/bi-names", params=params).json()
    assert info["status"] == "manual" and info["path"] == str(chosen)


def test_a_crawl_can_be_chosen_when_none_is_next_to_the_bundle(client, tmp_path):
    bundle = make_bundle(tmp_path)
    assert client.get("/api/lineage/bi-names", params={"folder": str(bundle)}).json()["status"] == "missing"
    # without names the graph still works, labelled by id
    graph = client.get("/api/lineage/graph", params={"folder": str(bundle)}).json()
    assert nodes_by_name(graph)["powerbi.m1.(model)"]["label"] == "m1"

    chosen = make_crawl(tmp_path / "elsewhere")
    graph = client.get("/api/lineage/graph", params={"folder": str(bundle), "crawl": str(chosen)}).json()
    assert nodes_by_name(graph)["powerbi.m1.(model)"]["label"] == "Sales Model"


def test_an_invalid_crawl_does_not_break_the_graph(client, tmp_path):
    make_crawl(tmp_path)
    bundle = make_bundle(tmp_path)
    params = {"folder": str(bundle), "crawl": str(tmp_path / "nope")}
    resp = client.get("/api/lineage/graph", params=params)
    assert resp.status_code == 200
    assert nodes_by_name(resp.json())["powerbi.m1.(model)"]["label"] == "m1"     # the typo is not silently replaced by the auto-found crawl
    info = client.get("/api/lineage/bi-names", params=params).json()
    assert info["status"] == "invalid" and "not found" in info["message"].lower()


def test_bi_names_for_a_bundle_without_power_bi_assets(client, lineage_folder):
    assert client.get("/api/lineage/bi-names", params={"folder": str(lineage_folder)}).json()["status"] == "none"


# ---------------------------------------------------------------------------
# Live-scanner bundles: a tile has no dashboard in its FQN, a dashboard is a node
# ---------------------------------------------------------------------------

def scanner_names() -> BiNames:
    return BiNames(
        path="x",
        models={MODEL: ("Sales Model", "Sales WS")},
        reports={"r1": ("Sales Report", "Sales WS")},
        dashboards={"d1": ("Exec Dashboard", "Sales WS")},
        tiles={("d1", "t1"): "Revenue tile"},
    )


def test_tiles_can_be_looked_up_by_their_own_id():
    names = scanner_names()
    assert names.tile_by_id("t1") == ("d1", "Revenue tile")
    assert names.tile_by_id("nope") is None


def test_live_scanner_graph_nodes_get_names_and_context():
    graph = get_lineage_graph(pd.DataFrame(SCANNER_ROWS), None)
    apply_bi_names(graph, scanner_names())
    nodes = nodes_by_name(graph)
    assert nodes[f"powerbi.{MODEL}.(model)"]["label"] == "Sales Model"
    assert nodes["powerbi.(reports).r1"]["label"] == "Sales Report"
    assert nodes["powerbi.(dashboards).d1"]["label"] == "Exec Dashboard"
    assert nodes["powerbi.(dashboards).d1"]["details"] == [{"label": "workspace", "value": "Sales WS"}]
    tile = nodes["powerbi.(tiles).t1"]
    assert tile["label"] == "Revenue tile"
    assert tile["details"] == [{"label": "dashboard", "value": "Exec Dashboard"}, {"label": "workspace", "value": "Sales WS"}]


def test_live_scanner_asset_tree_labels_reports_dashboards_and_tiles():
    powerbi = next(d for d in build_asset_tree(pd.DataFrame(SCANNER_ROWS), scanner_names()) if d["database"] == "powerbi")
    schemas = {s["schema"]: s for s in powerbi["schemas"]}
    assert schemas[MODEL]["schema_label"] == "Sales Model"
    assert schemas["(reports)"]["tables"][0]["table_label"] == "Sales Report"
    assert schemas["(dashboards)"]["tables"][0]["table_label"] == "Exec Dashboard"
    assert schemas["(tiles)"]["tables"][0]["table_label"] == "Revenue tile"
    # the model's columns are its fields and measures, by name
    assert schemas[MODEL]["tables"][0]["columns"] == ["Sales_Amount", "Total_Amount"]


def write_scan(bundle: Path, *, model_name: str = "Scanned Model", extra_workspace: bool = False, results_layout: bool = False) -> Path:
    """The bundle's own Scanner API result, stage2/powerbi_scan_result.parquet next to the lineage/ folder. Page 1 names the
    live-scanner ids, with a dashboard `displayName` and a tile `title` as the real API has them; page 2 is another workspace.
    `results_layout`: the pipeline's results-file layout (one row per query, `rows_json` = a JSON list of {"response": ...})
    instead of one row per page."""
    pages = [{"workspaces": [{
        "id": "w9", "name": "Scan WS",
        "reports": [{"id": "r1", "name": "Scanned Report", "datasetId": MODEL}, {"id": "r-noname", "name": None}],
        "datasets": [{"id": MODEL, "name": model_name, "tables": [
            {"name": "Sales", "columns": [{"name": "Amount"}, {"name": "Region"}], "measures": [{"name": "Total Amount"}]},
            {"name": "Date (UTC)", "columns": [{"name": "Day"}], "measures": []},
        ]}],
        "dashboards": [{"id": "d1", "displayName": "Scanned Dashboard", "tiles": [{"id": "t1", "title": "Scanned Tile", "reportId": "r1"}]}],
    }], "datasourceInstances": []}]
    if extra_workspace:
        pages.append({"workspaces": [{"id": "w10", "name": "Other WS", "reports": [{"id": "r2", "name": "Other Report"}]}]})
    stage2 = bundle / "stage2"
    stage2.mkdir(parents=True, exist_ok=True)
    scan = stage2 / "powerbi_scan_result.parquet"
    if results_layout:
        rows_json = json.dumps([{"response": json.dumps(p)} for p in pages])
        pd.DataFrame({"query_id": ["powerbi_scan_result__scan_id=1"], "status": ["ok"], "rows_json": [rows_json]}).to_parquet(scan)
    else:
        pd.DataFrame({"response": [json.dumps(p) for p in pages]}).to_parquet(scan)
    return scan


def make_scanner_bundle(tmp_path: Path) -> Path:
    bundle = tmp_path / "bundle"
    lineage = bundle / "lineage"
    lineage.mkdir(parents=True)
    pd.DataFrame(SCANNER_ROWS).to_parquet(lineage / "edges.parquet")
    pd.DataFrame([{"process_fqn": "/pbsys/dataprocess/refresh", "process_name": "REFRESH", "query_type": "POWERBI_REFRESH"}]).to_parquet(lineage / "processes.parquet")
    (lineage / "manifest.json").write_text(json.dumps({"connectionId": "LIVE-POWERBI-SP"}))
    return bundle


def test_scanner_result_in_the_bundle_names_its_assets(tmp_path):
    scan = write_scan(tmp_path, extra_workspace=True)
    names = load_scan_names(scan)
    assert names.models == {MODEL: ("Scanned Model", "Scan WS")}
    assert names.reports == {"r1": ("Scanned Report", "Scan WS"), "r2": ("Other Report", "Other WS")}    # blank names are skipped
    assert names.dashboards == {"d1": ("Scanned Dashboard", "Scan WS")}
    assert names.tiles == {("d1", "t1"): "Scanned Tile"}


def test_scanner_result_names_the_fields_and_measures_of_each_model(tmp_path):
    names = load_scan_names(write_scan(tmp_path))
    # keyed the way a live-scanner bundle spells them in its ids: anything but letters and digits becomes "_"
    assert names.members == {MODEL: {
        "Sales_Amount": "Sales[Amount]", "Sales_Region": "Sales[Region]", "Total_Amount": "Total Amount",
        "Date__UTC__Day": "Date (UTC)[Day]",
    }}
    assert member_key("Written Premium (New)") == "Written_Premium__New_"


def test_a_scanner_result_in_the_results_file_layout_is_read_the_same(tmp_path):
    # newer bundles (e.g. the GBQ dashboard ones) keep the responses inside a results file's `rows_json` cell
    plain = load_scan_names(write_scan(tmp_path / "a", extra_workspace=True))
    wrapped = load_scan_names(write_scan(tmp_path / "b", extra_workspace=True, results_layout=True))
    assert wrapped.models == plain.models and wrapped.reports == plain.reports and wrapped.members == plain.members
    assert wrapped.models == {MODEL: ("Scanned Model", "Scan WS")} and wrapped.reports["r2"] == ("Other Report", "Other WS")


def test_scanner_result_lists_the_tables_of_each_model_as_attributes_rows(tmp_path):
    from urllib.parse import quote
    scan = write_scan(tmp_path, extra_workspace=True)
    for frame in (load_scan_containment(scan), scan_containment(tmp_path / "lineage")):
        rows = {(r.parent_type, r.child_type, r.child_urn) for r in frame.itertuples()}
        assert rows == {
            ("semantic_model", "semantic_table", f"/{MODEL}/Sales"),
            ("semantic_model", "semantic_table", f"/{MODEL}/{quote('Date (UTC)', safe='')}"),     # percent-encoded, like attributes.parquet
            ("semantic_table", "field", f"/{MODEL}/Sales/Amount"),
            ("semantic_table", "field", f"/{MODEL}/Sales/Region"),
            ("semantic_table", "measure", f"/{MODEL}/Sales/Total%20Amount"),
            ("semantic_table", "field", f"/{MODEL}/{quote('Date (UTC)', safe='')}/Day"),
        }
    assert scan_containment(tmp_path / "nowhere" / "lineage") is None                           # no scanner result: nothing to list
    assert load_scan_containment(write_scan(tmp_path / "x", results_layout=True)).shape == (6, 5)


def test_asset_tree_says_which_columns_of_a_model_are_fields_and_which_measures_and_how_they_are_written(tmp_path):
    rows = SCANNER_ROWS[:2] + [
        r for r in SCANNER_ROWS if "/field/" in str(r["target_fqn"]) or "/measure/" in str(r["target_fqn"])
    ]
    names = load_scan_names(write_scan(tmp_path))

    def model_entry(tree):
        return next(t for d in tree for s in d["schemas"] for t in s["tables"] if t["table"] == "(model)" and s["schema"] == MODEL)

    named = model_entry(build_asset_tree(pd.DataFrame(rows), names))
    assert named["column_kinds"] == {"Sales_Amount": "field", "Total_Amount": "measure"}
    assert named["column_labels"] == {"Sales_Amount": "Sales[Amount]", "Total_Amount": "Total Amount"}   # a field as Table[Column]

    plain = model_entry(build_asset_tree(pd.DataFrame(rows)))      # without names: still says what each one is
    assert plain["column_kinds"] == named["column_kinds"] and "column_labels" not in plain
    database = next(t for d in build_asset_tree(pd.DataFrame(rows), names) for s in d["schemas"] for t in s["tables"] if t["table"] == "orders")
    assert "column_kinds" not in database and "column_labels" not in database    # a database table has neither


def test_a_tile_whose_only_name_is_its_own_id_has_no_name(tmp_path):
    # A crawl names a tile with no title by its id (a real one: 40 of 220); the scan leaves the title out or repeats the id.
    snap = make_crawl(tmp_path)
    _write(snap, "tile", [
        {"tile_urn": "/d1/t1", "tile_name": "Revenue tile", "dashboard_urn": "/d1"},
        {"tile_urn": "/d1/bcb5fc8b-4902-45ac-bb5f-10b208d3fe19", "tile_name": "bcb5fc8b-4902-45ac-bb5f-10b208d3fe19", "dashboard_urn": "/d1"},
    ])
    assert load_names(snap).tiles == {("d1", "t1"): "Revenue tile"}

    scan = write_scan(tmp_path / "bundle")
    page = json.loads(pd.read_parquet(scan)["response"].iloc[0])
    page["workspaces"][0]["dashboards"][0]["tiles"] += [{"id": "t2", "title": "t2"}, {"id": "t3"}]
    pd.DataFrame({"response": [json.dumps(page)]}).to_parquet(scan)
    assert load_scan_names(scan).tiles == {("d1", "t1"): "Scanned Tile"}


def test_merging_names_keeps_the_fields_and_measures_of_the_fallback():
    scan = BiNames(path="scan", members={"m1": {"a": "A"}})
    assert BiNames(path="crawl").merged_with(scan).members == {"m1": {"a": "A"}}
    assert BiNames(path="crawl", members={"m1": {"a": "mine"}}).merged_with(scan).members == {"m1": {"a": "mine"}}


def test_graph_names_the_fields_and_measures_inside_a_model_from_the_scan(client, tmp_path):
    bundle = make_scanner_bundle(tmp_path)
    write_scan(bundle)
    graph = client.get("/api/lineage/graph", params={"folder": str(bundle)}).json()
    members = {n["label"]: n for n in graph["nodes"] if n["type"] == "bi_member" and n["member_kind"] != "table"}
    assert set(members) == {"Sales[Amount]", "Total Amount"}
    assert members["Total Amount"]["details"][0] == {"label": "semantic_model", "value": "Scanned Model"}


def test_graph_api_reads_the_bundles_attributes_for_the_tables_in_each_model(client, tmp_path):
    from tests.test_lineage import SALES_ATTRIBUTES
    bundle = make_scanner_bundle(tmp_path)
    params = {"folder": str(bundle)}
    assert not [n for n in client.get("/api/lineage/graph", params=params).json()["nodes"] if n.get("member_kind") == "table"]   # none yet

    SALES_ATTRIBUTES.to_parquet(bundle / "lineage" / "attributes.parquet")
    tables = [n for n in client.get("/api/lineage/graph", params=params).json()["nodes"] if n.get("member_kind") == "table"]
    assert [(t["label"], t["field_count"], t["measure_count"]) for t in tables] == [("Date (UTC)", 1, 0), ("Sales", 2, 1)]

    (bundle / "lineage" / "attributes.parquet").write_bytes(b"not parquet")   # unreadable: the graph still loads, without them
    response = client.get("/api/lineage/graph", params=params)
    assert response.status_code == 200 and not [n for n in response.json()["nodes"] if n.get("member_kind") == "table"]


def test_graph_api_lists_a_models_tables_and_their_links_from_the_scanner_result_when_there_are_no_attributes(client, tmp_path):
    from tests.test_lineage import SCAN, SQL, _sem, _typed_row
    bundle = make_scanner_bundle(tmp_path)
    rows = SCANNER_ROWS + [
        _typed_row("read_by", f"{SQL}/orders", _sem(MODEL, "Sales"), "table", "table", None),
        _typed_row("read_by", f"{SQL}/orders", f"{SCAN}/semantic_model/{MODEL}", "table", "table", None),
    ]
    pd.DataFrame(rows).to_parquet(bundle / "lineage" / "edges.parquet")
    write_scan(bundle)                                       # the only source of the tables: no attributes.parquet here

    graph = client.get("/api/lineage/graph", params={"folder": str(bundle)}).json()
    nodes = {n["id"]: n for n in graph["nodes"]}
    tables = [n for n in graph["nodes"] if n.get("member_kind") == "table"]
    assert [(t["label"], t["field_count"], t["measure_count"]) for t in tables] == [("Date (UTC)", 1, 0), ("Sales", 2, 1)]
    into_tables = [(nodes[e["source"]]["full_name"], nodes[e["target"]]["label"]) for e in graph["edges"] if nodes[e["target"]].get("member_kind") == "table"]
    assert into_tables == [("ip.dbo.orders", "Sales")]       # the table-level link, not just the roll-up into the model
    assert [(nodes[e["source"]]["full_name"], nodes[e["target"]]["full_name"]) for e in graph["edges"] if e.get("summary")] == [("ip.dbo.orders", f"powerbi.{MODEL}.(model)")]


def test_the_tables_come_from_the_scanner_result_and_only_without_it_from_the_attributes(client, tmp_path):
    from tests.test_lineage import _attributes
    bundle = make_scanner_bundle(tmp_path)
    _attributes((f"/{MODEL}", "semantic_model", f"/{MODEL}/From Attributes", "semantic_table")).to_parquet(bundle / "lineage" / "attributes.parquet")

    def labels() -> list[str]:
        graph = client.get("/api/lineage/graph", params={"folder": str(bundle)}).json()
        return [n["label"] for n in graph["nodes"] if n.get("member_kind") == "table"]

    assert labels() == ["From Attributes"]                   # no scanner result
    scan = write_scan(bundle)
    assert labels() == ["Date (UTC)", "Sales"]               # the scan has the names as written
    scan.write_bytes(b"not parquet")
    assert labels() == ["From Attributes"]                   # unreadable: back to the attributes, no failure


def test_a_results_layout_scanner_result_names_the_assets_of_a_bundle(client, tmp_path):
    bundle = make_scanner_bundle(tmp_path)
    write_scan(bundle, results_layout=True)
    info = client.get("/api/lineage/bi-names", params={"folder": str(bundle)}).json()
    assert info["status"] == "bundle" and info["counts"] == {"models": 1, "reports": 1, "dashboards": 1, "tiles": 1}


def test_column_lineage_api_names_the_models_and_404s_on_an_unknown_table(client, tmp_path):
    from tests.test_lineage import COLUMN_ATTRIBUTES, COLUMN_ROWS, OTHER_MODEL
    bundle = make_scanner_bundle(tmp_path)
    lineage = bundle / "lineage"
    pd.DataFrame(COLUMN_ROWS).to_parquet(lineage / "edges.parquet")
    COLUMN_ATTRIBUTES.to_parquet(lineage / "attributes.parquet")
    write_scan(bundle)                                       # names MODEL "Scanned Model"

    ok = client.get("/api/lineage/column-lineage", params={"folder": str(bundle), "model": MODEL, "table": "Sales"})
    assert ok.status_code == 200
    body = ok.json()
    assert body["model"] == {"id": MODEL, "name": "Scanned Model"}
    assert body["fields"][0]["upstream"][0][0]["label"] == "ip.dbo.orders.amount"
    assert body["fields"][0]["downstream"][0][0]["model"] == OTHER_MODEL[:8]      # the scan does not know this model

    missing = client.get("/api/lineage/column-lineage", params={"folder": str(bundle), "model": MODEL, "table": "Nope"})
    assert missing.status_code == 404


def test_scanner_result_is_found_beside_the_lineage_folder(tmp_path):
    scan = write_scan(tmp_path)
    assert find_scan(tmp_path / "lineage") == scan
    assert find_scan(tmp_path) == scan
    assert find_scan(tmp_path / "elsewhere" / "lineage") is None     # no stage2/ beside it


def test_bundle_without_a_crawl_is_named_from_its_own_scanner_result(client, tmp_path):
    bundle = make_scanner_bundle(tmp_path)
    params = {"folder": str(bundle)}
    assert client.get("/api/lineage/bi-names", params=params).json()["status"] == "missing"     # nothing to name it from yet
    assert nodes_by_name(client.get("/api/lineage/graph", params=params).json())["powerbi.(reports).r1"]["label"] == "r1"

    scan = write_scan(bundle)
    info = client.get("/api/lineage/bi-names", params=params).json()
    assert info["status"] == "bundle" and info["path"] is None and info["scan_path"] == str(scan)
    assert info["counts"] == {"models": 1, "reports": 1, "dashboards": 1, "tiles": 1}      # the report without a name is not counted
    nodes = nodes_by_name(client.get("/api/lineage/graph", params=params).json())
    assert nodes[f"powerbi.{MODEL}.(model)"]["label"] == "Scanned Model"
    assert nodes["powerbi.(reports).r1"]["label"] == "Scanned Report"
    assert nodes["powerbi.(dashboards).d1"]["label"] == "Scanned Dashboard"
    assert nodes["powerbi.(tiles).t1"]["label"] == "Scanned Tile"
    assert nodes["powerbi.(tiles).t1"]["details"] == [{"label": "dashboard", "value": "Scanned Dashboard"}, {"label": "workspace", "value": "Scan WS"}]


def test_a_chosen_crawl_beats_the_scanner_result_which_fills_in_what_it_lacks(client, tmp_path):
    bundle = make_scanner_bundle(tmp_path)
    write_scan(bundle)
    snap = make_crawl(tmp_path)    # names m1/m2/r1/d1/t1 only: of the live ids it knows r1, d1 and t1 (not MODEL)
    _write(snap, "semantic_model", [{"semantic_model_urn": "/other-model", "semantic_model_name": "Crawl Model", "container_urn": "/w1"}])
    params = {"folder": str(bundle), "crawl": str(snap)}
    info = client.get("/api/lineage/bi-names", params=params).json()
    assert info["status"] == "manual" and info["path"] == str(snap) and info["scan_path"].endswith("powerbi_scan_result.parquet")
    nodes = nodes_by_name(client.get("/api/lineage/graph", params=params).json())
    assert nodes["powerbi.(reports).r1"]["label"] == "Sales Report"                # the crawl's name wins
    assert nodes["powerbi.(dashboards).d1"]["label"] == "Exec Dashboard"
    assert nodes[f"powerbi.{MODEL}.(model)"]["label"] == "Scanned Model"          # not in the crawl: the scanner result names it


def test_an_invalid_crawl_keeps_the_bundles_own_names_but_is_reported(client, tmp_path):
    bundle = make_scanner_bundle(tmp_path)
    write_scan(bundle)
    params = {"folder": str(bundle), "crawl": str(tmp_path / "nope")}
    info = client.get("/api/lineage/bi-names", params=params).json()
    assert info["status"] == "invalid" and "not found" in info["message"].lower() and info["scan_path"]
    assert info["counts"]["reports"] == 1
    assert nodes_by_name(client.get("/api/lineage/graph", params=params).json())["powerbi.(reports).r1"]["label"] == "Scanned Report"


def test_an_unreadable_scanner_result_is_ignored(client, tmp_path):
    bundle = make_scanner_bundle(tmp_path)
    (bundle / "stage2").mkdir()
    pd.DataFrame({"not_response": ["x"]}).to_parquet(bundle / "stage2" / "powerbi_scan_result.parquet")
    assert client.get("/api/lineage/bi-names", params={"folder": str(bundle)}).json()["status"] == "missing"


def test_live_scanner_bundle_is_named_from_a_crawl_chosen_by_hand(client, tmp_path):
    # its connectionId matches no crawl folder (as with the real live-scanner bundles), so the crawl is chosen by hand
    bundle = tmp_path / "bundle" / "lineage"
    bundle.mkdir(parents=True)
    pd.DataFrame(SCANNER_ROWS).to_parquet(bundle / "edges.parquet")
    pd.DataFrame([{"process_fqn": "/pbsys/dataprocess/refresh", "process_name": "REFRESH", "query_type": "POWERBI_REFRESH"}]).to_parquet(bundle / "processes.parquet")
    (bundle / "manifest.json").write_text(json.dumps({"connectionId": "LIVE-POWERBI-SP"}))
    make_crawl(tmp_path)   # the crawl of another connection, with its own ids
    snap = tmp_path / "crawl-metadata" / "powerbi" / CONNECTION / "crawl-a" / SNAPSHOT
    _write(snap, "semantic_model", [{"semantic_model_urn": f"/{MODEL}", "semantic_model_name": "Live Model", "container_urn": "/w1"}])

    params = {"folder": str(bundle.parent)}
    assert client.get("/api/lineage/bi-names", params=params).json()["status"] == "missing"
    assert client.get("/api/lineage/summary", params=params).json()["bi_assets"]["dashboards"] == 1

    params["crawl"] = str(tmp_path / "crawl-metadata")
    assert client.get("/api/lineage/bi-names", params=params).json()["status"] == "manual"
    graph = client.get("/api/lineage/graph", params=params).json()
    assert nodes_by_name(graph)[f"powerbi.{MODEL}.(model)"]["label"] == "Live Model"
    assert nodes_by_name(graph)["powerbi.(dashboards).d1"]["label"] == "Exec Dashboard"

