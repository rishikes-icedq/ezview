from __future__ import annotations

import logging
import math
import re
from collections import Counter
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import unquote

import pandas as pd

from services.bi_names_svc import member_key
from services.parquet_svc import read_df

if TYPE_CHECKING:
    from services.bi_names_svc import BiNames

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
# data table and a measure into its model just as a column rolls up into a table.
#
# Two FQN formats exist. The first tags every endpoint (source_type/target_type =
# bimodel, bireport, ...):
#
#   bitable   /sys/powerbi/<model>/<table>            powerbi . <model>     . <table>
#   bifield   /sys/powerbi/<model>/<table>/<field>    …same table, column = field
#   bimodel   /sys/powerbi/<model>                    powerbi . <model>     . (model)
#   bimeasure /sys/powerbi/<model>/<measure>          …the model, column = measure
#   bireport  /sys/powerbi/<report>                   powerbi . (reports)   . <report>
#   bitile    /sys/powerbi/<dashboard>/<tile>         powerbi . <dashboard> . <tile>
#
# A third layout (bundles from 2026-11-12) tags every endpoint the same way but leaves the platform segment out,
# so the system is followed straight by the ids and names (percent-encoded):
#
#   bimodel    /sys/<model id>                           bitable    /sys/<model id>/<table>
#   bifield    /sys/<model id>/<table>/<field>           bimeasure  /sys/<model id>/<measure>
#   bireport   /sys/<report id>                          bitile     /sys/<dashboard id>/<tile id>
#   bidataflow /sys/<dataflow id>
#
# Here a bitable is a table INSIDE a model (not a node of its own), so, like the live-scanner kinds below, bitable,
# bifield and bimeasure all roll up into their model; `column` is then the name as ids spell it (see member_key).
#
# The second (the live scanner bundles) tags them only "table"/"column" and puts the
# kind in the path: /sys/powerbi/<namespace>/<workspace>/<kind>/<id>, with kind one of
# semantic_model, report, dashboard, tile, field, measure. Their ids carry no table:
# a field or measure id is "<model id>_<name>" (names sanitised, so a field's table
# can't be told from its name), and a tile id has no dashboard. So fields and measures
# both roll up into their model, and tiles/dashboards/reports are keyed by their own id:
#
#   semantic_model                                    powerbi . <model>      . (model)
#   field, measure  <model id>_<name>                 …the model, column = <name>
#   report                                            powerbi . (reports)    . <report>
#   dashboard                                         powerbi . (dashboards) . <dashboard>
#   tile                                              powerbi . (tiles)      . <tile>
#
# ("powerbi" is the FQN's own platform segment.)

