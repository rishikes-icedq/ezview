from __future__ import annotations

from pathlib import Path

from services.file_io import read_json, write_json

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SNIPPETS_FILE = DATA_DIR / "snippets.json"
EMPTY: dict = {"collections": []}


def load_snippets() -> dict:
    if not SNIPPETS_FILE.exists():
        return EMPTY
    return read_json(SNIPPETS_FILE)


def save_snippets(data: dict) -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_json(SNIPPETS_FILE, data)
    return data
