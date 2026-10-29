"""Tests for OKF bundle discovery, markdown parsing, and API routes."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.okf_svc import find_okf_bundle, get_okf_asset, get_okf_catalog

BUNDLE_INFO_MD = """---
type: iceDQ Bundle Info
title: iceDQ Knowledge Bundle
connection_id: conn-test123
system_urn: /testsys
icedq_okf_generator_version: '0.2'
generated: { by: icedq-okf-generator/0.2, at: 2026-01-15T10:00:00Z }
---

# OKF Bundle

## Summary

| Metric | Count |
|---|---|
| Databases | 1 |
| Schemas | 1 |
| Tables | 1 |
| Views | 1 |
| Columns | 2 |
"""

NEEDS_REVIEW_MD = """---
type: iceDQ Review Queue
title: Review queue
generated: { by: icedq-okf-generator/0.2, at: 2026-01-15T10:00:00Z }
---

## [BLOCKED] — Pending suggestions

*(none — no certified assets with blocked suggestions this run)*

## [EVENT] — Lifecycle notifications

*(none — no deprecation, resurrection, or cascade events this run)*
"""

LOG_MD = """# Bundle Update Log

## 2026-01-15
* **Creation**: Created the bundle from the crawl snapshot and enriched it with lineage.
  * generated: { by: icedq-okf-generator/0.1, at: 2026-01-15T10:00:00Z }
  * enrichment_type: create-with-lineage
    * tables: 1
    * views: 1
    * columns: 2
  * lineage_run_id: test-run-1
    * processes: 1 (1 with raw SQL)
    * edges: 3 (maps_to 1, writes_to 1, read_by 1)
"""

CONNECTION_MD = """---
type: Snowflake Connection
title: conn-test123
kg_asset_fqn: /testsys/snowflake
status: stable
tags: [snowflake, testsys]
created_at: "2026-01-01T00:00:00Z"
---

# Connection
"""

DATABASE_MD = """---
type: Snowflake Database
title: TESTDB
kg_asset_fqn: /testsys/snowflake/TESTDB
status: stable
tags: [snowflake, testdb]
created_at: "2026-01-01T00:00:00Z"
---

# TESTDB
"""

SCHEMA_MD = """---
type: Snowflake Schema
title: TESTDB.TESTSCHEMA
kg_asset_fqn: /testsys/snowflake/TESTDB/TESTSCHEMA
status: stable
owner: TEST_ROLE
tags: [snowflake, testdb, testschema]
created_at: "2026-01-01T00:00:00Z"
---

# TESTSCHEMA
"""

SOURCE_TABLE_MD = """---
type: Snowflake Table
title: TESTDB.TESTSCHEMA.SOURCE_TABLE
kg_asset_fqn: /testsys/snowflake/TESTDB/TESTSCHEMA/SOURCE_TABLE
status: stable
description: A source staging table.
owner: TEST_ROLE
tags: [snowflake, testdb, testschema, table, source]
created_at: "2026-01-01T00:00:00Z"
---

# SOURCE_TABLE

**Database:** TESTDB | **Schema:** TESTSCHEMA | **Columns:** 2

## Table Lineage

| Upstream Tables / Views | Downstream Tables / Views |
|---|---|
| *(none)* | [TARGET_VIEW](./target-view.md) |

## Column Details

