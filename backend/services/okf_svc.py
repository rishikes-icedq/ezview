from __future__ import annotations

import datetime
import logging
import re
from pathlib import Path
from typing import Any

import yaml

from services.analysis_svc import parse_fqn
from services.file_io import read_json, read_text

logger = logging.getLogger(__name__)

FRONTMATTER_RE = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n?(.*)$", re.DOTALL)
SECTION_RE = re.compile(r"^## (.+)$", re.MULTILINE)
TITLE_RE = re.compile(r"^# (.+)$", re.MULTILINE)
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
CONFIDENCE_RE = re.compile(r"confidence:\s*(\w+)", re.IGNORECASE)
COLUMNS_COUNT_RE = re.compile(r"\*\*Columns:\*\*\s*(\d+)")
PRIMARY_KEY_RE = re.compile(r"\*\*Primary Key:\*\*\s*(.+)")
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
PROCESS_BLOCK_RE = re.compile(
    r"\*\*(\w+)\*\*\s*—\s*process_id:\s*(\S+)\s*—\s*last seen\s*(\S+)\s*\n+```sql\n(.*?)\n```",
    re.DOTALL,
)
DATE_HEADING_RE = re.compile(r"^## (\d{4}-\d{2}-\d{2})\s*$", re.MULTILINE)
TOP_BULLET_RE = re.compile(r"^\* \*\*(\w+)\*\*:\s*(.+)$", re.MULTILINE)


# ---------------------------------------------------------------------------
# Bundle discovery
# ---------------------------------------------------------------------------

def find_okf_bundle(lineage_folder: Path) -> dict[str, str] | None:
    """Given a lineage folder (the same `folder` EZView already uses for the
    Lineage tab), locates the sibling OKF bundle for the same connection.

    The lineage folder's own manifest.json carries `connectionId`; the OKF
    bundle lives at `okf-bundle*/conn-{connectionId}` next to wherever the
    parquet files actually are. `find_lineage_bundle` can return either the
    folder the caller passed in, or that folder's parent (when the parquet
    files were found one level down, in a `lineage/` subdirectory) — so this
    checks every plausible root rather than assuming one shape.
    """
    folder = lineage_folder if lineage_folder.is_dir() else lineage_folder.parent

    manifest_path = None
    for candidate_dir in (folder, folder / "lineage"):
        mp = candidate_dir / "manifest.json"
        if mp.exists():
            manifest_path = mp
            break
    if manifest_path is None:
        return None

    try:
        manifest = read_json(manifest_path)
    except Exception:
        return None
    connection_id = manifest.get("connectionId") if isinstance(manifest, dict) else None
    if not connection_id:
        return None

    conn_dir_name = connection_id if connection_id.startswith("conn-") else f"conn-{connection_id}"

    search_roots = [manifest_path.parent.parent, folder.parent, folder]
    seen: set[Path] = set()
    for root in search_roots:
        if root in seen or not root.is_dir():
            continue
        seen.add(root)
        for cand in sorted(root.glob("okf-bundle*")):
            bundle_dir = cand / conn_dir_name
            if (bundle_dir / "bundle-info.md").exists():
                return {"bundle_path": str(bundle_dir), "connection_id": connection_id}
    return None


# ---------------------------------------------------------------------------
# Low-level markdown parsing helpers
# ---------------------------------------------------------------------------

def _jsonable(value: Any) -> Any:
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


def _split_frontmatter(text: str) -> tuple[dict, str]:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    try:
        fm = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        fm = {}
    return (fm if isinstance(fm, dict) else {}), m.group(2)


