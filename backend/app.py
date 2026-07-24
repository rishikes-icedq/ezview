from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from utils.logging_config import setup_logging
from routers import browser, json_files, lineage, markdown, parquet, snippets

setup_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title="EZView", version="1.0.0", description="Local file viewer & lineage analyser")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(browser.router, prefix="/api/browser", tags=["browser"])
app.include_router(parquet.router, prefix="/api/parquet", tags=["parquet"])
app.include_router(json_files.router, prefix="/api/json", tags=["json"])
app.include_router(markdown.router, prefix="/api/markdown", tags=["markdown"])
app.include_router(lineage.router, prefix="/api/lineage", tags=["lineage"])
app.include_router(snippets.router, prefix="/api/snippets", tags=["snippets"])


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": "1.0.0"}


# Serve built frontend in production (after npm run build)
_dist = Path(__file__).parent.parent / "frontend" / "dist"
if _dist.is_dir():
    logger.info("Serving frontend from %s", _dist)
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="spa")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True, log_level="info")
