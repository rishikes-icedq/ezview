from __future__ import annotations

import logging
import math
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import pandas as pd

from services.parquet_svc import read_df

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# FQN parsing
# ---------------------------------------------------------------------------

def parse_fqn(fqn: str) -> dict[str, Any]:
    if not fqn:
        return {"type": "unresolved", "raw": fqn}
    s = str(fqn).strip()
    if s.upper().startswith("UNRESOLVED") or not s.startswith("/"):
        return {"type": "unresolved", "raw": s}

    parts = [p for p in s.split("/") if p]
    if len(parts) < 2:
        return {"type": "unresolved", "raw": s}

    system = parts[0]
    rest = parts[1:]

    if rest[0].lower() == "dataprocess":
        return {
            "type": "dataprocess",
            "system": system,
            "process_id": rest[1] if len(rest) > 1 else "",
            "raw": s,
        }
    # Newer bundles put the platform in front: /system/platform/dataprocess/hash.
    if len(rest) == 3 and rest[1].lower() == "dataprocess":
        return {"type": "dataprocess", "system": system, "platform": rest[0], "process_id": rest[2], "raw": s}

    # The pipeline inserts an explicit platform segment right after the
    # system name: /system/platform/database/schema/table[/column] — one
    # level deeper than a bare /system/database/schema/table[/column].
    if len(rest) == 5:
        return {"type": "column", "system": system, "platform": rest[0], "database": rest[1],
                "schema": rest[2], "table": rest[3], "column": rest[4], "raw": s}
    if len(rest) == 4:
        return {"type": "table", "system": system, "platform": rest[0], "database": rest[1],
                "schema": rest[2], "table": rest[3], "raw": s}
    if len(rest) == 3:
        return {"type": "schema", "system": system, "platform": rest[0], "database": rest[1],
                "schema": rest[2], "raw": s}
    if len(rest) == 2:
        return {"type": "database", "system": system, "platform": rest[0], "database": rest[1], "raw": s}

    return {"type": "unresolved", "raw": s}


# Endpoints the pipeline tags with one of these are never tables/views/columns,
# even when their FQN is the same depth as one — e.g. a stored procedure's FQN is
# /system/platform/database/schema/name, which parse_fqn reads as a table.
_NON_TABLE_TYPES = {"dataprocess", "stored_procedure"}


def _asset_side_rows(edges_df: pd.DataFrame, side: str) -> pd.DataFrame:
    """`edges_df` without the rows whose `side` ("source"/"target") endpoint is
    tagged (via <side>_type) as a process or stored procedure rather than a
    table/view/column. Returns it unchanged if the type column is absent."""
    type_col = f"{side}_type"
    if type_col not in edges_df.columns:
        return edges_df
    return edges_df[~edges_df[type_col].astype(str).str.lower().isin(_NON_TABLE_TYPES)]


# ---------------------------------------------------------------------------
# Type-aware endpoint parsing (Power BI)
# ---------------------------------------------------------------------------
#
# parse_fqn reads an FQN purely by depth (db/schema/table/column). A Power BI
# bundle breaks that: its assets are /system/powerbi/<model or report id>/…, at
# depths that collide with database objects (a field parses as a "table" whose
# "database" is a model GUID, a measure/tile/data-table as a "schema", a model or
# report as a "database"). The endpoint's own source_type/target_type tag is the
# only reliable signal, so parse_asset takes it into account.
#
# Every Power BI asset is mapped onto the same database/schema/table[/column]
# shape the rest of the analysis already works with, so a field rolls up into its
# data table and a measure into its model just as a column rolls up into a table:
#
#   bitable   /sys/powerbi/<model>/<table>            powerbi . <model>     . <table>
#   bifield   /sys/powerbi/<model>/<table>/<field>    …same table, column = field
#   bimodel   /sys/powerbi/<model>                    powerbi . <model>     . (model)
#   bimeasure /sys/powerbi/<model>/<measure>          …the model, column = measure
#   bireport  /sys/powerbi/<report>                   powerbi . (reports)   . <report>
#   bitile    /sys/powerbi/<dashboard>/<tile>         powerbi . <dashboard> . <tile>
#
# ("powerbi" is the FQN's own platform segment.)