_BI_ASSET_TYPES = {"bimodel", "bireport", "bitile", "bitable", "bifield", "bimeasure", "bidataflow"}
_BI_MODEL_TABLE = "(model)"
_BI_REPORTS_SCHEMA = "(reports)"
_BI_DASHBOARDS_SCHEMA = "(dashboards)"
_BI_TILES_SCHEMA = "(tiles)"
_BI_DATAFLOWS_SCHEMA = "(dataflows)"
# Live-scanner format: the path segment that names the kind -> the kind of asset it is.
_BI_SCANNER_KINDS = {
    "semantic_model": "bimodel",
    "report": "bireport",
    "dashboard": "bidashboard",
    "tile": "bitile",
    "dataflow": "bidataflow",
    "field": "bifield",
    "measure": "bimeasure",
    "semantic_table": "bisemtable",
}
_BI_SCANNER_FQN = re.compile(r"^/[^/]+/powerbi/[^/]+/[^/]+/(?:" + "|".join(_BI_SCANNER_KINDS) + r")/[^/]+$", re.IGNORECASE)
_BI_MODEL_PREFIXED = re.compile(r"^([0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12})_(.+)$")
# Segments after the platform that each Power BI type has, and the node kind it rolls up to.
_BI_SHAPE: dict[str, tuple[int, str]] = {
    "bimodel": (1, "bimodel"),
    "bimeasure": (2, "bimodel"),
    "bireport": (1, "bireport"),
    "bidataflow": (1, "bidataflow"),
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


def _parse_scanner_asset(fqn: str) -> dict[str, Any] | None:
    """A Power BI asset in the live-scanner FQN format (see above), or None if `fqn` is not one."""
    if not _BI_SCANNER_FQN.match(fqn):
        return None
    system, platform, _namespace, workspace, kind, asset_id = [p for p in fqn.split("/") if p]
    bi_type = _BI_SCANNER_KINDS[kind.lower()]
    base: dict[str, Any] = {
        "system": system, "platform": platform, "database": platform, "raw": fqn,
        "bi_type": bi_type, "workspace_id": workspace, "type": "table",
        "type_name": kind.lower(),   # what the data calls it: the kind segment of the path
    }
    if bi_type == "bimodel":
        return {**base, "asset_type": "bimodel", "schema": asset_id, "table": _BI_MODEL_TABLE}
    if bi_type in ("bifield", "bimeasure", "bisemtable"):   # <model id>_<name>: rolls up into the model, column = the name
        prefixed = _BI_MODEL_PREFIXED.match(asset_id)
        if not prefixed:
            return {"type": "unresolved", "raw": fqn}
        model, name = prefixed.groups()
        return {**base, "type": "column", "asset_type": "bimodel", "schema": model, "table": _BI_MODEL_TABLE, "column": name}
    schema = {"bireport": _BI_REPORTS_SCHEMA, "bidashboard": _BI_DASHBOARDS_SCHEMA, "bitile": _BI_TILES_SCHEMA, "bidataflow": _BI_DATAFLOWS_SCHEMA}[bi_type]
    return {**base, "asset_type": bi_type, "schema": schema, "table": asset_id}


def _parse_platformless_asset(tag: str, parts: list[str], raw: str) -> dict[str, Any]:
    """A Power BI asset in the third layout (no platform segment; see above), `parts` being its FQN's segments."""
    system, *names = (unquote(p) for p in parts)
    base: dict[str, Any] = {"system": system, "platform": system, "database": system, "raw": raw, "bi_type": tag, "type_name": tag}
    if tag == "bimodel":
        return {**base, "type": "table", "asset_type": "bimodel", "schema": names[0], "table": _BI_MODEL_TABLE}
    if tag in ("bitable", "bifield", "bimeasure"):
        # Inside a model: the model's node holds them; `column` is the table / "<table>_<field>" / measure as an id spells it.
        spelled = {"bitable": names[1:2], "bifield": [f"{names[1]}_{names[2]}"] if len(names) > 2 else [], "bimeasure": names[1:2]}[tag]
        if not spelled:
            return {"type": "unresolved", "raw": raw}
        return {**base, "type": "column", "asset_type": "bimodel", "bi_type": "bisemtable" if tag == "bitable" else tag,
                "schema": names[0], "table": _BI_MODEL_TABLE, "column": member_key(spelled[0])}
    if tag == "bitile":
        return {**base, "type": "table", "asset_type": "bitile", "schema": names[0], "table": names[1]}
    schema = _BI_REPORTS_SCHEMA if tag == "bireport" else _BI_DATAFLOWS_SCHEMA
    return {**base, "type": "table", "asset_type": tag, "schema": schema, "table": names[0]}


def parse_asset(fqn: str, type_tag: Any = None) -> dict[str, Any]:
    """parse_fqn for an edge endpoint, given that endpoint's source_type/target_type.

    Same result shape as parse_fqn (type is "column", "table", … , database/schema/
    table/column names percent-decoded), plus, for Power BI assets, `asset_type` (the
    kind of node the asset rolls up to: "bitable", "bimodel", "bireport", "bidashboard",
    "bitile") and `bi_type` (what the asset itself is: also "bifield" or "bimeasure").
    """
    scanner = _parse_scanner_asset(str(fqn or "").strip())
    if scanner:
        return _decode_names(scanner)
    tag = str(type_tag or "").strip().lower()
    if tag not in _BI_ASSET_TYPES:
        return _decode_names(parse_fqn(fqn))

    unresolved = {"type": "unresolved", "raw": fqn}
    s = str(fqn or "").strip()
    parts = [p for p in s.split("/") if p] if s.startswith("/") else []
    expected, asset_type = _BI_SHAPE[tag]
    if len(parts) == 1 + expected:   # no platform segment (third layout)
        return _parse_platformless_asset(tag, parts, s)
    if len(parts) != 2 + expected:
        return unresolved
    system, platform, *names = parts

    base = {"system": system, "platform": platform, "raw": s, "asset_type": asset_type, "bi_type": tag, "type_name": tag}   # the tag is the data's name
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
    bi_dashboards: set[str] = set()
    bi_dataflows: set[str] = set()
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
                bi_type = p["bi_type"]
                if bi_type in ("bimodel", "bimeasure"):
                    bi_models.add(p["schema"])
                    if bi_type == "bimeasure":
                        bi_measures.add((p["schema"], p["column"]))
                elif bi_type == "bireport":
                    bi_reports.add(p["table"])
                elif bi_type == "bidashboard":
                    bi_dashboards.add(p["table"])
                elif bi_type == "bidataflow":
                    bi_dataflows.add(p["table"])
                elif bi_type == "bitile":
                    bi_tiles.add(ids)
                elif bi_type == "bitable":
                    bi_tables.add(ids)
                elif bi_type == "bisemtable":   # a table of a model (live-scanner format); its name is the column
                    bi_models.add(p["schema"])
                    bi_tables.add((*ids, p["column"]))
                else:  # bifield: in a data table, or (live-scanner format, no table in the id) in the model
                    bi_fields.add((*ids, p["column"]))
                    if asset == "bitable":
                        bi_tables.add(ids)
                    else:
                        bi_models.add(p["schema"])
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
        "models": len(bi_models), "reports": len(bi_reports), "dashboards": len(bi_dashboards), "tiles": len(bi_tiles),
        "tables": len(bi_tables), "fields": len(bi_fields), "measures": len(bi_measures),
    }
    if bi_dataflows:
        bi_assets["dataflows"] = len(bi_dataflows)      # only when there are some: most bundles have none
    if any(bi_assets.values()):
        summary["bi_assets"] = bi_assets
        # What the data calls each of them (the stat cards are labelled with these, not with names of ours).
        data_names = _bi_type_names(edges_df)
        summary["bi_asset_type_names"] = {
            key: name for key, name in {
                "models": data_names.get("bimodel"), "reports": data_names.get("bireport"), "dashboards": data_names.get("bidashboard"),
                "tiles": data_names.get("bitile"), "tables": data_names.get("bisemtable") or data_names.get("bitable"),
                "dataflows": data_names.get("bidataflow"),
                "fields": data_names.get("bifield"), "measures": data_names.get("bimeasure"),
            }.items() if name and bi_assets.get(key)
        }
    return summary


