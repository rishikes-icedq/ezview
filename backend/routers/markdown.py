from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from services.file_io import read_text, write_text
from services.filesystem import safe_resolve

router = APIRouter()
logger = logging.getLogger(__name__)


def _require_md(path: str) -> Path:
    try:
        p = safe_resolve(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not p.exists():
        raise HTTPException(404, f"File not found: {path}")
    if p.suffix.lower() not in (".md", ".markdown"):
        raise HTTPException(400, "Not a markdown file")
    return p


@router.get("/read")
def read(path: str) -> dict:
    p = _require_md(path)
    try:
        return {"path": str(p), "name": p.name, "content": read_text(p)}
    except Exception as exc:
        logger.exception("Markdown read failed: %s", exc)
        raise HTTPException(500, str(exc))


class WriteBody(BaseModel):
    path: str
    content: str


@router.post("/write")
def write(body: WriteBody) -> dict:
    try:
        p = safe_resolve(body.path)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    try:
        write_text(p, body.content)
        return {"ok": True, "path": str(p)}
    except Exception as exc:
        logger.exception("Markdown write failed: %s", exc)
        raise HTTPException(500, str(exc))


@router.get("/download")
def download(path: str) -> Response:
    p = _require_md(path)
    try:
        content = read_text(p)
        return Response(
            content=content.encode(),
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{p.name}"'},
        )
    except Exception as exc:
        raise HTTPException(500, str(exc))
