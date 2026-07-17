from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from services.file_io import read_json, write_json
from services.filesystem import safe_resolve

router = APIRouter()
logger = logging.getLogger(__name__)


def _require_json(path: str) -> Path:
    try:
        p = safe_resolve(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not p.exists():
        raise HTTPException(404, f"File not found: {path}")
    if p.suffix.lower() != ".json":
        raise HTTPException(400, "Not a .json file")
    return p


@router.get("/read")
def read(path: str) -> Any:
    p = _require_json(path)
    try:
        return read_json(p)
    except json.JSONDecodeError as exc:
        raise HTTPException(422, f"Invalid JSON: {exc}")
    except Exception as exc:
        logger.exception("JSON read failed: %s", exc)
        raise HTTPException(500, str(exc))


class WriteBody(BaseModel):
    path: str
    content: Any


@router.post("/write")
def write(body: WriteBody) -> dict:
    try:
        p = safe_resolve(body.path)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    try:
        write_json(p, body.content)
        return {"ok": True, "path": str(p)}
    except Exception as exc:
        logger.exception("JSON write failed: %s", exc)
        raise HTTPException(500, str(exc))


@router.get("/download")
def download(path: str) -> Response:
    p = _require_json(path)
    try:
        data = read_json(p)
        text = json.dumps(data, indent=2, ensure_ascii=False)
        return Response(
            content=text.encode(),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{p.name}"'},
        )
    except Exception as exc:
        raise HTTPException(500, str(exc))