_BI_ASSET_TYPES = {"bimodel", "bireport", "bitile", "bitable", "bifield", "bimeasure"}
_BI_MODEL_TABLE = "(model)"
_BI_REPORTS_SCHEMA = "(reports)"
# Segments after the platform that each Power BI type has, and the node kind it rolls up to.
_BI_SHAPE: dict[str, tuple[int, str]] = {
    "bimodel": (1, "bimodel"),
    "bimeasure": (2, "bimodel"),
    "bireport": (1, "bireport"),
    "bitile": (2, "bitile"),
    "bitable": (2, "bitable"),
    "bifield": (3, "bitable"),
}


def _decode_names(parsed: dict[str, Any]) -> dict[str, Any]:
    """Pipeline FQNs percent-encode names ("Dim%20-%20Date"); show them as written."""
    for field in ("database", "schema", "table", "column"):
        if field in parsed:
            parsed[field] = unquote(parsed[field])
    return parsed


def parse_asset(fqn: str, type_tag: Any = None) -> dict[str, Any]:
    """parse_fqn for an edge endpoint, given that endpoint's source_type/target_type.

    Same result shape as parse_fqn (type is "column", "table", … , database/schema/
    table/column names percent-decoded), plus `asset_type` for Power BI assets: the
    kind of node the asset rolls up to ("bitable", "bimodel", "bireport", "bitile").
    """
    tag = str(type_tag or "").strip().lower()
    if tag not in _BI_ASSET_TYPES:
        return _decode_names(parse_fqn(fqn))

    unresolved = {"type": "unresolved", "raw": fqn}
    s = str(fqn or "").strip()
    parts = [p for p in s.split("/") if p] if s.startswith("/") else []
    expected, asset_type = _BI_SHAPE[tag]
    if len(parts) != 2 + expected:
        return unresolved
    system, platform, *names = parts

    base = {"system": system, "platform": platform, "raw": s, "asset_type": asset_type}
    if tag in ("bimodel", "bimeasure"):
        base.update(database=platform, schema=names[0], table=_BI_MODEL_TABLE)
    elif tag == "bireport":
        base.update(database=platform, schema=_BI_REPORTS_SCHEMA, table=names[0])
    else:  # bitable, bitile, bifield: <parent>/<table>[/<field>]
        base.update(database=platform, schema=names[0], table=names[1])
    if tag in ("bimeasure", "bifield"):
        return _decode_names({**base, "type": "column", "column": names[-1]})
    return _decode_names({**base, "type": "table"})


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

def _side_records(edges_df: pd.DataFrame, side: str, extra: tuple[str, ...] = ()) -> pd.DataFrame:
    """The `side` ("source"/"target") endpoints of `edges_df` that can be an asset,
    as a frame with columns `fqn`, `tag` (the endpoint's <side>_type, None if the
    bundle has no such column) and any `extra` edge columns (None where absent).
    Rows without an FQN are dropped."""
    fqn_col, type_col = f"{side}_fqn", f"{side}_type"
    if fqn_col not in edges_df.columns:
        return pd.DataFrame({"fqn": [], "tag": [], **{c: [] for c in extra}})
    rows = _asset_side_rows(edges_df, side)
    frame = pd.DataFrame({
        "fqn": rows[fqn_col],
        "tag": rows[type_col] if type_col in rows.columns else None,
        **{c: rows[c] if c in rows.columns else None for c in extra},
    })
    return frame.dropna(subset=["fqn"])


