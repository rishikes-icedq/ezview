"""Tests for filesystem detection, listing, and browser router."""
from __future__ import annotations

from pathlib import Path

import pytest

from services.filesystem import (
    classify_parquet_role,
    detect_file_type,
    find_lineage_bundle,
    get_suggested_actions,
    list_dir,
    safe_resolve,
)


def test_safe_resolve_null_byte():
    with pytest.raises(ValueError, match="Null byte"):
        safe_resolve("C:/foo\x00bar")


def test_safe_resolve_normal():
    p = safe_resolve("C:/Windows")
    assert p.is_absolute()


def test_detect_parquet(tmp_path: Path):
    f = tmp_path / "data.parquet"
    f.touch()
    assert detect_file_type(f) == "parquet"


def test_detect_json(tmp_path: Path):
    f = tmp_path / "manifest.json"
    f.touch()
    assert detect_file_type(f) == "json"


def test_detect_markdown(tmp_path: Path):
    f = tmp_path / "notes.md"
    f.touch()
    assert detect_file_type(f) == "markdown"


def test_detect_directory(tmp_path: Path):
    assert detect_file_type(tmp_path) == "directory"


def test_detect_unknown(tmp_path: Path):
    f = tmp_path / "file.xyz"
    f.touch()
    assert detect_file_type(f) == "unknown"


@pytest.mark.parametrize("name,expected", [
    ("edges.parquet", "edges"),
    ("processes.parquet", "processes"),
    ("results.parquet", "results"),
    ("gbq-results.parquet", "results"),
    ("snowflake_query_history.parquet", "query_history"),
    ("snowflake_access_history.parquet", "access_history"),
    ("something_else.parquet", "other"),
])
def test_classify_parquet_role(tmp_path: Path, name: str, expected: str):
    f = tmp_path / name
    f.touch()
    assert classify_parquet_role(f) == expected


def test_list_dir_skips_hidden(tmp_path: Path):
    (tmp_path / ".hidden").touch()
    (tmp_path / "visible.txt").touch()
    entries = list_dir(tmp_path)
    names = [e["name"] for e in entries]
    assert "visible.txt" in names
    assert ".hidden" not in names


def test_list_dir_returns_type(tmp_path: Path):
    (tmp_path / "subdir").mkdir()
    (tmp_path / "file.txt").touch()
    entries = {e["name"]: e["type"] for e in list_dir(tmp_path)}
    assert entries["subdir"] == "directory"
    assert entries["file.txt"] == "file"


def test_find_lineage_bundle_direct(lineage_folder: Path):
    bundle = find_lineage_bundle(lineage_folder)
    assert bundle is not None
    assert Path(bundle["processes"]).name == "processes.parquet"
    assert Path(bundle["edges"]).name == "edges.parquet"


def test_find_lineage_bundle_via_file(lineage_folder: Path):
    f = lineage_folder / "edges.parquet"
    bundle = find_lineage_bundle(f)
    assert bundle is not None


def test_find_lineage_bundle_nested(tmp_path: Path):
    nested = tmp_path / "lineage"
    nested.mkdir()
    (nested / "processes.parquet").touch()
    (nested / "edges.parquet").touch()
    bundle = find_lineage_bundle(tmp_path)
    assert bundle is not None


def test_find_lineage_bundle_missing(tmp_path: Path):
    assert find_lineage_bundle(tmp_path) is None


def test_suggested_actions_parquet_edges(tmp_path: Path):
    f = tmp_path / "edges.parquet"
    f.touch()
    actions = get_suggested_actions(f)
    assert "analyze_lineage" in actions
    assert "view_table" in actions


def test_suggested_actions_markdown(tmp_path: Path):
    f = tmp_path / "readme.md"
    f.touch()
    assert get_suggested_actions(f) == ["edit_markdown"]


def test_suggested_actions_json_no_duplicates(tmp_path: Path):
    for name in ("manifest.json", "stage4_foo.json", "queries.json"):
        f = tmp_path / name
        f.touch()
        assert get_suggested_actions(f) == ["view_json"]


# -- API route smoke tests --

def test_browser_roots_returns_list(client):
    resp = client.get("/api/browser/roots")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_browser_list_invalid_path(client):
    resp = client.get("/api/browser/list?path=/nonexistent_path_xyz_12345")
    assert resp.status_code == 404


def test_browser_pick_invalid_mode(client):
    resp = client.get("/api/browser/pick?mode=bogus")
    assert resp.status_code == 400


def test_browser_pick_folder(client, monkeypatch):
    # Never invoke the real tkinter dialog in tests — it would block waiting
    # for a human. Stub the picker at the router's import site instead.
    import routers.browser as browser_router
    monkeypatch.setattr(browser_router, "open_native_picker", lambda mode: "/fake/picked/path")
    resp = client.get("/api/browser/pick?mode=folder")
    assert resp.status_code == 200
    assert resp.json() == {"path": "/fake/picked/path"}


def test_browser_pick_cancelled_returns_none(client, monkeypatch):
    import routers.browser as browser_router
    monkeypatch.setattr(browser_router, "open_native_picker", lambda mode: None)
    resp = client.get("/api/browser/pick?mode=file")
    assert resp.status_code == 200
    assert resp.json() == {"path": None}


def test_read_text_route(client, tmp_path: Path):
    f = tmp_path / "notes.sql"
    f.write_text("SELECT 1")
    resp = client.get(f"/api/browser/read-text?path={f}")
    assert resp.status_code == 200
    assert resp.json()["content"] == "SELECT 1"


def test_read_text_not_found(client):
    resp = client.get("/api/browser/read-text?path=/nonexistent_path_xyz_12345")
    assert resp.status_code == 404


def test_read_text_directory_rejected(client, tmp_path: Path):
    resp = client.get(f"/api/browser/read-text?path={tmp_path}")
    assert resp.status_code == 400


def test_read_text_too_large(client, tmp_path: Path, monkeypatch):
    import routers.browser as browser_router
    monkeypatch.setattr(browser_router, "MAX_READ_TEXT_BYTES", 10)
    f = tmp_path / "big.txt"
    f.write_text("x" * 100)
    resp = client.get(f"/api/browser/read-text?path={f}")
    assert resp.status_code == 413


def test_browser_detect_parquet(client, edges_parquet: Path):
    resp = client.get(f"/api/browser/detect?path={edges_parquet}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["file_type"] == "parquet"
    assert data["parquet_role"] == "edges"
