from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

from services.file_io import read_text
from services.filesystem import (
    detect_file_type,
    classify_parquet_role,
    find_lineage_bundle,
    get_root_paths,
    get_suggested_actions,
    list_dir,
    open_native_picker,
    safe_resolve,
)

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_READ_TEXT_BYTES = 5 * 1024 * 1024  # 5 MB


@router.get("/roots")
def get_roots() -> list[dict]:
    return get_root_paths()


@router.get("/pick")
def pick(mode: str = "folder") -> dict:
    if mode not in ("folder", "file"):
        raise HTTPException(400, "mode must be 'folder' or 'file'")
    path = open_native_picker(mode)
    return {"path": path}


@router.get("/read-text")
def read_text_route(path: str) -> dict:
    try:
        p = safe_resolve(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not p.exists():
        raise HTTPException(404, f"Path not found: {path}")
    if not p.is_file():
        raise HTTPException(400, "Path is not a file")
    size = p.stat().st_size
    if size > MAX_READ_TEXT_BYTES:
        raise HTTPException(413, f"File too large to load ({size} bytes, limit {MAX_READ_TEXT_BYTES})")
    try:
        return {"path": str(p), "name": p.name, "content": read_text(p), "size": size}
    except Exception as exc:
        logger.exception("read-text failed: %s", exc)
        raise HTTPException(500, str(exc))


@router.get("/list")
def list_directory(path: str) -> dict:
    try:
        p = safe_resolve(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    if not p.exists():
        raise HTTPException(404, f"Path not found: {path}")
    if not p.is_dir():
        raise HTTPException(400, "Path is not a directory")

    return {"path": str(p), "entries": list_dir(p)}


@router.get("/detect")
def detect(path: str) -> dict:
    try:
        p = safe_resolve(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    if not p.exists():
        raise HTTPException(404, f"Path not found: {path}")

    ft = detect_file_type(p)
    result: dict = {
        "path": str(p),
        "name": p.name,
        "file_type": ft,
        "suggested_actions": get_suggested_actions(p),
    }

    if ft == "parquet":
        result["parquet_role"] = classify_parquet_role(p)

    bundle = find_lineage_bundle(p)
    if bundle:
        result["lineage_bundle"] = bundle

    return result