def compute_summary(
    edges_df: pd.DataFrame,
    processes_df: pd.DataFrame,
    manifest: dict | None = None,
) -> dict[str, Any]:

    databases: set[str] = set()
    schemas: set[str] = set()
    tables: set[str] = set()
    columns: set[str] = set()
    systems: set[str] = set()
    # Power BI assets, counted on their own: they are not database objects.
    bi_models: set[str] = set()
    bi_reports: set[str] = set()
    bi_tiles: set[tuple] = set()
    bi_tables: set[tuple] = set()
    bi_fields: set[tuple] = set()
    bi_measures: set[tuple] = set()

    for side in ("source", "target"):
        for raw, tag in _side_records(edges_df, side).drop_duplicates(["fqn", "tag"]).itertuples(index=False):
            p = parse_asset(str(raw), tag)
            t = p["type"]
            if t not in ("column", "table"):
                continue
            if "system" in p:
                systems.add(p["system"])
            asset = p.get("asset_type")
            if asset:
                ids = (p["schema"], p["table"])
                if asset == "bimodel":
                    bi_models.add(p["schema"])
                    if t == "column":
                        bi_measures.add((p["schema"], p["column"]))
                elif asset == "bireport":
                    bi_reports.add(p["table"])
                elif asset == "bitile":
                    bi_tiles.add(ids)
                else:
                    bi_tables.add(ids)
                    if t == "column":
                        bi_fields.add((*ids, p["column"]))
                continue
            if "database" in p:
                databases.add(p["database"])
            if "schema" in p:
                schemas.add(f"{p['database']}.{p['schema']}")
            if "table" in p:
                tables.add(f"{p['database']}.{p['schema']}.{p['table']}")
            if t == "column" and "column" in p:
                columns.add(f"{p['database']}.{p['schema']}.{p['table']}.{p['column']}")

    def dist(df: pd.DataFrame, col: str) -> dict[str, int]:
        if col not in df.columns:
            return {}
        return {str(k): int(v) for k, v in df[col].value_counts().items()}

    summary = {
        "total_processes": int(len(processes_df)),
        "total_edges": int(len(edges_df)),
        "unique_databases": len(databases),
        "unique_schemas": len(schemas),
        "unique_tables": len(tables),
        "unique_columns": len(columns),
        "system_names": sorted(systems),
        "confidence_distribution": dist(edges_df, "confidence"),
        "transform_type_distribution": dist(edges_df, "transform_type"),
        "edge_direction_distribution": dist(edges_df, "edge"),
        "resolution_type_distribution": dist(edges_df, "resolution_type"),
        "source_type_distribution": dist(edges_df, "source_type"),
        "target_type_distribution": dist(edges_df, "target_type"),
        "query_type_distribution": dist(processes_df, "query_type"),
        "manifest": manifest,
    }
    bi_assets = {
        "models": len(bi_models), "reports": len(bi_reports), "tiles": len(bi_tiles),
        "tables": len(bi_tables), "fields": len(bi_fields), "measures": len(bi_measures),
    }
    if any(bi_assets.values()):
        summary["bi_assets"] = bi_assets
    return summary


# ---------------------------------------------------------------------------
# Asset tree
# ---------------------------------------------------------------------------

def build_asset_tree(edges_df: pd.DataFrame) -> list[dict[str, Any]]:
    table_data: dict[tuple, dict] = {}

    for role in ("source", "target"):
        for fqn, tag, proc in _side_records(edges_df, role, ("process_fqn",)).itertuples(index=False):
            p = parse_asset(str(fqn), tag)
            if p["type"] not in ("column", "table"):
                continue
            key = (p.get("database", ""), p.get("schema", ""), p.get("table", ""))
            if key not in table_data:
                table_data[key] = {
                    "source": 0, "target": 0, "columns": set(),
                    "source_processes": set(), "target_processes": set(),
                }
            table_data[key][role] += 1
            if p["type"] == "column":
                table_data[key]["columns"].add(p.get("column", ""))
            if pd.notna(proc):
                table_data[key][f"{role}_processes"].add(str(proc))

    db_map: dict[str, dict[str, list]] = {}
    for (db, schema, table), data in table_data.items():
        db_map.setdefault(db, {}).setdefault(schema, [])
        db_map[db][schema].append({
            "table": table,
            "column_count": len(data["columns"]),
            "columns": sorted(data["columns"]),
            "as_source": data["source"],
            "as_target": data["target"],
            "source_process_count": len(data["source_processes"]),
            "target_process_count": len(data["target_processes"]),
        })

    result = []
    for db in sorted(db_map):
        schemas_list = []
        for schema in sorted(db_map[db]):
            tables = sorted(db_map[db][schema], key=lambda t: t["table"])
            schemas_list.append({"schema": schema, "table_count": len(tables), "tables": tables})
        result.append({
            "database": db,
            "schema_count": len(schemas_list),
            "table_count": sum(len(db_map[db][s]) for s in db_map[db]),
            "schemas": schemas_list,
        })
    return result


