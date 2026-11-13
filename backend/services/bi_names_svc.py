"""Names for Power BI assets.

A Power BI lineage bundle only knows its models, reports, dashboards and tiles by
id. Their names come from two places:

* the crawl snapshot the bundle was built from: a folder with one parquet file per
  asset family (`semantic_model/semantic_model.parquet`, `report/report.parquet`,
  `tile/tile.parquet`, ...), found by the pipeline under

      crawl-metadata/powerbi/<connectionId>/crawl-<id>/<snapshot timestamp>/

  The bundle's manifest.json carries the same connectionId, so the snapshot can be
  found next to the bundle (a bundle may also carry a copy of it, as
  `<bundle>/crawl/<connectionId>/crawl-<id>/<snapshot timestamp>/`, which is used first).
  It can also be given by hand.
* the bundle's own scanner result (`stage2/powerbi_scan_result.parquet`, the raw
  Power BI Scanner API response a live-scanner bundle was built from), which names
  every asset the lineage was built from.

A crawl, when there is one, wins; the scanner result names whatever the crawl does not.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pandas as pd

from services.filesystem import safe_resolve
from services.parquet_svc import read_df

logger = logging.getLogger(__name__)

CRAWL_METADATA_DIR = "crawl-metadata"
BUNDLE_CRAWL_DIR = "crawl"      # a bundle's own copy of its crawl: <bundle>/crawl/<connectionId>/crawl-<id>/<snapshot>
SCAN_FILE = Path("stage2") / "powerbi_scan_result.parquet"
# Any one of these makes a folder a crawl snapshot.
_FAMILIES = ("semantic_model", "report", "dashboard", "tile", "container")
# How far above the bundle to look for crawl-metadata, and how deep under a folder
# given by hand to look for a snapshot.
_MAX_PARENTS = 8
_MAX_DEPTH = 4
# A live-scanner bundle names a table, field or measure by the model's id and the asset's name with everything that is
# not a letter, digit or hyphen replaced by "_" (measure "Written Premium (New)" -> "Written_Premium__New_", table
# "customer-dw-cs" stays as it is); a field is named by its table and column ("Date Selection" + "Date Selection Order"
# -> "Date_Selection_Date_Selection_Order").
_NOT_ALNUM = re.compile(r"[^0-9A-Za-z_-]")


def member_key(name: str) -> str:
    """How a table/field/measure `name` is spelled inside a live-scanner bundle's asset id."""
    return _NOT_ALNUM.sub("_", name)


@dataclass(frozen=True)
class BiNames:
    """Names by id. A model, report or dashboard maps to (name, workspace name); a
    tile is keyed by (dashboard id, tile id). `members` has, per model id, the
    measures and fields inside it: member_key(name) -> name ("Table[Column]" for a field)."""

    path: str
    models: dict[str, tuple[str, str | None]] = field(default_factory=dict)
    reports: dict[str, tuple[str, str | None]] = field(default_factory=dict)
    dashboards: dict[str, tuple[str, str | None]] = field(default_factory=dict)
    tiles: dict[tuple[str, str], str] = field(default_factory=dict)
    members: dict[str, dict[str, str]] = field(default_factory=dict)

    @cached_property
    def _tiles_by_id(self) -> dict[str, tuple[str, str]]:
        return {tile: (dashboard, name) for (dashboard, tile), name in self.tiles.items()}

    def tile_by_id(self, tile_id: str) -> tuple[str, str] | None:
        """(dashboard id, name) of a tile known by its own id only (a live-scanner bundle's
        tile FQN has no dashboard in it)."""
        return self._tiles_by_id.get(tile_id)

    def counts(self) -> dict[str, int]:
        return {
            "models": len(self.models),
            "reports": len(self.reports),
            "dashboards": len(self.dashboards),
            "tiles": len(self.tiles),
        }

    def merged_with(self, fallback: BiNames) -> BiNames:
        """These names, plus whatever `fallback` names that these don't (these win)."""
        return BiNames(
            path=self.path,
            models={**fallback.models, **self.models},
            reports={**fallback.reports, **self.reports},
            dashboards={**fallback.dashboards, **self.dashboards},
            tiles={**fallback.tiles, **self.tiles},
            members={**fallback.members, **self.members},
        )


def _is_snapshot(folder: Path) -> bool:
    return any((folder / fam / f"{fam}.parquet").is_file() for fam in _FAMILIES)