def _split_sections(body: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    matches = list(SECTION_RE.finditer(body))
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        sections[m.group(1).strip()] = body[start:end].strip()
    return sections


def _section_by_prefix(sections: dict[str, str], prefix: str) -> str:
    for heading, content in sections.items():
        if heading.startswith(prefix):
            return content
    return ""


def _split_table_row(line: str) -> list[str]:
    parts = line.strip().split("|")
    if parts and parts[0].strip() == "":
        parts = parts[1:]
    if parts and parts[-1].strip() == "":
        parts = parts[:-1]
    return [p.strip() for p in parts]


def _table_rows(section_text: str) -> list[list[str]]:
    lines = [l for l in section_text.splitlines() if l.strip().startswith("|")]
    return [_split_table_row(l) for l in lines[2:]]  # skip header + separator


def _parse_links(cell: str, asset_dir: Path, bundle_root: Path) -> list[dict]:
    results: list[dict] = []
    for piece in cell.split("<br>"):
        m = LINK_RE.search(piece)
        if not m:
            continue
        name, href = m.group(1), m.group(2)
        href_path = href.split("#", 1)[0]
        try:
            rel = str((asset_dir / href_path).resolve().relative_to(bundle_root.resolve())).replace("\\", "/")
        except ValueError:
            rel = href_path
        entry: dict[str, Any] = {"name": name, "path": rel}
        conf_m = CONFIDENCE_RE.search(piece)
        if conf_m:
            entry["confidence"] = conf_m.group(1)
        results.append(entry)
    return results


def _parse_asset_links(cell: str, asset_dir: Path, bundle_root: Path) -> list[dict]:
    return [{"name": r["name"], "path": r["path"]} for r in _parse_links(cell, asset_dir, bundle_root)]


def _parse_column_links(cell: str, asset_dir: Path, bundle_root: Path) -> list[dict]:
    out = []
    for r in _parse_links(cell, asset_dir, bundle_root):
        asset_name, _, col_name = r["name"].rpartition(".")
        if not asset_name:
            asset_name, col_name = r["name"], ""
        entry = {"asset": asset_name, "column": col_name, "path": r["path"]}
        if "confidence" in r:
            entry["confidence"] = r["confidence"]
        out.append(entry)
    return out


def _parse_table_lineage(section_text: str, asset_dir: Path, bundle_root: Path) -> tuple[list[dict], list[dict]]:
    rows = _table_rows(section_text)
    if not rows:
        return [], []
    cells = rows[0]
    upstream = _parse_asset_links(cells[0], asset_dir, bundle_root) if len(cells) > 0 else []
    downstream = _parse_asset_links(cells[1], asset_dir, bundle_root) if len(cells) > 1 else []
    return upstream, downstream


def _parse_column_details(section_text: str, asset_dir: Path, bundle_root: Path) -> list[dict]:
    columns = []
    for cells in _table_rows(section_text):
        if len(cells) < 6:
            continue
        name, dtype, transform, expression, source_cell, used_cell = cells[:6]
        columns.append({
            "name": name,
            "type": dtype,
            "transform": transform or None,
            "expression": expression or None,
            "sources": _parse_column_links(source_cell, asset_dir, bundle_root),
            "used_in": _parse_column_links(used_cell, asset_dir, bundle_root),
        })
    return columns


def _parse_process_blocks(section_text: str) -> list[dict]:
    return [
        {"query_type": m.group(1), "process_id": m.group(2), "last_seen": m.group(3), "sql": m.group(4).strip("\n")}
        for m in PROCESS_BLOCK_RE.finditer(section_text)
    ]


def _extract_primary_key(text: str) -> str | None:
    m = PRIMARY_KEY_RE.search(text)
    return m.group(1).strip() if m else None


def _extract_column_count(body: str) -> int:
    m = COLUMNS_COUNT_RE.search(body)
    return int(m.group(1)) if m else 0


def _clean_placeholder(text: str) -> str | None:
    cleaned = HTML_COMMENT_RE.sub("", text or "").strip()
    return cleaned or None


def _parse_log(bundle_path: Path) -> list[dict]:
    entries: list[dict] = []
    for log_file in sorted(bundle_path.glob("logs/**/log.md")):
        try:
            text = read_text(log_file)
        except Exception:
            continue
        date_matches = list(DATE_HEADING_RE.finditer(text))
        for i, dm in enumerate(date_matches):
            date = dm.group(1)
            block_start = dm.end()
            block_end = date_matches[i + 1].start() if i + 1 < len(date_matches) else len(text)
            block = text[block_start:block_end]

            top_matches = list(TOP_BULLET_RE.finditer(block))
            for j, tm in enumerate(top_matches):
                detail_start = tm.end()
                detail_end = top_matches[j + 1].start() if j + 1 < len(top_matches) else len(block)
                detail_block = block[detail_start:detail_end]
                details = [
                    line.strip().lstrip("*").strip()
                    for line in detail_block.splitlines()
                    if line.strip().startswith("*")
                ]
                entries.append({
                    "date": date,
                    "kind": tm.group(1),
                    "summary": tm.group(2).strip(),
                    "details": details,
                })
    entries.sort(key=lambda e: e["date"], reverse=True)
    return entries


def _parse_review_queue(bundle_path: Path) -> dict:
    path = bundle_path / "_needs-review.md"
    if not path.exists():
        return {"blocked": [], "events": []}
    _, body = _split_frontmatter(read_text(path))
    sections = _split_sections(body)

    def _items(text: str) -> list[str]:
        items = []
        for line in text.splitlines():
            stripped = line.strip()
            if not (stripped.startswith("*") or stripped.startswith("-")):
                continue
            content = stripped.lstrip("*-").strip()
            if content.startswith("(none") or content.startswith("(empty"):
                continue
            items.append(content)
        return items

    return {
        "blocked": _items(_section_by_prefix(sections, "[BLOCKED]")),
        "events": _items(_section_by_prefix(sections, "[EVENT]")),
    }


def _parse_bundle_info(bundle_path: Path) -> dict:
    path = bundle_path / "bundle-info.md"
    fm, body = _split_frontmatter(read_text(path))
    sections = _split_sections(body)

    counts: dict[str, int] = {}
    for cells in _table_rows(sections.get("Summary", "")):
        if len(cells) == 2:
            try:
                counts[cells[0].strip().lower()] = int(cells[1].strip())
            except ValueError:
                pass

    generated = fm.get("generated") if isinstance(fm.get("generated"), dict) else {}

    return {
        "connection_id": fm.get("connection_id"),
        "generated_at": generated.get("at"),
        "summary": {
            "databases": counts.get("databases", 0),
            "schemas": counts.get("schemas", 0),
            "tables": counts.get("tables", 0),
            "views": counts.get("views", 0),
            "columns": counts.get("columns", 0),
        },
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_okf_catalog(bundle_path: Path) -> dict:
    info = _parse_bundle_info(bundle_path)
    databases: dict[str, dict] = {}

    for schema_meta_path in sorted(bundle_path.rglob("_schema.md")):
        schema_dir = schema_meta_path.parent
        database_dir = schema_dir.parent
        database_meta_path = database_dir / "_database.md"

        db_fm, _ = _split_frontmatter(read_text(database_meta_path)) if database_meta_path.exists() else ({}, "")
        schema_fm, _ = _split_frontmatter(read_text(schema_meta_path))

        db_parsed = parse_fqn(str(db_fm.get("kg_asset_fqn") or ""))
        schema_parsed = parse_fqn(str(schema_fm.get("kg_asset_fqn") or ""))
        db_name = db_parsed.get("database") or database_dir.name
        schema_name = schema_parsed.get("schema") or schema_dir.name

        assets = []
        for md_path in sorted(schema_dir.glob("*.md")):
            if md_path.name in ("_schema.md", "index.md"):
                continue
            fm, body = _split_frontmatter(read_text(md_path))
            parsed_fqn = parse_fqn(str(fm.get("kg_asset_fqn") or ""))
            tags = fm.get("tags") or []
            assets.append({
                "name": parsed_fqn.get("table") or md_path.stem.upper(),
                "type": "view" if "view" in tags else "table",
                "status": fm.get("status", ""),
                "tags": tags,
                "column_count": _extract_column_count(body),
                "path": str(md_path.relative_to(bundle_path)).replace("\\", "/"),
            })

        databases.setdefault(db_name, {"database": db_name, "schemas": []})
        databases[db_name]["schemas"].append({
            "schema": schema_name,
            "owner": schema_fm.get("owner"),
            "assets": assets,
        })

    return _jsonable({
        "found": True,
        **info,
        "databases": list(databases.values()),
        "review_queue": _parse_review_queue(bundle_path),
        "history": _parse_log(bundle_path),
    })


def get_okf_asset(bundle_path: Path, rel_path: str) -> dict | None:
    bundle_root = bundle_path.resolve()
    target = (bundle_path / rel_path).resolve()
    try:
        target.relative_to(bundle_root)
    except ValueError:
        raise ValueError("Path escapes bundle root")
    if not target.exists() or not target.is_file():
        return None

    fm, body = _split_frontmatter(read_text(target))
    sections = _split_sections(body)
    asset_dir = target.parent

    parsed_fqn = parse_fqn(str(fm.get("kg_asset_fqn") or ""))
    tags = fm.get("tags") or []
    upstream, downstream = _parse_table_lineage(sections.get("Table Lineage", ""), asset_dir, bundle_root)

    return _jsonable({
        "name": parsed_fqn.get("table") or target.stem.upper(),
        "type": "view" if "view" in tags else "table",
        "status": fm.get("status", ""),
        "description": fm.get("description"),
        "owner": fm.get("owner"),
        "tags": tags,
        "created_at": fm.get("created_at"),
        "fqn": fm.get("kg_asset_fqn", ""),
        "database": parsed_fqn.get("database", ""),
        "schema": parsed_fqn.get("schema", ""),
        "column_count": _extract_column_count(body),
        "upstream": upstream,
        "downstream": downstream,
        "columns": _parse_column_details(sections.get("Column Details", ""), asset_dir, bundle_root),
        "primary_key": _extract_primary_key(sections.get("Keys", "")),
        "written_by": _parse_process_blocks(sections.get("Written by", "")),
        "read_by": _parse_process_blocks(sections.get("Read by", "")),
        "business_context": _clean_placeholder(sections.get("Business Context", "")),
        "data_quality": _clean_placeholder(sections.get("Data Quality", "")),
    })
