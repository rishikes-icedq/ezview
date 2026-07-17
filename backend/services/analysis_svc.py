from __future__ import annotations

import logging
import math
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

    if len(rest) == 4:
        return {"type": "column", "system": system, "database": rest[0],
                "schema": rest[1], "table": rest[2], "column": rest[3], "raw": s}
    if len(rest) == 3:
        return {"type": "table", "system": system, "database": rest[0],
                "schema": rest[1], "table": rest[2], "raw": s}
    if len(rest) == 2:
        return {"type": "schema", "system": system, "database": rest[0],
                "schema": rest[1], "raw": s}
    if len(rest) == 1:
        return {"type": "database", "system": system, "database": rest[0], "raw": s}

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

def get_flow_pairs(edges_df: pd.DataFrame) -> list[dict[str, Any]]:
    if "edge" not in edges_df.columns:
        df = edges_df
    else:
        df = edges_df[edges_df["edge"] == "writes_to"]

    pairs: dict[tuple, dict] = {}
    for row in df.to_dict(orient="records"):
        src = parse_fqn(str(row.get("source_fqn") or ""))
        tgt = parse_fqn(str(row.get("target_fqn") or ""))
        if src["type"] not in ("column", "table") or tgt["type"] not in ("column", "table"):
            continue

        def tbl(p: dict) -> str:
            return f"{p.get('database','')}.{p.get('schema','')}.{p.get('table','')}"

        s, t = tbl(src), tbl(tgt)
        if s == t:
            continue
        key = (s, t)
        if key not in pairs:
            pairs[key] = {"source_table": s, "target_table": t, "edge_count": 0, "processes": set()}
        pairs[key]["edge_count"] += 1
        pf = row.get("process_fqn")
        if pf:
            pairs[key]["processes"].add(str(pf))

    return [
        {
            "source_table": p["source_table"],
            "target_table": p["target_table"],
            "edge_count": p["edge_count"],
            "process_count": len(p["processes"]),
        }
        for p in sorted(pairs.values(), key=lambda x: -x["edge_count"])
    ]
