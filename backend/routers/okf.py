from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

from services.filesystem import safe_resolve
from services.okf_svc import find_okf_bundle, get_okf_asset, get_okf_catalog

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/catalog")
def catalog(folder: str) -> dict:
    try:
        p = safe_resolve(folder)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    bundle = find_okf_bundle(p)
    if not bundle:
        return {"found": False}

    try:
        return get_okf_catalog(Path(bundle["bundle_path"]))
    except Exception as exc:
        logger.exception("Failed to read OKF bundle: %s", exc)
        raise HTTPException(500, str(exc))


@router.get("/asset")
def asset(folder: str, path: str) -> dict:
    try:
        p = safe_resolve(folder)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    bundle = find_okf_bundle(p)
    if not bundle:
        raise HTTPException(404, "No OKF bundle found near this folder")

    try:
        result = get_okf_asset(Path(bundle["bundle_path"]), path)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        logger.exception("Failed to read OKF asset: %s", exc)
        raise HTTPException(500, str(exc))

    if result is None:
        raise HTTPException(404, f"Asset not found: {path}")
    return result
