"""Tests for atomic file I/O."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.file_io import read_json, read_text, write_json, write_text


def test_json_round_trip(tmp_path: Path):
    p = tmp_path / "data.json"
    data = {"key": "value", "num": 42, "nested": {"a": [1, 2, 3]}}
    write_json(p, data)
    assert read_json(p) == data


def test_json_write_is_formatted(tmp_path: Path):
    p = tmp_path / "pretty.json"
    write_json(p, {"a": 1})
    raw = p.read_text()
    assert "\n" in raw  # multi-line = indented


def test_json_write_replaces_atomically(tmp_path: Path):
    p = tmp_path / "out.json"
    write_json(p, {"v": 1})
    write_json(p, {"v": 2})
    assert read_json(p) == {"v": 2}


def test_json_no_tmp_file_left(tmp_path: Path):
    p = tmp_path / "clean.json"
    write_json(p, {})
    tmp = p.with_suffix(".tmp")
    assert not tmp.exists()


def test_text_round_trip(tmp_path: Path):
    p = tmp_path / "doc.md"
    content = "# Hello\n\nWorld"
    write_text(p, content)
    assert read_text(p) == content


def test_text_newline_normalised(tmp_path: Path):
    p = tmp_path / "crlf.txt"
    write_text(p, "line1\nline2")
    assert "\r\n" not in read_text(p)


def test_read_json_invalid(tmp_path: Path):
    p = tmp_path / "bad.json"
    p.write_text("not json")
    with pytest.raises(json.JSONDecodeError):
        read_json(p)
