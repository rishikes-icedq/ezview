from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException

from services.analysis_svc import (
    apply_bi_names,
    build_asset_tree,
    compute_summary,
    get_edge_page,
    get_flow_pairs,
    get_column_lineage,
    get_lineage_graph,
    get_mapping_graph,
    get_processes,
    has_bi_assets,
)
from services.bi_names_svc import BiNames, resolve_names, scan_containment
from services.file_io import read_json
from services.filesystem import find_lineage_bundle, safe_resolve
from services.parquet_svc import read_df

router = APIRouter()
logger = logging.getLogger(__name__)


def _load_bundle(folder: str) -> tuple[Any, Any, dict | None]:
    try:
        p = safe_resolve(folder)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    bundle = find_lineage_bundle(p)
    if not bundle:
        raise HTTPException(404, "No processes.parquet + edges.parquet found in this folder")

    try:
        processes_df = read_df(Path(bundle["processes"]))
        edges_df = read_df(Path(bundle["edges"]))
    except Exception as exc:
        logger.exception("Failed to read parquet: %s", exc)
        raise HTTPException(500, str(exc))

    manifest: dict | None = None
    if bundle.get("manifest"):
        try:
            manifest = read_json(Path(bundle["manifest"]))
        except Exception:
            pass

    return edges_df, processes_df, manifest


def _bi_names(folder: str, manifest: dict | None, crawl: str | None) -> tuple[BiNames | None, dict]:
    """Power BI names for the bundle in `folder`: from the crawl folder `crawl` if one
    was chosen, otherwise from the crawl found next to the bundle."""
    bundle = find_lineage_bundle(safe_resolve(folder))
    bundle_dir = Path(bundle["edges"]).parent if bundle else safe_resolve(folder)
    return resolve_names(bundle_dir, manifest, crawl)


def _load_attributes(folder: str):
    """What contains what in the bundle's Power BI models (models > tables > fields and measures): the tables
    its own scanner result lists (stage2/powerbi_scan_result.parquet, with the names as written), or, for a bundle
    without one, its attributes.parquet (whose newer layout only has names as spelled in asset ids). None when
    neither can be read: only an extra, never a reason to fail."""
    bundle = find_lineage_bundle(safe_resolve(folder))
    if not bundle:
        return None
    bundle_dir = Path(bundle["edges"]).parent
    scanned = scan_containment(bundle_dir)
    if scanned is not None and not scanned.empty:
        return scanned
    file = bundle_dir / "attributes.parquet"
    if file.is_file():
        try:
            return read_df(file)
        except Exception:
            logger.exception("Failed to read %s", file)
    return None


@router.get("/detect")
def detect(path: str) -> dict:
    try:
        p = safe_resolve(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not p.exists():
        raise HTTPException(404, f"Path not found: {path}")
    bundle = find_lineage_bundle(p)
    if not bundle:
        raise HTTPException(404, "No lineage bundle found near this path")
    return bundle


@router.get("/summary")
def summary(folder: str) -> dict:
    edges_df, processes_df, manifest = _load_bundle(folder)
    return compute_summary(edges_df, processes_df, manifest)


@router.get("/assets")
def assets(folder: str, crawl: str | None = None) -> list:
    edges_df, _, manifest = _load_bundle(folder)
    names = _bi_names(folder, manifest, crawl)[0] if has_bi_assets(edges_df) else None
    return build_asset_tree(edges_df, names)


@router.get("/bi-names")
def bi_names(folder: str, crawl: str | None = None) -> dict:
    """Where the Power BI names come from: `status` is `auto` (crawl found next to the
    bundle), `manual` (the `crawl` folder), `bundle` (no crawl, but the bundle's own scanner
    result in stage2/ names its assets), `missing` (nothing found) or `invalid` (the `crawl`
    folder is not a crawl); plus the crawl `path` used, the `scan_path` (the bundle's scanner
    result, which fills in what a crawl lacks), a `message` and `counts`."""
    edges_df, _, manifest = _load_bundle(folder)
    if not has_bi_assets(edges_df):
        return {"status": "none", "path": None, "message": "This lineage has no Power BI assets.", "counts": None}
    return _bi_names(folder, manifest, crawl)[1]


@router.get("/edges")
def edges(
    folder: str,
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
) -> dict:
    edges_df, _, _ = _load_bundle(folder)
    return get_edge_page(
        edges_df,
        page=page,
        page_size=page_size,
        confidence=confidence or None,
        transform=transform or None,
        direction=direction or None,
        source_type=source_type or None,
        target_type=target_type or None,
        source_search=source_search or None,
        target_search=target_search or None,
        sort_by=sort_by or None,
        sort_dir=sort_dir,
    )


@router.get("/processes")
def processes(folder: str) -> list:
    _, processes_df, _ = _load_bundle(folder)
    return get_processes(processes_df)


@router.get("/flow")
def flow(folder: str) -> list:
    edges_df, _, _ = _load_bundle(folder)
    return get_flow_pairs(edges_df)


@router.get("/column-lineage")
def column_lineage(folder: str, model: str, table: str, crawl: str | None = None) -> dict:
    """Field by field, where the fields of one table of a Power BI model come from and where they go."""
    edges_df, _, manifest = _load_bundle(folder)
    names = _bi_names(folder, manifest, crawl)[0] if has_bi_assets(edges_df) else None
    result = get_column_lineage(edges_df, _load_attributes(folder), model, table, names)
    if result is None:
        raise HTTPException(404, f"The bundle does not list a table '{table}' for model {model}")
    return result


@router.get("/graph")
def graph(folder: str, mode: Literal["all", "mapping"] = "all", crawl: str | None = None) -> dict:
    edges_df, processes_df, manifest = _load_bundle(folder)
    result = get_mapping_graph(edges_df) if mode == "mapping" else get_lineage_graph(edges_df, processes_df, _load_attributes(folder))
    if has_bi_assets(edges_df):
        names = _bi_names(folder, manifest, crawl)[0]
        if names:
            apply_bi_names(result, names)
    return result