def resolve_snapshot(path: Path) -> Path | None:
    """The crawl snapshot at `path`, or the latest one under it (a snapshot folder,
    a `crawl-<id>` folder, a connection folder, ... all work). Snapshot folders are
    named by timestamp, so the latest is the one that sorts last."""
    if not path.is_dir():
        return None
    if _is_snapshot(path):
        return path

    found: list[Path] = []
    level = [path]
    for _ in range(_MAX_DEPTH):
        nxt: list[Path] = []
        for folder in level:
            try:
                children = [c for c in folder.iterdir() if c.is_dir()]
            except OSError:
                continue
            for child in children:
                (found if _is_snapshot(child) else nxt).append(child)
        level = nxt
    return max(found, key=lambda p: p.name) if found else None


def find_crawl_folder(bundle_dir: Path, manifest: dict | None) -> Path | None:
    """The snapshot of the crawl this bundle was built from, looked up through the
    bundle manifest's connectionId: in the `crawl/<connectionId>` copy a bundle may carry
    of its own crawl, or in a `crawl-metadata` folder, next to (or above) the bundle."""
    connection_id = str((manifest or {}).get("connectionId") or "").strip()
    if not connection_id:
        return None
    for folder in [bundle_dir, *list(bundle_dir.parents)[:_MAX_PARENTS]]:
        own_copy = resolve_snapshot(folder / BUNDLE_CRAWL_DIR / connection_id)
        if own_copy:
            return own_copy
        root = folder / CRAWL_METADATA_DIR
        if not root.is_dir():
            continue
        for connection in sorted(root.glob(f"*/{connection_id}")):
            snapshot = resolve_snapshot(connection)
            if snapshot:
                return snapshot
    return None


def _strip(urn: Any) -> str:
    return str(urn or "").strip().strip("/")


def _frame(snapshot: Path, family: str) -> pd.DataFrame | None:
    file = snapshot / family / f"{family}.parquet"
    return read_df(file) if file.is_file() else None


def _named(df: pd.DataFrame | None, urn_col: str, name_col: str, workspaces: dict[str, str]) -> dict[str, tuple[str, str | None]]:
    if df is None or not {urn_col, name_col} <= set(df.columns):
        return {}
    out: dict[str, tuple[str, str | None]] = {}
    for _, row in df.iterrows():
        name = row[name_col]
        if pd.isna(name) or not str(name).strip():
            continue
        out[_strip(row[urn_col])] = (str(name), workspaces.get(_strip(row.get("container_urn"))))
    return out


def load_names(snapshot: Path) -> BiNames:
    """Read the names out of the crawl snapshot at `snapshot`."""
    containers = _frame(snapshot, "container")
    workspaces: dict[str, str] = {}
    if containers is not None and {"container_urn", "container_name"} <= set(containers.columns):
        workspaces = {_strip(u): str(n) for u, n in zip(containers["container_urn"], containers["container_name"]) if pd.notna(n)}

    dashboards = _named(_frame(snapshot, "dashboard"), "dashboard_urn", "dashboard_name", workspaces)
    tiles: dict[tuple[str, str], str] = {}
    tile_df = _frame(snapshot, "tile")
    if tile_df is not None and {"tile_urn", "tile_name"} <= set(tile_df.columns):
        for urn, name in zip(tile_df["tile_urn"], tile_df["tile_name"]):
            dashboard_id, _, tile_id = _strip(urn).partition("/")
            # A crawl names a tile that has no title by its own id (a quarter of them in a real one): that is no name.
            if tile_id and pd.notna(name) and str(name).strip() and str(name).strip() != tile_id:
                tiles[(dashboard_id, tile_id)] = str(name)

    return BiNames(
        path=str(snapshot),
        models=_named(_frame(snapshot, "semantic_model"), "semantic_model_urn", "semantic_model_name", workspaces),
        reports=_named(_frame(snapshot, "report"), "report_urn", "report_name", workspaces),
        dashboards=dashboards,
        tiles=tiles,
    )


def _text(value: Any) -> str | None:
    return str(value).strip() or None if value is not None and not pd.isna(value) else None


def find_scan(bundle_dir: Path) -> Path | None:
    """The bundle's own scanner result: `stage2/` sits next to the `lineage/` folder."""
    for folder in (bundle_dir, bundle_dir.parent):
        file = folder / SCAN_FILE
        if file.is_file():
            return file
    return None


_scan_cache: dict[tuple[str, float], BiNames] = {}


def _put_members(into: dict[str, str], dataset: dict) -> None:
    """The measures and columns of a scanned dataset, under the spelling a bundle's asset ids use. The first of
    two assets that spell the same way keeps the name."""
    for table in dataset.get("tables") or []:
        table_name = _text(table.get("name"))
        for measure in table.get("measures") or []:
            if name := _text(measure.get("name")):
                into.setdefault(member_key(name), name)
        for column in table.get("columns") or []:
            if table_name and (name := _text(column.get("name"))):
                into.setdefault(member_key(f"{table_name}_{name}"), f"{table_name}[{name}]")


