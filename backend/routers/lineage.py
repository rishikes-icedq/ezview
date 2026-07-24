from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from services.analysis_svc import (
    build_asset_tree,
    compute_summary,
    get_edge_page,
    get_flow_pairs,
    get_lineage_graph,
    get_processes,
)
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
def assets(folder: str) -> list:
    edges_df, _, _ = _load_bundle(folder)
    return build_asset_tree(edges_df)


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


@router.get("/graph")
def graph(folder: str) -> dict:
    edges_df, processes_df, _ = _load_bundle(folder)
    return get_lineage_graph(edges_df, processes_df)