# ---------------------------------------------------------------------------
# Asset tree
# ---------------------------------------------------------------------------

def _bi_asset_labels(p: dict[str, Any], names: BiNames) -> tuple[str | None, str | None]:
    """(schema label, table label) for a parsed Power BI asset: a model's id is the
    schema of its data tables, a dashboard's id the schema of its tiles, a report's or
    dashboard's id is its table."""
    kind = p["asset_type"]
    if kind in ("bimodel", "bitable"):
        return (names.models.get(p["schema"]) or (None,))[0], None
    if kind == "bireport":
        return None, (names.reports.get(p["table"]) or (None,))[0]
    if kind == "bidashboard":
        return None, (names.dashboards.get(p["table"]) or (None,))[0]
    if kind == "bidataflow":
        return None, None
    if p["schema"] == _BI_TILES_SCHEMA:   # live-scanner format: a tile is known by its own id only
        return None, (names.tile_by_id(p["table"]) or (None, None))[1]
    return (names.dashboards.get(p["schema"]) or (None,))[0], names.tiles.get((p["schema"], p["table"]))


def _note_bi_column(data: dict[str, Any], p: dict[str, Any], names: BiNames | None) -> None:
    """For a Power BI field or measure `p`, adds to the table `data` what it is (a field of a table, or a measure)
    and, if the scan names it, how it is really written."""
    if p.get("bi_type") not in ("bifield", "bimeasure"):
        return
    column = p.get("column", "")
    data["kinds"][column] = "field" if p["bi_type"] == "bifield" else "measure"
    label = names.members.get(p.get("schema", ""), {}).get(column) if names else None
    if label:
        data["labels"][column] = label


def build_asset_tree(edges_df: pd.DataFrame, names: BiNames | None = None) -> list[dict[str, Any]]:
    """Database > schema > table tree of every asset on the edges. With Power BI
    `names`, schemas and tables that are only ids (a model, a dashboard, a report, a
    tile) also carry a `schema_label` / `table_label` with the real name. A table whose
    columns are Power BI fields and measures (a model) also says which is which
    (`column_kinds`: column -> "field" | "measure"; `type_names`: those two as the data
    spells them) and, if the scan names them, how they are really written
    (`column_labels`: "Table[Column]" for a field)."""
    table_data: dict[tuple, dict] = {}
    schema_labels: dict[tuple[str, str], str] = {}
    type_names = _bi_type_names(edges_df)

    for role in ("source", "target"):
        for fqn, tag, proc in _side_records(edges_df, role, ("process_fqn",)).itertuples(index=False):
            p = parse_asset(str(fqn), tag)
            if p["type"] not in ("column", "table"):
                continue
            key = (p.get("database", ""), p.get("schema", ""), p.get("table", ""))
            if key not in table_data:
                table_data[key] = {
                    "source": 0, "target": 0, "columns": set(), "kinds": {}, "labels": {},
                    "source_processes": set(), "target_processes": set(),
                }
                if names and p.get("asset_type"):
                    schema_label, table_label = _bi_asset_labels(p, names)
                    if schema_label:
                        schema_labels[key[:2]] = schema_label
                    if table_label:
                        table_data[key]["label"] = table_label
            table_data[key][role] += 1
            if p["type"] == "column" and p.get("bi_type") != "bisemtable":
                table_data[key]["columns"].add(p.get("column", ""))
                _note_bi_column(table_data[key], p, names)
            if pd.notna(proc):
                table_data[key][f"{role}_processes"].add(str(proc))

    db_map: dict[str, dict[str, list]] = {}
    for (db, schema, table), data in table_data.items():
        db_map.setdefault(db, {}).setdefault(schema, [])
        entry = {
            "table": table,
            "column_count": len(data["columns"]),
            "columns": sorted(data["columns"]),
            "as_source": data["source"],
            "as_target": data["target"],
            "source_process_count": len(data["source_processes"]),
            "target_process_count": len(data["target_processes"]),
        }
        if "label" in data:
            entry["table_label"] = data["label"]
        if data["kinds"]:
            entry["column_kinds"] = data["kinds"]
            entry["type_names"] = {   # what the data calls them
                kind: name for kind, name in (("field", type_names.get("bifield")), ("measure", type_names.get("bimeasure"))) if name
            }
        if data["labels"]:
            entry["column_labels"] = data["labels"]
        db_map[db][schema].append(entry)

    result = []
    for db in sorted(db_map):
        schemas_list = []
        for schema in sorted(db_map[db]):
            tables = sorted(db_map[db][schema], key=lambda t: t["table"])
            entry = {"schema": schema, "table_count": len(tables), "tables": tables}
            if (db, schema) in schema_labels:
                entry["schema_label"] = schema_labels[(db, schema)]
            schemas_list.append(entry)
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


