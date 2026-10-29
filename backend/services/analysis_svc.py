from __future__ import annotations

import logging
import math
from collections import Counter
from pathlib import Path
from typing import Any

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


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

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

    for col in ("source_fqn", "target_fqn"):
        if col not in edges_df.columns:
            continue
        for raw in edges_df[col].dropna().unique():
            p = parse_fqn(str(raw))
            t = p["type"]
            if t not in ("column", "table"):
                continue
            if "system" in p:
                systems.add(p["system"])
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

    return {
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


# ---------------------------------------------------------------------------
# Asset tree
# ---------------------------------------------------------------------------

def build_asset_tree(edges_df: pd.DataFrame) -> list[dict[str, Any]]:
    table_data: dict[tuple, dict] = {}
    has_process = "process_fqn" in edges_df.columns

    for col, role in (("source_fqn", "source"), ("target_fqn", "target")):
        if col not in edges_df.columns:
            continue
        cols = [col, "process_fqn"] if has_process else [col]
        for row in edges_df[cols].dropna(subset=[col]).itertuples(index=False):
            p = parse_fqn(str(row[0]))
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
            if has_process and pd.notna(row[1]):
                table_data[key][f"{role}_processes"].add(str(row[1]))

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

    cols = [c for c in ("source_fqn", "target_fqn", "process_fqn") if c in edges_df.columns]
    for row in edges_df[cols].dropna(subset=["process_fqn"]).itertuples(index=False):
        proc = str(row.process_fqn)
        if "source_fqn" in cols and pd.notna(row.source_fqn):
            src = parse_fqn(str(row.source_fqn))
            if src["type"] in ("column", "table"):
                proc_inputs.setdefault(proc, []).append(_table_key(src))
        if "target_fqn" in cols and pd.notna(row.target_fqn):
            tgt = parse_fqn(str(row.target_fqn))
            if tgt["type"] in ("column", "table"):
                proc_outputs.setdefault(proc, []).append(_table_key(tgt))
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
            p = parse_fqn(str(fqn))
            if p["type"] in ("column", "table"):
                keys.add(_table_key(p))
    return keys


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


def _table_node(node_id: str, key: str, view_keys: set[str]) -> dict[str, Any]:
    parts = key.split(".")
    return {
        "id": node_id,
        "type": "table",
        "full_name": key,
        "label": parts[-1] if parts else key,
        "is_view": key in view_keys,
    }


def get_lineage_graph(edges_df: pd.DataFrame, processes_df: pd.DataFrame | None = None) -> dict[str, Any]:
    """Builds a node/edge graph for visualizing lineage end-to-end: table
    nodes and process nodes, connected by directed table->process ("input")
    and process->table ("output") edges — the actual step-by-step path data
    takes, not just an aggregated table-to-table summary (see get_flow_pairs
    for that view).
    """
    proc_inputs, proc_outputs = _process_io(edges_df)
    view_keys = _view_table_keys(edges_df)

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
    nodes: list[dict] = []
    counter = 0

    def get_table_id(key: str) -> str:
        nonlocal counter
        if key not in table_ids:
            table_ids[key] = f"n{counter}"
            counter += 1
            nodes.append(_table_node(table_ids[key], key, view_keys))
        return table_ids[key]

    def get_process_id(proc: str) -> str:
        nonlocal counter
        if proc not in process_ids:
            process_ids[proc] = f"n{counter}"
            counter += 1
            meta = proc_meta.get(proc, {})
            nodes.append({
                "id": process_ids[proc],
                "type": "process",
                "process_fqn": proc,
                "label": meta.get("process_name") or proc.rsplit("/", 1)[-1][:12],
                "query_type": meta.get("query_type"),
                "process_code": meta.get("process_code"),
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
        proc_id = get_process_id(proc)
        for tbl in set(proc_inputs.get(proc, [])):
            add_edge(get_table_id(tbl), proc_id, "input")
        for tbl in set(proc_outputs.get(proc, [])):
            add_edge(proc_id, get_table_id(tbl), "output")

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
    pair_columns: dict[tuple[str, str], set[tuple[str, str]]] = {}
    for row in mapped[["source_fqn", "target_fqn"]].dropna().itertuples(index=False):
        src, tgt = parse_fqn(str(row.source_fqn)), parse_fqn(str(row.target_fqn))
        if src["type"] not in ("column", "table") or tgt["type"] not in ("column", "table"):
            continue
        src_key, tgt_key = _table_key(src), _table_key(tgt)
        if src_key == tgt_key:
            continue
        columns = pair_columns.setdefault((src_key, tgt_key), set())
        if src["type"] == "column" and tgt["type"] == "column":
            columns.add((src["column"], tgt["column"]))

    view_keys = _view_table_keys(edges_df)
    table_ids: dict[str, str] = {}
    nodes: list[dict] = []

    def get_table_id(key: str) -> str:
        if key not in table_ids:
            table_ids[key] = f"n{len(table_ids)}"
            nodes.append(_table_node(table_ids[key], key, view_keys))
        return table_ids[key]

    edges = [
        {"source": get_table_id(src_key), "target": get_table_id(tgt_key), "kind": "mapping", "column_count": len(columns)}
        for (src_key, tgt_key), columns in pair_columns.items()
    ]
    return {"nodes": nodes, "edges": edges}