def _json_object(raw: Any) -> dict | None:
    """`raw` (a JSON string, or already an object) as a dict; None if it is anything else."""
    try:
        value = raw if isinstance(raw, dict) else json.loads(raw)
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def _result_rows(rows_json: Any) -> list[Any]:
    """The `response` of each row of a results file's `rows_json` cell (a JSON list of {"response": ...} objects)."""
    try:
        rows = json.loads(rows_json)
    except (TypeError, ValueError):
        return []
    return [row.get("response") for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _scan_payloads(scan: Path) -> list[dict]:
    """The Scanner API responses in a scanner-result file, parsed. The file holds either one row per response page
    (column `response`, a JSON string) or, in the pipeline's results layout, one row per query whose `rows_json` is
    a JSON list of {"response": <JSON string>} rows. Anything that is not a JSON object is skipped."""
    df = read_df(scan)
    if "response" in df.columns:
        raws = list(df["response"])
    elif "rows_json" in df.columns:
        raws = [raw for rows_json in df["rows_json"] for raw in _result_rows(rows_json)]
    else:
        raise ValueError(f"{scan.name} has neither a `response` nor a `rows_json` column")
    return [payload for payload in map(_json_object, raws) if payload is not None]


def load_scan_names(scan: Path) -> BiNames:
    """Read the names out of a Power BI Scanner API result: each response is a JSON document holding
    `workspaces[]` with their `reports`, `datasets` (= semantic models) and `dashboards` (with their `tiles`)."""
    key = (str(scan), scan.stat().st_mtime)
    if key in _scan_cache:
        return _scan_cache[key]

    models: dict[str, tuple[str, str | None]] = {}
    reports: dict[str, tuple[str, str | None]] = {}
    dashboards: dict[str, tuple[str, str | None]] = {}
    tiles: dict[tuple[str, str], str] = {}
    members: dict[str, dict[str, str]] = {}

    def put(into: dict, asset: dict, name_key: str, workspace: str | None) -> str | None:
        asset_id, name = _text(asset.get("id")), _text(asset.get(name_key))
        if asset_id and name:
            into[asset_id] = (name, workspace)
        return asset_id

    for payload in _scan_payloads(scan):
        for ws in payload.get("workspaces") or []:
            workspace = _text(ws.get("name"))
            for report in ws.get("reports") or []:
                put(reports, report, "name", workspace)
            for dataset in ws.get("datasets") or []:
                model_id = put(models, dataset, "name", workspace)
                if model_id:
                    _put_members(members.setdefault(model_id, {}), dataset)
            for dashboard in ws.get("dashboards") or []:
                dashboard_id = put(dashboards, dashboard, "displayName", workspace)
                for tile in dashboard.get("tiles") or []:
                    tile_id, title = _text(tile.get("id")), _text(tile.get("title"))
                    if dashboard_id and tile_id and title and title != tile_id:
                        tiles[(dashboard_id, tile_id)] = title

    names = BiNames(path=str(scan), models=models, reports=reports, dashboards=dashboards, tiles=tiles, members=members)
    if len(_scan_cache) > 4:
        _scan_cache.clear()
    _scan_cache[key] = names
    return names


def _scan_names(bundle_dir: Path) -> BiNames | None:
    scan = find_scan(bundle_dir)
    if scan is None:
        return None
    try:
        return load_scan_names(scan)
    except Exception:  # unreadable parquet, no `response` column, ...
        logger.exception("Failed to read names from the scanner result %s", scan)
        return None


_CONTAINMENT_COLUMNS = ["parent_urn", "parent_type", "child_urn", "child_type", "relation"]
_containment_cache: dict[tuple[str, float], pd.DataFrame] = {}


def _dataset_containment(model_id: str, dataset: dict) -> list[tuple[str, str, str, str, str]]:
    """The containment rows of one scanned dataset (= semantic model): model > table > column (a field) | measure.
    urns are /<model id>[/<table>[/<column or measure>]] with the names percent-encoded."""
    model_urn = f"/{model_id}"
    rows: list[tuple[str, str, str, str, str]] = []
    for table in dataset.get("tables") or []:
        if not (table_name := _text(table.get("name"))):
            continue
        table_urn = f"{model_urn}/{quote(table_name, safe='')}"
        rows.append((model_urn, "semantic_model", table_urn, "semantic_table", "contains"))
        for child_type, items in (("field", table.get("columns")), ("measure", table.get("measures"))):
            for item in items or []:
                if name := _text(item.get("name")):
                    rows.append((table_urn, "semantic_table", f"{table_urn}/{quote(name, safe='')}", child_type, "contains"))
    return rows


def load_scan_containment(scan: Path) -> pd.DataFrame:
    """What each model in a Power BI Scanner API result contains (its tables, and their columns and measures), as the
    rows of a bundle's `attributes.parquet` (parent_urn, parent_type, child_urn, child_type, relation): the same
    facts, for a bundle that came without that file. The first of two datasets with one id is used."""
    key = (str(scan), scan.stat().st_mtime)
    if key in _containment_cache:
        return _containment_cache[key]

    rows: list[tuple[str, str, str, str, str]] = []
    seen: set[str] = set()
    for payload in _scan_payloads(scan):
        for ws in payload.get("workspaces") or []:
            for dataset in ws.get("datasets") or []:
                model_id = _text(dataset.get("id"))
                if model_id and model_id not in seen:
                    seen.add(model_id)
                    rows += _dataset_containment(model_id, dataset)

    frame = pd.DataFrame(rows, columns=_CONTAINMENT_COLUMNS)
    if len(_containment_cache) > 4:
        _containment_cache.clear()
    _containment_cache[key] = frame
    return frame


def scan_containment(bundle_dir: Path) -> pd.DataFrame | None:
    """The models > tables > fields/measures the bundle's own scanner result lists, or None if the bundle has no
    scanner result or it can't be read: only an extra, never a reason to fail."""
    scan = find_scan(bundle_dir)
    if scan is None:
        return None
    try:
        return load_scan_containment(scan)
    except Exception:
        logger.exception("Failed to read the tables of the scanner result %s", scan)
        return None


def resolve_names(bundle_dir: Path, manifest: dict | None, crawl: str | None) -> tuple[BiNames | None, dict[str, Any]]:
    """Names for a bundle, plus a description of what was found.

    `crawl` is a folder chosen by hand (the snapshot itself, or any folder above
    it); without one the crawl is looked up next to the bundle. The bundle's own
    scanner result, when it has one, names whatever the crawl does not, and all of
    it when there is no usable crawl. The info dict has `status` (`auto` / `manual`:
    a crawl is used; `bundle`: no crawl, the scanner result is used; `missing`: no
    crawl and no scanner result; `invalid`: the chosen folder is no crawl), `path`
    (the crawl used), `scan_path` (the scanner result, if the bundle has one),
    `message` and `counts` (what is named).
    """
    scan = _scan_names(bundle_dir)
    names, info = _resolve_crawl(bundle_dir, manifest, crawl)
    info["scan_path"] = scan.path if scan else None
    if scan is None:
        return names, info
    if names is not None:
        merged = names.merged_with(scan)
        info["counts"] = merged.counts()
        return merged, info
    if info["status"] == "missing":
        return scan, {"status": "bundle", "path": None, "scan_path": scan.path, "message": None, "counts": scan.counts()}
    # An invalid crawl is still reported as such (the typo is not replaced by the crawl found next to the bundle), but the
    # bundle's own names are not thrown away.
    info["counts"] = scan.counts()
    return scan, info


def _resolve_crawl(bundle_dir: Path, manifest: dict | None, crawl: str | None) -> tuple[BiNames | None, dict[str, Any]]:
    """The crawl part of resolve_names: names from the crawl, or why there are none."""
    chosen = (crawl or "").strip()
    if chosen:
        status, source = "manual", chosen
        try:
            folder = safe_resolve(chosen)
        except ValueError as exc:
            return None, {"status": "invalid", "path": None, "message": str(exc), "counts": None}
        if not folder.exists():
            return None, {"status": "invalid", "path": None, "message": f"Folder not found: {chosen}", "counts": None}
        snapshot = resolve_snapshot(folder)
        if snapshot is None:
            return None, {
                "status": "invalid",
                "path": None,
                "message": "No Power BI crawl found in this folder: expected semantic_model/, report/, tile/ … folders with parquet files, "
                           "directly in it or in a folder below it.",
                "counts": None,
            }
    else:
        status = "auto"
        snapshot = find_crawl_folder(bundle_dir, manifest)
        if snapshot is None:
            has_id = bool(str((manifest or {}).get("connectionId") or "").strip())
            return None, {
                "status": "missing",
                "path": None,
                "message": (
                    f"No {CRAWL_METADATA_DIR}/…/{(manifest or {}).get('connectionId')} folder found next to this bundle."
                    if has_id else "This bundle's manifest has no connectionId, so its crawl can't be looked up."
                ),
                "counts": None,
            }

    try:
        names = load_names(snapshot)
    except Exception as exc:  # unreadable parquet, wrong columns, ...
        logger.exception("Failed to read crawl names from %s", snapshot)
        return None, {"status": "invalid", "path": str(snapshot), "message": f"Could not read the crawl: {exc}", "counts": None}
    return names, {"status": status, "path": names.path, "message": None, "counts": names.counts()}