def _process_endpoints(edges_df: pd.DataFrame) -> tuple[dict[str, list[dict]], dict[str, list[dict]]]:
    """For each process_fqn, collects the assets (parse_asset results) touched as
    inputs (resolved column/table on the source side of any of its edges) and
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
    proc_inputs: dict[str, list[dict]] = {}
    proc_outputs: dict[str, list[dict]] = {}
    if "process_fqn" not in edges_df.columns:
        return proc_inputs, proc_outputs

    for side, bucket in (("source", proc_inputs), ("target", proc_outputs)):
        rows = _side_records(edges_df, side, ("process_fqn",)).dropna(subset=["process_fqn"])
        for fqn, tag, proc in rows.itertuples(index=False):
            parsed = parse_asset(str(fqn), tag)
            if parsed["type"] in ("column", "table"):
                bucket.setdefault(str(proc), []).append(parsed)
    return proc_inputs, proc_outputs


def _table_keys(endpoints: dict[str, list[dict]]) -> dict[str, list[str]]:
    return {proc: [_table_key(p) for p in assets] for proc, assets in endpoints.items()}


def _process_io(edges_df: pd.DataFrame) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """For each process_fqn, the table keys (see _table_key) of its inputs and of its outputs."""
    inputs, outputs = _process_endpoints(edges_df)
    return _table_keys(inputs), _table_keys(outputs)


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


def _is_bi_endpoint(fqn: pd.Series, tag: pd.Series | None) -> pd.Series:
    """Which endpoints are Power BI assets: tagged as one, or (live-scanner format,
    where the tag is just "table"/"column") named so by their FQN."""
    by_fqn = fqn.astype(str).str.match(_BI_SCANNER_FQN)
    return by_fqn if tag is None else by_fqn | tag.astype(str).str.lower().isin(_BI_ASSET_TYPES)


def _bi_type_names(edges_df: pd.DataFrame) -> dict[str, str]:
    """What the bundle itself calls each kind of Power BI asset: internal kind ("bimodel", "bifield", "bisemtable",
    ...) -> the name the data uses, i.e. the `source_type`/`target_type` tag of the tagged format ("bimodel", ...) or
    the kind segment of a live-scanner path ("semantic_model", "field", "semantic_table", ...). The screen shows these
    names and no others. A live-scanner bundle also gets the names of the kinds it has no endpoint of (they are the
    path's own vocabulary), so a model known only through its fields still has one."""
    names: dict[str, str] = {}
    scanner = False
    for side in ("source", "target"):
        records = _side_records(edges_df, side)
        for fqn, tag in records[_is_bi_endpoint(records["fqn"], records["tag"])][["fqn", "tag"]].drop_duplicates().itertuples(index=False):
            p = parse_asset(str(fqn), tag)
            if p.get("bi_type"):
                names.setdefault(p["bi_type"], p["type_name"])
                scanner = scanner or "workspace_id" in p
    if scanner:
        for kind, internal in _BI_SCANNER_KINDS.items():
            names.setdefault(internal, kind)
    return names


def _bi_node_kinds(edges_df: pd.DataFrame) -> dict[str, str]:
    """Table key -> kind ("bitable", "bimodel", "bireport", "bidashboard", "bitile")
    for every Power BI asset in the bundle. Fields roll up into their data table (or,
    in the live-scanner format, their model) and measures into their model, so those
    kinds also cover them."""
    kinds: dict[str, str] = {}
    for side in ("source", "target"):
        records = _side_records(edges_df, side)
        for fqn, tag in records[_is_bi_endpoint(records["fqn"], records["tag"])][["fqn", "tag"]].drop_duplicates().itertuples(index=False):
            p = parse_asset(str(fqn), tag)
            if p["type"] in ("column", "table"):
                kinds[_table_key(p)] = p["asset_type"]
    return kinds


def _unmediated_bi_pairs(edges_df: pd.DataFrame) -> list[tuple[dict, dict]]:
    """(source, target) as parse_asset results for every edge with a Power BI asset
    on one end and no data process in the middle."""
    needed = {"source_fqn", "source_type", "target_fqn", "target_type"}
    if not needed <= set(edges_df.columns):
        return []
    bi = lambda side: _is_bi_endpoint(edges_df[f"{side}_fqn"], edges_df[f"{side}_type"])  # noqa: E731
    unmediated = edges_df["process_fqn"].isna() if "process_fqn" in edges_df.columns else True
    rows = edges_df[unmediated & (bi("source") | bi("target"))]

    pairs = []
    for src, src_tag, tgt, tgt_tag in rows[["source_fqn", "source_type", "target_fqn", "target_type"]].dropna(subset=["source_fqn", "target_fqn"]).itertuples(index=False):
        a, b = parse_asset(str(src), src_tag), parse_asset(str(tgt), tgt_tag)
        if a["type"] in ("column", "table") and b["type"] in ("column", "table"):
            pairs.append((a, b))
    return pairs


def _unmediated_bi_links(pairs: list[tuple[dict, dict]], bi_kinds: dict[str, str]) -> set[tuple[str, str]]:
    """(source table key, target table key) pairs for Power BI links that no data
    process sits in the middle of (see _unmediated_bi_pairs): model -> report/tile,
    report -> tile, a data table's fields -> the measures computed from them, a
    source table -> the model that reads it. Fields and measures roll up into their
    table/model, so a link between two assets inside one table or model is not a
    link between nodes (see _unmediated_member_links).

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

    for a, b in pairs:
        if _table_key(a) != _table_key(b):
            links.add((_table_key(a), _table_key(b)))
    return links


# A Power BI field or measure, as (key of the model/table it rolls up into, name, kind).
BiMember = tuple[str, str, str]
_BI_MEMBER_TYPES = {"bifield", "bimeasure"}
# A live-scanner bundle names each measure evaluation "EVALUATE into <measure name>".
_EVALUATE_INTO = re.compile(r"^\s*EVALUATE into\s+(.+?)\s*$", re.IGNORECASE)


def _bi_member(p: dict) -> BiMember:
    return (_table_key(p), p["column"], p["bi_type"])


def _is_bi_member(p: dict) -> bool:
    return p["type"] == "column" and p.get("bi_type") in _BI_MEMBER_TYPES


def _unmediated_member_links(pairs: list[tuple[dict, dict]]) -> list[tuple[BiMember, BiMember]]:
    """Links, with no process in between, from a field or measure to the measure
    evaluated from it, when both sit in the same model (or data table) and so roll
    up into the same node: the node would only link to itself. The graph shows
    them as links between the fields/measures themselves, inside that node."""
    return [
        (_bi_member(a), _bi_member(b)) for a, b in pairs
        if _is_bi_member(a) and _is_bi_member(b) and _table_key(a) == _table_key(b) and a["column"] != b["column"]
    ]


def _bi_evaluations(
    inputs: dict[str, list[dict]], outputs: dict[str, list[dict]],
) -> dict[str, tuple[list[BiMember], list[BiMember]]]:
    """process_fqn -> (members it reads, members it writes) for every process that
    only moves Power BI fields and measures around: a measure being evaluated from
    the fields and measures it is built on (POWERBI_MEASURE_EVAL). A field or
    measure rolls up into its model, so such a process would read and write the same
    node; the graph shows it as links between the fields/measures themselves."""
    found: dict[str, tuple[list[BiMember], list[BiMember]]] = {}
    for proc in inputs.keys() & outputs.keys():
        if all(_is_bi_member(p) for p in inputs[proc] + outputs[proc]):
            found[proc] = (
                list(dict.fromkeys(_bi_member(p) for p in inputs[proc])),
                list(dict.fromkeys(_bi_member(p) for p in outputs[proc])),
            )
    return found


def _last_segment(fqn: str) -> str:
    return str(fqn).rstrip("/").rsplit("/", 1)[-1]


# How many field/measure names a table node carries for its tooltip.
_TABLE_SAMPLE = 12


def _loose_key(name: str) -> str:
    """A table name with everything but letters and digits dropped: a fallback for matching a table to the way an
    asset id spells it, should a character be replaced differently from the usual."""
    return re.sub(r"[^0-9A-Za-z]", "", name)


def _bi_model_tables(attributes_df: pd.DataFrame | None) -> dict[str, list[dict[str, Any]]]:
    """model id -> its tables, each {name, fields[], measures[]} (tables sorted), from containment
    rows (parent_urn, parent_type, child_urn, child_type) saying a semantic_model contains
    semantic_tables, which contain fields and measures. Two spellings of the urns:
    /<model id>[/<table>[/<field or measure>]] with the names as written (percent-encoded), or, in
    newer bundles' attributes.parquet, the assets' own FQNs, e.g. /<sys>/powerbi/default/<workspace>/
    semantic_table/<model id>_<table>, whose names are spelled as in ids (every character that is not a
    letter, digit, hyphen or underscore is "_") with the model id in front, and a field's also with its
    table's."""
    needed = {"parent_urn", "parent_type", "child_urn", "child_type"}
    if attributes_df is None or not needed <= set(attributes_df.columns):
        return {}
    rows = attributes_df[["parent_urn", "parent_type", "child_urn", "child_type"]].dropna().astype(str)
    kind = rows["child_type"].str.lower()

    inside: dict[str, dict[str, list[str]]] = {}   # table urn -> {"field": [...], "measure": [...]}
    held = rows[(rows["parent_type"].str.lower() == "semantic_table") & kind.isin(["field", "measure"])]
    for table_urn, child_urn, child_type in zip(held["parent_urn"], held["child_urn"], held["child_type"].str.lower()):
        inside.setdefault(table_urn, {"field": [], "measure": []})[child_type].append(unquote(_last_segment(child_urn)))

    tables: dict[str, list[dict[str, Any]]] = {}
    listed = rows[(rows["parent_type"].str.lower() == "semantic_model") & (kind == "semantic_table")]
    for model_urn, table_urn in zip(listed["parent_urn"], listed["child_urn"]):
        held_by = inside.get(table_urn, {"field": [], "measure": []})
        model_id = unquote(_last_segment(model_urn))
        written = unquote(_last_segment(table_urn))
        fields, measures = held_by["field"], held_by["measure"]
        if written.startswith(f"{model_id}_"):   # spelled as in asset ids: take the prefixes off
            fields = [f.removeprefix(f"{written}_") for f in fields]
            measures = [m.removeprefix(f"{model_id}_") for m in measures]
            written = written.removeprefix(f"{model_id}_")
        tables.setdefault(model_id, []).append({"name": written, "fields": fields, "measures": measures})
    for model_tables in tables.values():
        model_tables.sort(key=lambda t: t["name"].lower())
    return tables


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


def _bi_key_parts(key: str) -> tuple[str, str]:
    """(parent, name) of a Power BI table key `platform.<parent>.<name>`: model id and
    table name for a data table, model id and "(model)", "(reports)" and report id,
    dashboard id and tile id."""
    parent, name = (key.split(".", 2) + ["", ""])[1:3]
    return parent, name


def _bi_label(kind: str, key: str) -> str:
    """Display name for a Power BI node before its real name is known. Models,
    reports and tiles are only known by GUID, so they show its first 8 characters
    (the client adds what kind of asset it is); a data table shows its own name."""
    parent, name = _bi_key_parts(key)
    if kind == "bitable":
        return name
    return (parent if kind == "bimodel" else name)[:8]


def has_bi_assets(edges_df: pd.DataFrame) -> bool:
    """Whether any edge endpoint is a Power BI asset (see _is_bi_endpoint)."""
    for side in ("source", "target"):
        if f"{side}_fqn" not in edges_df.columns:
            continue
        tag = edges_df[f"{side}_type"] if f"{side}_type" in edges_df.columns else None
        if _is_bi_endpoint(edges_df[f"{side}_fqn"], tag).any():
            return True
    return False


def apply_bi_names(graph: dict[str, Any], names: BiNames) -> None:
    """Gives the Power BI nodes of `graph` (in place) the names from a crawl: a
    model, report or tile is labelled with its name instead of its id. Every node
    also gets `details`, the context that tells same-named assets apart (workspace;
    for a tile its dashboard; for a data table its model). Ids the crawl does not
    know keep their id label."""
    for node in graph["nodes"]:
        kind = node.get("asset_type")
        if not kind:
            continue
        parent, name = _bi_key_parts(node["full_name"])
        details: list[tuple[str, str | None]] = []
        if kind == "bimodel" and parent in names.models:
            node["label"], workspace = names.models[parent]
            details = [("workspace", workspace)]
        elif kind == "bireport" and name in names.reports:
            node["label"], workspace = names.reports[name]
            details = [("workspace", workspace)]
        elif kind == "bidashboard" and name in names.dashboards:
            node["label"], workspace = names.dashboards[name]
            details = [("workspace", workspace)]
        elif kind == "bitile":
            if parent == _BI_TILES_SCHEMA:   # live-scanner format: only the tile's own id is known
                dashboard_id, tile_name = names.tile_by_id(name) or (None, None)
            else:
                dashboard_id, tile_name = parent, names.tiles.get((parent, name))
            if tile_name:
                node["label"] = tile_name
            dashboard, workspace = names.dashboards.get(dashboard_id, (None, None)) if dashboard_id else (None, None)
            details = [("dashboard", dashboard), ("workspace", workspace)]
        elif kind == "bitable" and parent in names.models:
            model, workspace = names.models[parent]
            details = [("semantic_model", model), ("workspace", workspace)]
        known = [{"label": label, "value": value} for label, value in details if value]
        if known:
            node["details"] = known

    # Fields and measures inside a model: the scanner result names them (a field as Table[Column]).
    for node in graph["nodes"]:
        if node.get("type") != "bi_member":
            continue
        model_id = node.get("model_id", "")
        name = names.members.get(model_id, {}).get(node.get("column", ""))
        if name:
            node["label"] = name
        model, workspace = names.models.get(model_id, (None, None))
        known = [{"label": label, "value": value} for label, value in (("semantic_model", model), ("workspace", workspace)) if value]
        if known:
            node["details"] = known


def _with_type_name(name: str | None) -> dict[str, str]:
    """{"type_name": name} for a node, or nothing when the bundle has no name for that kind."""
    return {"type_name": name} if name else {}


def _table_node(
    node_id: str, key: str, view_keys: set[str], bi_kinds: dict[str, str] | None = None, bi_type_names: dict[str, str] | None = None,
) -> dict[str, Any]:
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
        if name := (bi_type_names or {}).get(kind):
            node["type_name"] = name     # what the data calls this kind of asset: the screen shows it as is
    return node


def get_lineage_graph(
    edges_df: pd.DataFrame,
    processes_df: pd.DataFrame | None = None,
    attributes_df: pd.DataFrame | None = None,
) -> dict[str, Any]:
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
    input_assets, output_assets = _process_endpoints(edges_df)
    proc_inputs, proc_outputs = _table_keys(input_assets), _table_keys(output_assets)
    evaluations = _bi_evaluations(input_assets, output_assets)
    view_keys = _view_table_keys(edges_df)
    bi_kinds = _bi_node_kinds(edges_df)
    type_names = _bi_type_names(edges_df) if bi_kinds else {}
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
            nodes.append(_table_node(table_ids[key], key, view_keys, bi_kinds, type_names))
        return table_ids[key]

    # Names of the measures the evaluations write, from the process names: all a bundle has to name them by.
    member_names: dict[tuple[str, str], str] = {}
    for proc, (_, written) in evaluations.items():
        named = _EVALUATE_INTO.match(str(proc_meta.get(proc, {}).get("process_name") or ""))
        if named and len(written) == 1:
            member_names.setdefault(written[0][:2], named.group(1))
    member_ids: dict[tuple[str, str], str] = {}

    def get_member_id(member: BiMember) -> str:
        nonlocal counter
        key, column, kind = member
        if (key, column) not in member_ids:
            member_ids[(key, column)] = f"n{counter}"
            counter += 1
            nodes.append({
                "id": member_ids[(key, column)],
                "type": "bi_member",
                "member_kind": "measure" if kind == "bimeasure" else "field",
                "label": member_names.get((key, column)) or re.sub(r"_+", " ", column).strip() or column,
                "full_name": f"{key}.{column}",
                "model_id": _bi_key_parts(key)[0],
                "column": column,
                # The model (or data table) it rolls up into: the container it is drawn inside.
                "parent_id": get_table_id(key),
                **_with_type_name(type_names.get(kind)),
            })
        return member_ids[(key, column)]

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
        if proc in evaluations:
            continue   # drawn below, as links between the fields/measures it connects
        reads, writes = set(proc_inputs.get(proc, [])), set(proc_outputs.get(proc, []))
        if reads and reads == writes and all(key in bi_kinds for key in reads):
            # A Power BI process that reads and writes only the same asset(s) (a measure evaluated
            # from its model's fields rolls up to the model reading itself): no lineage to draw.
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

    # Fields/measures a measure is evaluated from -> that measure. Both ends sit inside their model, which the
    # client draws as a box that can be opened to show them. A bundle gives them either as a process that
    # evaluates the measure or as plain links between the two.
    unmediated = _unmediated_bi_pairs(edges_df)
    member_links = _unmediated_member_links(unmediated)
    for reads, writes in evaluations.values():
        member_links += [(read, write) for read in reads for write in writes if read[:2] != write[:2]]
    for read, write in member_links:
        add_edge(get_member_id(read), get_member_id(write), "uses")

    # Power BI links with no process in between (model -> report, field -> measure, ...).
    for src_key, tgt_key in sorted(_unmediated_bi_links(unmediated, bi_kinds)):
        add_edge(get_table_id(src_key), get_table_id(tgt_key), "uses")

    # The tables inside each model that is in the graph, whether or not anything is linked to them.
    model_tables = _bi_model_tables(attributes_df)
    if model_tables:
        chip_ids: dict[tuple[str, str], str] = {}     # (model id, table as spelled in ids) -> node id
        loose_chip_ids: dict[tuple[str, str], str] = {}
        for key, model_node_id in list(table_ids.items()):
            if bi_kinds.get(key) != "bimodel":
                continue
            model_id = _bi_key_parts(key)[0]
            for table in model_tables.get(model_id, []):
                chip_ids.setdefault((model_id, member_key(table["name"])), f"n{counter}")
                loose_chip_ids.setdefault((model_id, _loose_key(table["name"])), f"n{counter}")
                nodes.append({
                    "id": f"n{counter}",
                    "type": "bi_member",
                    "member_kind": "table",
                    "label": table["name"],
                    "full_name": f"{key}.{table['name']}",
                    "model_id": model_id,
                    "parent_id": model_node_id,
                    "field_count": len(table["fields"]),
                    "measure_count": len(table["measures"]),
                    "fields": table["fields"][:_TABLE_SAMPLE],
                    "measures": table["measures"][:_TABLE_SAMPLE],
                    **_with_type_name(type_names.get("bisemtable")),
                    # what the data calls the fields and measures it holds
                    "member_type_names": {k: v for k, v in (("field", type_names.get("bifield")), ("measure", type_names.get("bimeasure"))) if v},
                })
                counter += 1

        # What feeds a model's tables, and what they feed: a source table -> the table of the model it loads, and a
        # table of one model -> the table of the next model built on it (the links that name a semantic_table). Each
        # of these is also rolled up to a link between the models (or source table -> model); that one is flagged
        # `summary` so the client can leave it out while the model is open and these links are drawn instead.
        def table_end(p: dict[str, Any]) -> str | None:
            if p.get("bi_type") == "bisemtable":
                return chip_ids.get((p["schema"], p["column"])) or loose_chip_ids.get((p["schema"], _loose_key(p["column"])))
            if p["type"] == "table" and (not p.get("asset_type") or p.get("bi_type") == "bidataflow"):   # a database table, or a dataflow
                return get_table_id(_table_key(p))
            return None

        model_of_chip = {n["id"]: n["parent_id"] for n in nodes if n["type"] == "bi_member" and n["member_kind"] == "table"}
        rolled_up: set[tuple[str, str]] = set()
        for a, b in unmediated:
            if "bisemtable" not in (a.get("bi_type"), b.get("bi_type")):
                continue
            src, tgt = table_end(a), table_end(b)
            if src and tgt and src != tgt:
                add_edge(src, tgt, "uses")
                rolled_up.add((model_of_chip.get(src, src), model_of_chip.get(tgt, tgt)))
        for link in edges:
            if link["kind"] == "uses" and (link["source"], link["target"]) in rolled_up:
                link["summary"] = True

        # Which table each linked measure/field lives in (and its name as written), by how the bundle spells it:
        # a measure by its name, a field by its table and column.
        homes: dict[str, dict[str, tuple[str, str]]] = {}
        for model_id, tables in model_tables.items():
            found = homes.setdefault(model_id, {})
            for table in tables:
                for measure in table["measures"]:
                    found.setdefault(member_key(measure), (measure, table["name"]))
                for field_name in table["fields"]:
                    found.setdefault(member_key(f"{table['name']}_{field_name}"), (f"{table['name']}[{field_name}]", table["name"]))
        for node in nodes:
            if node["type"] == "bi_member" and node["member_kind"] in ("measure", "field"):
                home = homes.get(node["model_id"], {}).get(node["column"])
                if home:
                    node["label"], node["table"] = home
                    if type_names.get("bisemtable"):
                        node["table_type_name"] = type_names["bisemtable"]

    return {"nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------------
# Column (field) lineage of one table of a Power BI model
# ---------------------------------------------------------------------------

# Most paths and measure names returned per field: a field read by many measures, or a long fan-out, is cut off.
_COLUMN_PATH_LIMIT = 12
_COLUMN_MEASURE_SAMPLE = 8
_COLUMN_DEPTH = 10


def get_column_lineage(
    edges_df: pd.DataFrame,
    attributes_df: pd.DataFrame | None,
    model_id: str,
    table: str,
    names: BiNames | None = None,
) -> dict[str, Any] | None:
    """Where each field of `table` (a table of the Power BI model `model_id`) comes from and where it goes, by
    following the column-level edges: a database column -> a field, a field -> the same field of the model built on
    it, a field -> a measure that reads it.

    Returns {model: {id, name}, table, fields: [{name, upstream, downstream, measures}]} or None when the bundle
    does not list that table. `upstream` / `downstream` are lists of paths; a path is a list of nodes
    {kind: "column"|"field", type_name, label, model} — upstream from the farthest source to the nearest, downstream outward
    from the nearest. `measures` is {count, names} for the measures that read the field directly (absent if none)."""
    model_tables = _bi_model_tables(attributes_df)
    wanted = next((t for t in model_tables.get(model_id, []) if t["name"] == table), None)
    if wanted is None:
        return None

    def model_name(mid: str) -> str:
        found = names.models.get(mid) if names else None
        return found[0] if found else mid[:8]

    # How a field / measure is spelled in ids, back to its real name: (model id, id spelling) -> (table, name)
    field_homes: dict[tuple[str, str], tuple[str, str]] = {}
    measure_names: dict[tuple[str, str], str] = {}
    for mid, tables in model_tables.items():
        for t in tables:
            for field_name in t["fields"]:
                field_homes.setdefault((mid, member_key(f"{t['name']}_{field_name}")), (t["name"], field_name))
            for measure in t["measures"]:
                measure_names.setdefault((mid, member_key(measure)), measure)

    def node(p: dict[str, Any]) -> tuple[tuple, dict[str, Any]] | None:
        if p.get("bi_type") == "bifield":
            home = field_homes.get((p["schema"], p["column"]))
            label = f"{home[0]}[{home[1]}]" if home else p["column"]
            return ("field", p["schema"], p["column"]), {"kind": "field", "type_name": p["type_name"], "label": label, "model": model_name(p["schema"])}
        if p["type"] == "column" and not p.get("asset_type") and p.get("table"):
            label = f"{p['database']}.{p['schema']}.{p['table']}.{p['column']}"
            return ("db", label), {"kind": "column", "type_name": "column", "label": label, "model": None}
        return None

    info: dict[tuple, dict[str, Any]] = {}
    up: dict[tuple, list[tuple]] = {}
    down: dict[tuple, list[tuple]] = {}
    readers: dict[tuple, list[str]] = {}     # field -> names of the measures that read it
    for src_fqn, src_tag, tgt_fqn, tgt_tag in edges_df[["source_fqn", "source_type", "target_fqn", "target_type"]].dropna(subset=["source_fqn", "target_fqn"]).itertuples(index=False):
        a, b = parse_asset(str(src_fqn), src_tag), parse_asset(str(tgt_fqn), tgt_tag)
        left = node(a)
        if left is None:
            continue
        if b.get("bi_type") == "bimeasure":
            if left[0][0] == "field":
                readers.setdefault(left[0], []).append(measure_names.get((b["schema"], b["column"]), b["column"]))
            continue
        right = node(b) if b.get("bi_type") == "bifield" else None
        if right is None:
            continue
        info[left[0]], info[right[0]] = left[1], right[1]
        up.setdefault(right[0], []).append(left[0])
        down.setdefault(left[0], []).append(right[0])

    cut = False

    def paths(start: tuple, adjacent: dict[tuple, list[tuple]]) -> list[list[tuple]]:
        nonlocal cut
        found: list[list[tuple]] = []

        def walk(at: tuple, trail: list[tuple], seen: set[tuple]) -> None:
            nonlocal cut
            onward = [n for n in adjacent.get(at, []) if n not in seen]
            if not onward or len(trail) >= _COLUMN_DEPTH:
                if trail:
                    found.append(trail)
                return
            for n in onward:
                if len(found) >= _COLUMN_PATH_LIMIT:
                    cut = True
                    return
                walk(n, trail + [n], seen | {n})

        walk(start, [], {start})
        return found

    fields = []
    for field_name in wanted["fields"]:
        key = ("field", model_id, member_key(f"{table}_{field_name}"))
        entry: dict[str, Any] = {
            "name": field_name,
            "upstream": [[info[n] for n in reversed(p)] for p in paths(key, up)],
            "downstream": [[info[n] for n in p] for p in paths(key, down)],
        }
        read_by = list(dict.fromkeys(readers.get(key, [])))
        if read_by:
            entry["measures"] = {"count": len(read_by), "names": read_by[:_COLUMN_MEASURE_SAMPLE]}
        fields.append(entry)
    data_names = _bi_type_names(edges_df)
    return {
        "model": {"id": model_id, "name": model_name(model_id)}, "table": table, "fields": fields, "truncated": cut,
        # what the data calls a table of a model and a field of it
        "type_names": {kind: name for kind, name in (("table", data_names.get("bisemtable")), ("field", data_names.get("bifield"))) if name},
    }


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
    type_names = _bi_type_names(edges_df) if bi_kinds else {}
    table_ids: dict[str, str] = {}
    nodes: list[dict] = []

    def get_table_id(key: str) -> str:
        if key not in table_ids:
            table_ids[key] = f"n{len(table_ids)}"
            nodes.append(_table_node(table_ids[key], key, view_keys, bi_kinds, type_names))
        return table_ids[key]

    edges = [
        {"source": get_table_id(src_key), "target": get_table_id(tgt_key), "kind": "mapping", "column_count": len(columns)}
        for (src_key, tgt_key), columns in pair_columns.items()
    ]
    return {"nodes": nodes, "edges": edges}
