from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.snippets_svc import load_snippets, save_snippets

router = APIRouter()
logger = logging.getLogger(__name__)


class SnippetsBody(BaseModel):
    collections: list[dict]


@router.get("")
def get_snippets() -> dict:
    try:
        return load_snippets()
    except Exception as exc:
        logger.exception("Failed to load snippets: %s", exc)
        raise HTTPException(500, str(exc))


@router.put("")
def put_snippets(body: SnippetsBody) -> dict:
    try:
        return save_snippets(body.model_dump())
    except Exception as exc:
        logger.exception("Failed to save snippets: %s", exc)
        raise HTTPException(500, str(exc))
