from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_FILE_TYPE_MAP: dict[str, str] = {
    ".parquet": "parquet",
    ".json": "json",
    ".md": "markdown",
    ".markdown": "markdown",
    ".txt": "text",
    ".log": "text",
    ".csv": "text",
    ".sql": "text",
}


def safe_resolve(path_str: str) -> Path:
    if "\x00" in path_str:
        raise ValueError("Null byte in path")
    return Path(path_str).resolve()


def list_dir(path: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    try:
        items = sorted(path.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
        for entry in items:
            if entry.name.startswith("."):
                continue
            try:
                stat = entry.stat()
                entries.append({
                    "name": entry.name,
                    "path": str(entry),
                    "type": "file" if entry.is_file() else "directory",
                    "size": stat.st_size if entry.is_file() else None,
                    "modified": stat.st_mtime,
                    "extension": entry.suffix.lower() if entry.is_file() else None,
                })
            except (PermissionError, OSError) as exc:
                logger.debug("Skip %s: %s", entry, exc)
    except (PermissionError, OSError) as exc:
        logger.warning("Cannot list %s: %s", path, exc)
    return entries


def detect_file_type(path: Path) -> str:
    if path.is_dir():
        return "directory"
    return _FILE_TYPE_MAP.get(path.suffix.lower(), "unknown")


def classify_parquet_role(path: Path) -> str:
    name = path.stem.lower()
    if name == "processes":
        return "processes"
    if name == "edges":
        return "edges"
    if "results" in name:
        return "results"
    if "query_history" in name:
        return "query_history"
    if "access_history" in name:
        return "access_history"
    if "liveness" in name:
        return "liveness"
    if "databases" in name:
        return "databases"
    return "other"


def get_suggested_actions(path: Path) -> list[str]:
    if path.is_dir():
        bundle = find_lineage_bundle(path)
        return ["analyze_lineage", "browse"] if bundle else ["browse"]

    ft = detect_file_type(path)
    if ft == "parquet":
        role = classify_parquet_role(path)
        actions = ["convert_to_json", "view_table"]
        if role in ("processes", "edges"):
            actions.insert(0, "analyze_lineage")
        return actions
    if ft == "json":
        return ["view_json"]
    if ft == "markdown":
        return ["edit_markdown"]
    if ft == "text":
        return ["view_text"]
    return ["view_text"]


def find_lineage_bundle(path: Path) -> dict[str, Any] | None:
    folder = path if path.is_dir() else path.parent
    candidates = [folder, folder / "lineage"]

    processes = edges = manifest = None
    for d in candidates:
        if not d.is_dir():
            continue
        if processes is None and (d / "processes.parquet").exists():
            processes = str(d / "processes.parquet")
        if edges is None and (d / "edges.parquet").exists():
            edges = str(d / "edges.parquet")
        if manifest is None and (d / "manifest.json").exists():
            manifest = str(d / "manifest.json")

    if processes and edges:
        return {"folder": str(folder), "processes": processes, "edges": edges, "manifest": manifest}
    return None


def get_root_paths() -> list[dict[str, str]]:
    roots: list[dict[str, str]] = []
    current_file = Path(__file__).resolve()
    ezview_root = current_file.parent.parent.parent  # ezview/
    sibling_lineage = ezview_root.parent / "data-lineage"

    if sibling_lineage.is_dir():
        roots.append({"label": "data-lineage", "path": str(sibling_lineage)})
        staged = sibling_lineage / "staged_output"
        if staged.is_dir():
            roots.append({"label": "staged_output", "path": str(staged)})

    home = Path.home()
    roots.append({"label": "Home", "path": str(home)})
    docs = home / "Documents"
    if docs.is_dir():
        roots.append({"label": "Documents", "path": str(docs)})

    return roots


def open_native_picker(mode: str) -> str | None:
    """Blocks the calling thread while the OS's native folder/file picker is
    shown. Only appropriate for a local, single-user desktop tool (see
    CLAUDE.md) — never call this from a shared/hosted deployment."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        if mode == "file":
            path = filedialog.askopenfilename(parent=root, title="Select a file")
        else:
            path = filedialog.askdirectory(parent=root, title="Select a folder")
    finally:
        root.destroy()
    return path or None