| Column | Type | Transform | Expression | Source (upstream) | Used in (downstream) |
|---|---|---|---|---|---|
| ID | NUMBER |  |  | *(none)* | *(none)* |
| CUSTOMERID | VARCHAR |  |  | *(none)* | [TARGET_VIEW.CUSTOMERID](./target-view.md#col-customerid) *(confidence: HIGH)* |

## Keys

- **Primary Key:** ID

## Read by

**CREATE_VIEW** — process_id: proc-view-1 — last seen 2026-01-15

```sql
create or replace VIEW TESTDB.TESTSCHEMA.TARGET_VIEW (CUSTOMERID) AS
SELECT CUSTOMERID FROM TESTDB.TESTSCHEMA.SOURCE_TABLE
```

## Business Context

<!-- Reserved -->
"""

TARGET_VIEW_MD = """---
type: Snowflake View
title: TESTDB.TESTSCHEMA.TARGET_VIEW
kg_asset_fqn: /testsys/snowflake/TESTDB/TESTSCHEMA/TARGET_VIEW
status: stable
tags: [snowflake, testdb, testschema, view, target]
created_at: "2026-01-02T00:00:00Z"
---

# TARGET_VIEW

**Database:** TESTDB | **Schema:** TESTSCHEMA | **Columns:** 1

## Table Lineage

| Upstream Tables / Views | Downstream Tables / Views |
|---|---|
| [SOURCE_TABLE](./source-table.md) | *(none)* |

## Column Details

| Column | Type | Transform | Expression | Source (upstream) | Used in (downstream) |
|---|---|---|---|---|---|
| CUSTOMERID | VARCHAR | DIRECT_COPY |  | [SOURCE_TABLE.CUSTOMERID](./source-table.md#col-customerid) *(confidence: HIGH)* | *(none)* |

## Written by

**CREATE_VIEW** — process_id: proc-view-1 — last seen 2026-01-15

```sql
create or replace VIEW TESTDB.TESTSCHEMA.TARGET_VIEW (CUSTOMERID) AS
SELECT CUSTOMERID FROM TESTDB.TESTSCHEMA.SOURCE_TABLE
```

## Business Context

<!-- Reserved -->
"""


@pytest.fixture()
def okf_bundle(tmp_path: Path) -> dict:
    """Builds a lineage folder + a sibling OKF bundle for the same connection."""
    lineage_dir = tmp_path / "lineage"
    lineage_dir.mkdir()
    (lineage_dir / "manifest.json").write_text(json.dumps({"connectionId": "conn-test123"}))

    bundle_root = tmp_path / "okf-bundle-test" / "conn-test123"
    schema_dir = bundle_root / "testsys" / "testdb" / "testschema"
    schema_dir.mkdir(parents=True)

    (bundle_root / "bundle-info.md").write_text(BUNDLE_INFO_MD, encoding="utf-8")
    (bundle_root / "_needs-review.md").write_text(NEEDS_REVIEW_MD, encoding="utf-8")
    log_dir = bundle_root / "logs" / "2026" / "01"
    log_dir.mkdir(parents=True)
    (log_dir / "log.md").write_text(LOG_MD, encoding="utf-8")

    (bundle_root / "testsys" / "_connection.md").write_text(CONNECTION_MD, encoding="utf-8")
    (bundle_root / "testsys" / "testdb" / "_database.md").write_text(DATABASE_MD, encoding="utf-8")
    (schema_dir / "_schema.md").write_text(SCHEMA_MD, encoding="utf-8")
    (schema_dir / "source-table.md").write_text(SOURCE_TABLE_MD, encoding="utf-8")
    (schema_dir / "target-view.md").write_text(TARGET_VIEW_MD, encoding="utf-8")

    return {"tmp_path": tmp_path, "lineage_dir": lineage_dir, "bundle_root": bundle_root}


# ---------------------------------------------------------------------------
# Bundle discovery
# ---------------------------------------------------------------------------

def test_find_okf_bundle_via_lineage_dir(okf_bundle):
    bundle = find_okf_bundle(okf_bundle["lineage_dir"])
    assert bundle is not None
    assert bundle["connection_id"] == "conn-test123"
    assert Path(bundle["bundle_path"]) == okf_bundle["bundle_root"]


def test_find_okf_bundle_via_parent_dir(okf_bundle):
    # find_lineage_bundle can hand back the *parent* of the lineage/ folder
    # too — discovery must work from that folder as well.
    bundle = find_okf_bundle(okf_bundle["tmp_path"])
    assert bundle is not None
    assert bundle["connection_id"] == "conn-test123"


def test_find_okf_bundle_missing(tmp_path):
    (tmp_path / "lineage").mkdir()
    (tmp_path / "lineage" / "manifest.json").write_text(json.dumps({"connectionId": "conn-none"}))
    assert find_okf_bundle(tmp_path) is None


# ---------------------------------------------------------------------------
# get_okf_catalog
# ---------------------------------------------------------------------------

def test_catalog_summary(okf_bundle):
    catalog = get_okf_catalog(okf_bundle["bundle_root"])
    assert catalog["found"] is True
    assert catalog["connection_id"] == "conn-test123"
    assert catalog["summary"] == {"databases": 1, "schemas": 1, "tables": 1, "views": 1, "columns": 2}


def test_catalog_tree_structure(okf_bundle):
    catalog = get_okf_catalog(okf_bundle["bundle_root"])
    assert len(catalog["databases"]) == 1
    db = catalog["databases"][0]
    assert db["database"] == "TESTDB"
    assert len(db["schemas"]) == 1
    schema = db["schemas"][0]
    assert schema["schema"] == "TESTSCHEMA"
    assert schema["owner"] == "TEST_ROLE"
    names = {a["name"]: a for a in schema["assets"]}
    assert names["SOURCE_TABLE"]["type"] == "table"
    assert names["SOURCE_TABLE"]["column_count"] == 2
    assert names["TARGET_VIEW"]["type"] == "view"
    assert names["TARGET_VIEW"]["path"] == "testsys/testdb/testschema/target-view.md"


def test_catalog_review_queue_empty(okf_bundle):
    catalog = get_okf_catalog(okf_bundle["bundle_root"])
    assert catalog["review_queue"] == {"blocked": [], "events": []}


def test_catalog_history(okf_bundle):
    catalog = get_okf_catalog(okf_bundle["bundle_root"])
    assert len(catalog["history"]) == 1
    entry = catalog["history"][0]
    assert entry["date"] == "2026-01-15"
    assert entry["kind"] == "Creation"
    assert "lineage_run_id: test-run-1" in entry["details"]
    assert "processes: 1 (1 with raw SQL)" in entry["details"]


# ---------------------------------------------------------------------------
# get_okf_asset
# ---------------------------------------------------------------------------

def test_asset_frontmatter_and_lineage(okf_bundle):
    asset = get_okf_asset(okf_bundle["bundle_root"], "testsys/testdb/testschema/source-table.md")
    assert asset["name"] == "SOURCE_TABLE"
    assert asset["type"] == "table"
    assert asset["status"] == "stable"
    assert asset["description"] == "A source staging table."
    assert asset["database"] == "TESTDB"
    assert asset["schema"] == "TESTSCHEMA"
    assert asset["fqn"] == "/testsys/snowflake/TESTDB/TESTSCHEMA/SOURCE_TABLE"
    assert asset["upstream"] == []
    assert asset["downstream"] == [{"name": "TARGET_VIEW", "path": "testsys/testdb/testschema/target-view.md"}]
    assert asset["primary_key"] == "ID"
    assert asset["business_context"] is None  # placeholder-only section is dropped


def test_asset_column_details_with_confidence(okf_bundle):
    asset = get_okf_asset(okf_bundle["bundle_root"], "testsys/testdb/testschema/source-table.md")
    cols = {c["name"]: c for c in asset["columns"]}
    assert cols["ID"]["sources"] == []
    used_in = cols["CUSTOMERID"]["used_in"]
    assert len(used_in) == 1
    assert used_in[0]["asset"] == "TARGET_VIEW"
    assert used_in[0]["column"] == "CUSTOMERID"
    assert used_in[0]["confidence"] == "HIGH"
    assert used_in[0]["path"] == "testsys/testdb/testschema/target-view.md"


def test_asset_read_by_process_block(okf_bundle):
    asset = get_okf_asset(okf_bundle["bundle_root"], "testsys/testdb/testschema/source-table.md")
    assert asset["written_by"] == []
    assert len(asset["read_by"]) == 1
    block = asset["read_by"][0]
    assert block["query_type"] == "CREATE_VIEW"
    assert block["process_id"] == "proc-view-1"
    assert block["last_seen"] == "2026-01-15"
    assert "SELECT CUSTOMERID FROM TESTDB.TESTSCHEMA.SOURCE_TABLE" in block["sql"]


def test_asset_view_written_by_and_source(okf_bundle):
    asset = get_okf_asset(okf_bundle["bundle_root"], "testsys/testdb/testschema/target-view.md")
    assert asset["type"] == "view"
    assert asset["upstream"] == [{"name": "SOURCE_TABLE", "path": "testsys/testdb/testschema/source-table.md"}]
    assert len(asset["written_by"]) == 1
    assert asset["written_by"][0]["query_type"] == "CREATE_VIEW"
    col = asset["columns"][0]
    assert col["sources"][0]["asset"] == "SOURCE_TABLE"
    assert col["sources"][0]["confidence"] == "HIGH"


def test_asset_not_found(okf_bundle):
    assert get_okf_asset(okf_bundle["bundle_root"], "testsys/testdb/testschema/nope.md") is None


def test_asset_path_escape_rejected(okf_bundle):
    with pytest.raises(ValueError):
        get_okf_asset(okf_bundle["bundle_root"], "../../../etc/passwd")


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

def test_okf_catalog_api(client, okf_bundle):
    resp = client.get(f"/api/okf/catalog?folder={okf_bundle['lineage_dir']}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["found"] is True
    assert data["summary"]["tables"] == 1


def test_okf_catalog_api_not_found(client, tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps({"connectionId": "conn-nope"}))
    resp = client.get(f"/api/okf/catalog?folder={tmp_path}")
    assert resp.status_code == 200
    assert resp.json() == {"found": False}


def test_okf_asset_api(client, okf_bundle):
    resp = client.get(
        f"/api/okf/asset?folder={okf_bundle['lineage_dir']}"
        "&path=testsys/testdb/testschema/source-table.md"
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "SOURCE_TABLE"


def test_okf_asset_api_404(client, okf_bundle):
    resp = client.get(
        f"/api/okf/asset?folder={okf_bundle['lineage_dir']}"
        "&path=testsys/testdb/testschema/nope.md"
    )
    assert resp.status_code == 404
