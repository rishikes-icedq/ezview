"""Tests for the persisted snippets library (services + API routes)."""
from __future__ import annotations

from pathlib import Path

import pytest

from services import snippets_svc


@pytest.fixture(autouse=True)
def isolate_snippets_storage(tmp_path: Path, monkeypatch):
    """Point the snippets store at a tmp_path so tests never touch real app data."""
    data_dir = tmp_path / "data"
    monkeypatch.setattr(snippets_svc, "DATA_DIR", data_dir)
    monkeypatch.setattr(snippets_svc, "SNIPPETS_FILE", data_dir / "snippets.json")


SAMPLE = {
    "collections": [
        {
            "id": "c1",
            "title": "Lineage commands",
            "groups": [
                {
                    "id": "g1",
                    "title": "Snowflake Lineage",
                    "snippets": [
                        {"id": "s1", "title": "Stage 1", "content": "python scripts/run_stage1.py"},
                    ],
                },
            ],
            "snippets": [],
        },
    ],
}


def test_load_snippets_missing_file_returns_empty():
    assert snippets_svc.load_snippets() == {"collections": []}


def test_save_then_load_round_trips():
    snippets_svc.save_snippets(SAMPLE)
    assert snippets_svc.load_snippets() == SAMPLE


def test_save_creates_data_dir(tmp_path: Path):
    assert not snippets_svc.DATA_DIR.exists()
    snippets_svc.save_snippets(SAMPLE)
    assert snippets_svc.DATA_DIR.exists()
    assert snippets_svc.SNIPPETS_FILE.exists()


def test_save_overwrites_atomically():
    snippets_svc.save_snippets(SAMPLE)
    other = {"collections": [{"id": "c2", "title": "Other", "groups": [], "snippets": []}]}
    snippets_svc.save_snippets(other)
    assert snippets_svc.load_snippets() == other
    assert not snippets_svc.SNIPPETS_FILE.with_suffix(".tmp").exists()


def test_snippets_api_get_empty(client):
    resp = client.get("/api/snippets")
    assert resp.status_code == 200
    assert resp.json() == {"collections": []}


def test_snippets_api_put_then_get_round_trips(client):
    resp = client.put("/api/snippets", json=SAMPLE)
    assert resp.status_code == 200
    assert resp.json() == SAMPLE

    resp = client.get("/api/snippets")
    assert resp.status_code == 200
    assert resp.json() == SAMPLE


def test_snippets_api_put_requires_collections_field(client):
    resp = client.put("/api/snippets", json={})
    assert resp.status_code == 422