# ---------------------------------------------------------------------------
# Edge page (server-side filter + paginate)
# ---------------------------------------------------------------------------

_EDGE_SORT_COLUMNS = {"source_fqn", "target_fqn"}


def get_edge_page(
    edges_df: pd.DataFrame,
    page: int = 1,
    page_size: int = 100,
    confidence: str | None = None,
    transform: str | None = None,
    direction: str | None = None,
    source_type: str | None = None,
    target_type: str | None = None,
    source_search: str | None = None,
    target_search: str | None = None,
    sort_by: str | None = None,
    sort_dir: str = "asc",
) -> dict[str, Any]:
    df = edges_df.copy()
    if confidence and "confidence" in df.columns:
        df = df[df["confidence"] == confidence]
    if transform and "transform_type" in df.columns:
        df = df[df["transform_type"] == transform]
    if direction and "edge" in df.columns:
        df = df[df["edge"] == direction]
    if source_type and "source_type" in df.columns:
        df = df[df["source_type"] == source_type]
    if target_type and "target_type" in df.columns:
        df = df[df["target_type"] == target_type]
    if source_search and "source_fqn" in df.columns:
        df = df[df["source_fqn"].str.contains(source_search, case=False, na=False, regex=False)]
    if target_search and "target_fqn" in df.columns:
        df = df[df["target_fqn"].str.contains(target_search, case=False, na=False, regex=False)]

    if sort_by in _EDGE_SORT_COLUMNS and sort_by in df.columns:
        df = df.sort_values(
            by=sort_by,
            ascending=(sort_dir != "desc"),
            key=lambda col: col.str.lower(),
            na_position="last",
        )

    total = len(df)
    page_size = min(max(1, page_size), 500)
    total_pages = max(1, math.ceil(total / page_size))
    page = max(1, min(page, total_pages))

    start = (page - 1) * page_size
    rows = df.iloc[start : start + page_size].fillna("").to_dict(orient="records")

    return {
        "rows": [{k: str(v) if not isinstance(v, (str, int, float, bool, type(None))) else v
                  for k, v in r.items()} for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "confidence_options": sorted(
            [str(v) for v in edges_df["confidence"].dropna().unique()]
        ) if "confidence" in edges_df.columns else [],
        "transform_options": sorted(
            [str(v) for v in edges_df["transform_type"].dropna().unique()]
        ) if "transform_type" in edges_df.columns else [],
        "direction_options": sorted(
            [str(v) for v in edges_df["edge"].dropna().unique()]
        ) if "edge" in edges_df.columns else [],
        "source_type_options": sorted(
            [str(v) for v in edges_df["source_type"].dropna().unique()]
        ) if "source_type" in edges_df.columns else [],
        "target_type_options": sorted(
            [str(v) for v in edges_df["target_type"].dropna().unique()]
        ) if "target_type" in edges_df.columns else [],
    }


# ---------------------------------------------------------------------------
# Processes list
# ---------------------------------------------------------------------------

def get_processes(processes_df: pd.DataFrame) -> list[dict[str, Any]]:
    records = []
    for row in processes_df.fillna("").to_dict(orient="records"):
        records.append({k: str(v) if not isinstance(v, (str, int, float, bool)) else v
                        for k, v in row.items()})
    return records


# ---------------------------------------------------------------------------
# Data flow pairs
# ---------------------------------------------------------------------------

def _table_key(p: dict) -> str:
    return f"{p.get('database','')}.{p.get('schema','')}.{p.get('table','')}"


def _process_io(edges_df: pd.DataFrame) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """For each process_fqn, collects the table keys touched as inputs
    (resolved column/table on the source side of any of its edges) and
    outputs (resolved column/table on the target side).

    Pipelines model direct vs. process-mediated flow differently — some
    encode a "writes_to" edge as a direct column-to-column copy with
    process_fqn as a sidecar column, others split it into a "read_by"
    column->process edge plus a "writes_to" process->column edge (with a
    separate "maps_to" for direct copies). Rather than assume one convention,
    this classifies each edge's source/target purely by whether it resolves
    to a real column/table: any such side occurring in a row sharing a
    process_fqn contributes to that process's input or output table set.
    """
    proc_inputs: dict[str, list[str]] = {}
    proc_outputs: dict[str, list[str]] = {}
    if "process_fqn" not in edges_df.columns:
        return proc_inputs, proc_outputs

    for side, bucket in (("source", proc_inputs), ("target", proc_outputs)):
        rows = _side_records(edges_df, side, ("process_fqn",)).dropna(subset=["process_fqn"])
        for fqn, tag, proc in rows.itertuples(index=False):
            parsed = parse_asset(str(fqn), tag)
            if parsed["type"] in ("column", "table"):
                bucket.setdefault(str(proc), []).append(_table_key(parsed))
    return proc_inputs, proc_outputs


def _view_table_keys(edges_df: pd.DataFrame) -> set[str]:
    """Table keys (see _table_key) the pipeline tags as views. A view's FQN is
    the same depth as a table's, so parse_fqn can't tell them apart — the edges'
    own source_type/target_type columns ("view" vs "table") are the only signal.
    """
    keys: set[str] = set()
    for fqn_col, type_col in (("source_fqn", "source_type"), ("target_fqn", "target_type")):
        if fqn_col not in edges_df.columns or type_col not in edges_df.columns:
            continue
        tagged = edges_df.loc[edges_df[type_col].astype(str).str.lower() == "view", fqn_col].dropna()
        for fqn in tagged.unique():
            p = parse_asset(str(fqn))
            if p["type"] in ("column", "table"):
                keys.add(_table_key(p))
    return keys


def _bi_node_kinds(edges_df: pd.DataFrame) -> dict[str, str]:
    """Table key -> kind ("bitable", "bimodel", "bireport", "bitile") for every
    Power BI asset in the bundle. Fields roll up into their data table and measures
    into their model, so those two kinds also cover them."""
    kinds: dict[str, str] = {}
    for side in ("source", "target"):
        records = _side_records(edges_df, side)
        for fqn, tag in records[records["tag"].astype(str).str.lower().isin(_BI_ASSET_TYPES)].drop_duplicates().itertuples(index=False):
            p = parse_asset(str(fqn), tag)
            if p["type"] in ("column", "table"):
                kinds[_table_key(p)] = p["asset_type"]
    return kinds


def _unmediated_bi_links(edges_df: pd.DataFrame, bi_kinds: dict[str, str]) -> set[tuple[str, str]]:
    """(source table key, target table key) pairs for Power BI links that no data
    process sits in the middle of: model -> report/tile, report -> tile, a data
    table's fields -> the measures computed from them, a source table -> the model
    that reads it. Fields and measures roll up into their table/model, so a link
    between two assets inside one table or model is dropped.

    Every data table also feeds the model it belongs to. The bundle only says so
    for tables whose fields a measure uses; the rest is implied by the FQN
    (/sys/powerbi/<model>/<table>), and without it most tables would dead-end
    before the model and its reports."""
    links: set[tuple[str, str]] = set()
    for key, kind in bi_kinds.items():
        if kind == "bitable":
            platform, model, _ = key.split(".", 2)
            model_key = f"{platform}.{model}.{_BI_MODEL_TABLE}"
            if bi_kinds.get(model_key) == "bimodel":
                links.add((key, model_key))

    needed = {"source_fqn", "source_type", "target_fqn", "target_type"}
    if not needed <= set(edges_df.columns):
        return links
    bi = lambda col: edges_df[col].astype(str).str.lower().isin(_BI_ASSET_TYPES)  # noqa: E731
    unmediated = edges_df["process_fqn"].isna() if "process_fqn" in edges_df.columns else True
    rows = edges_df[unmediated & (bi("source_type") | bi("target_type"))]

    for src, src_tag, tgt, tgt_tag in rows[["source_fqn", "source_type", "target_fqn", "target_type"]].dropna(subset=["source_fqn", "target_fqn"]).itertuples(index=False):
        a, b = parse_asset(str(src), src_tag), parse_asset(str(tgt), tgt_tag)
        if a["type"] in ("column", "table") and b["type"] in ("column", "table") and _table_key(a) != _table_key(b):
            links.add((_table_key(a), _table_key(b)))
    return links


def _last_segment(fqn: str) -> str:
    return str(fqn).rstrip("/").rsplit("/", 1)[-1]


def _stored_procedure_links(edges_df: pd.DataFrame) -> tuple[dict[str, list[str]], list[tuple[str, str]]]:
    """Stored-procedure structure, from the two edge labels that describe it.

    Returns (process_fqn -> FQNs of the stored procedures that ran it, ordered
    (caller FQN, callee FQN) pairs). A `contextualizes` edge runs from a stored
    procedure to a data process it produced — one procedure can have several —
    and a `calls` edge from a procedure to another procedure it invokes. `calls`
    edges carry no process_fqn: a procedure that only calls others runs no
    process of its own.
    """
    sp_of_process: dict[str, list[str]] = {}
    calls: list[tuple[str, str]] = []
    if "edge" not in edges_df.columns:
        return sp_of_process, calls
    label = edges_df["edge"].astype(str).str.lower()

    if {"source_fqn", "process_fqn"} <= set(edges_df.columns):
        linked = edges_df.loc[label == "contextualizes", ["source_fqn", "process_fqn"]].dropna()
        for sp, proc in linked.itertuples(index=False):
            procedures = sp_of_process.setdefault(str(proc), [])
            if str(sp) not in procedures:
                procedures.append(str(sp))

    if {"source_fqn", "target_fqn"} <= set(edges_df.columns):
        called = edges_df.loc[label == "calls", ["source_fqn", "target_fqn"]].dropna()
        for caller, callee in called.itertuples(index=False):
            pair = (str(caller), str(callee))
            if pair[0] != pair[1] and pair not in calls:
                calls.append(pair)
    return sp_of_process, calls


def get_flow_pairs(edges_df: pd.DataFrame) -> list[dict[str, Any]]:
    """Aggregates table-to-table data flow, derived through each process's
    inputs and outputs (see _process_io) rather than by filtering on a
    specific "edge" label.
    """
    proc_inputs, proc_outputs = _process_io(edges_df)

    pairs: dict[tuple, dict] = {}
    for proc, outputs in proc_outputs.items():
        inputs = proc_inputs.get(proc)
        if not inputs:
            continue
        input_counts = Counter(inputs)
        output_counts = Counter(outputs)
        for src_table in input_counts:
            for tgt_table in output_counts:
                if src_table == tgt_table:
                    continue
                key = (src_table, tgt_table)
                entry = pairs.setdefault(key, {"source_table": src_table, "target_table": tgt_table, "edge_count": 0, "processes": set()})
                entry["edge_count"] += input_counts[src_table] + output_counts[tgt_table]
                entry["processes"].add(proc)

    return [
        {
            "source_table": p["source_table"],
            "target_table": p["target_table"],
            "edge_count": p["edge_count"],
            "process_count": len(p["processes"]),
        }
        for p in sorted(pairs.values(), key=lambda x: -x["edge_count"])
    ]


_BI_LABEL_PREFIX = {"bimodel": "Model", "bireport": "Report", "bitile": "Tile"}


def _bi_label(kind: str, key: str) -> str:
    """Display name for a Power BI node. Models, reports and tiles are only known by
    GUID, so they show the kind and the start of the GUID (the full key is the
    node's tooltip); a data table shows its own name."""
    parent, name = (key.split(".", 2) + ["", ""])[1:3]
    if kind == "bitable":
        return name
    return f"{_BI_LABEL_PREFIX[kind]} {(parent if kind == 'bimodel' else name)[:8]}"


def _table_node(node_id: str, key: str, view_keys: set[str], bi_kinds: dict[str, str] | None = None) -> dict[str, Any]:
    parts = key.split(".")
    node = {
        "id": node_id,
        "type": "table",
        "full_name": key,
        "label": parts[-1] if parts else key,
        "is_view": key in view_keys,
    }
    kind = (bi_kinds or {}).get(key)
    if kind:
        node["asset_type"] = kind
        node["label"] = _bi_label(kind, key)
    return node


def get_lineage_graph(edges_df: pd.DataFrame, processes_df: pd.DataFrame | None = None) -> dict[str, Any]:
    """Builds a node/edge graph for visualizing lineage end-to-end: table
    nodes and process nodes, connected by directed table->process ("input")
    and process->table ("output") edges — the actual step-by-step path data
    takes, not just an aggregated table-to-table summary (see get_flow_pairs
    for that view).

    Views have no data process: the pipeline records a view's `maps_to` edges
    with the view's own FQN as their process_fqn. Rather than draw that as a
    bogus process node between the view and its sources, each source is linked
    straight to the view with a "direct" edge.

    Power BI assets (tagged bimodel/bireport/bitile/bitable/bifield/bimeasure; see
    parse_asset) are table nodes with an `asset_type`: fields roll up into their data
    table and measures into their model. Their read links have no process, so they
    are drawn as "uses" edges (upstream asset -> asset built on it), alongside the
    ordinary input/output edges of the SQL processes that load the data tables.

    Stored procedures are assets of their own: each becomes a "stored_procedure"
    node that contains the processes it ran (a process node's `parent_id` is its
    procedure's node id, per the `contextualizes` edges), and a procedure that
    invokes another is linked to it with a "calls" edge. The table<->process
    edges stay attached to the processes themselves, so a client can fold them
    onto the container when it is collapsed.
    """
    proc_inputs, proc_outputs = _process_io(edges_df)
    view_keys = _view_table_keys(edges_df)
    bi_kinds = _bi_node_kinds(edges_df)
    sp_of_process, sp_calls = _stored_procedure_links(edges_df)

    proc_meta: dict[str, dict] = {}
    if processes_df is not None and "process_fqn" in processes_df.columns:
        for row in processes_df.to_dict(orient="records"):
            pf = row.get("process_fqn")
            if pf:
                proc_meta[str(pf)] = row

    # Node ids are opaque sequential tokens ("n0", "n1", ...) rather than the
    # raw FQN/table key — the real identifiers (full_name / process_fqn) can
    # contain "/", ".", ":" which are unsafe to use as DOM/SVG element ids.
    table_ids: dict[str, str] = {}
    process_ids: dict[str, str] = {}
    sp_ids: dict[str, str] = {}
    nodes: list[dict] = []
    counter = 0

    def get_table_id(key: str) -> str:
        nonlocal counter
        if key not in table_ids:
            table_ids[key] = f"n{counter}"
            counter += 1
            nodes.append(_table_node(table_ids[key], key, view_keys, bi_kinds))
        return table_ids[key]

    def get_sp_id(fqn: str) -> str:
        nonlocal counter
        if fqn not in sp_ids:
            sp_ids[fqn] = f"n{counter}"
            counter += 1
            parsed = parse_asset(fqn)
            nodes.append({
                "id": sp_ids[fqn],
                "type": "stored_procedure",
                "fqn": fqn,
                # database.schema.name, like a table's full_name — a stable key for the UI.
                "full_name": _table_key(parsed) if parsed["type"] in ("column", "table") else fqn,
                "label": unquote(_last_segment(fqn)),
            })
        return sp_ids[fqn]

    def get_process_id(proc: str) -> str:
        nonlocal counter
        if proc not in process_ids:
            process_ids[proc] = f"n{counter}"
            counter += 1
            meta = proc_meta.get(proc, {})
            # A process sits inside one container; if several procedures claim it, the first by FQN wins.
            owners = sorted(sp_of_process.get(proc, []))
            nodes.append({
                "id": process_ids[proc],
                "type": "process",
                "process_fqn": proc,
                "label": meta.get("process_name") or proc.rsplit("/", 1)[-1][:12],
                "process_type": meta.get("process_type"),
                "query_type": meta.get("query_type"),
                "process_code": meta.get("process_code"),
                "parent_id": get_sp_id(owners[0]) if owners else None,
            })
        return process_ids[proc]

    edges: list[dict] = []
    seen_edges: set[tuple] = set()

    def add_edge(source: str, target: str, kind: str) -> None:
        k = (source, target, kind)
        if k in seen_edges:
            return
        seen_edges.add(k)
        edges.append({"source": source, "target": target, "kind": kind})

    for proc in set(proc_inputs) | set(proc_outputs):
        if parse_fqn(proc)["type"] in ("column", "table"):
            # The "process" is itself a table/view FQN, so no real process exists.
            for src_key in set(proc_inputs.get(proc, [])):
                for tgt_key in set(proc_outputs.get(proc, [])):
                    if src_key != tgt_key:
                        add_edge(get_table_id(src_key), get_table_id(tgt_key), "direct")
            continue
        proc_id = get_process_id(proc)
        for tbl in set(proc_inputs.get(proc, [])):
            add_edge(get_table_id(tbl), proc_id, "input")
        for tbl in set(proc_outputs.get(proc, [])):
            add_edge(proc_id, get_table_id(tbl), "output")

    # Procedure -> procedure calls, drawn between the containers whether or not
    # either has processes of its own.
    for caller, callee in sp_calls:
        add_edge(get_sp_id(caller), get_sp_id(callee), "calls")

    # Power BI links with no process in between (model -> report, field -> measure, ...).
    for src_key, tgt_key in sorted(_unmediated_bi_links(edges_df, bi_kinds)):
        add_edge(get_table_id(src_key), get_table_id(tgt_key), "uses")

    return {"nodes": nodes, "edges": edges}


def get_mapping_graph(edges_df: pd.DataFrame) -> dict[str, Any]:
    """Builds the data-mapping graph: table/view nodes only, with one directed
    "mapping" edge per (source table, target table) pair linked by `maps_to`
    edges and no processes in between — "this table/view is populated from that
    one", as opposed to get_lineage_graph's step-by-step read/write path.

    `maps_to` rows come in two shapes: table->table rows (the table-level link)
    and column->column rows (the column-level detail). A pair is linked if
    either shape says so; `column_count` is how many distinct column mappings
    the column-level rows give for it (0 if only the table-level row exists).
    Mappings within a single table are dropped, as in get_flow_pairs.
    """
    if "edge" not in edges_df.columns:
        return {"nodes": [], "edges": []}

    mapped = edges_df[edges_df["edge"].astype(str).str.lower() == "maps_to"]
    for tag_col in ("source_type", "target_type"):
        if tag_col not in mapped.columns:
            mapped = mapped.assign(**{tag_col: None})
    pair_columns: dict[tuple[str, str], set[tuple[str, str]]] = {}
    for row in mapped[["source_fqn", "source_type", "target_fqn", "target_type"]].dropna(subset=["source_fqn", "target_fqn"]).itertuples(index=False):
        src, tgt = parse_asset(str(row.source_fqn), row.source_type), parse_asset(str(row.target_fqn), row.target_type)
        if src["type"] not in ("column", "table") or tgt["type"] not in ("column", "table"):
            continue
        src_key, tgt_key = _table_key(src), _table_key(tgt)
        if src_key == tgt_key:
            continue
        columns = pair_columns.setdefault((src_key, tgt_key), set())
        if src["type"] == "column" and tgt["type"] == "column":
            columns.add((src["column"], tgt["column"]))

    view_keys = _view_table_keys(edges_df)
    bi_kinds = _bi_node_kinds(edges_df)
    table_ids: dict[str, str] = {}
    nodes: list[dict] = []

    def get_table_id(key: str) -> str:
        if key not in table_ids:
            table_ids[key] = f"n{len(table_ids)}"
            nodes.append(_table_node(table_ids[key], key, view_keys, bi_kinds))
        return table_ids[key]

    edges = [
        {"source": get_table_id(src_key), "target": get_table_id(tgt_key), "kind": "mapping", "column_count": len(columns)}
        for (src_key, tgt_key), columns in pair_columns.items()
    ]
    return {"nodes": nodes, "edges": edges}
