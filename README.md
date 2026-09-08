# EZView

A local web tool for browsing, analysing, and editing data-lineage pipeline output files.

## What it does

| File type | Actions |
|-----------|---------|
| `.parquet` | View as sortable/paginated table · Export to JSON · Analyze lineage (for `processes.parquet` / `edges.parquet`) |
| `.json` | Collapsible, colour-coded tree viewer · Download formatted |
| `.md` | Full markdown editor — toolbar shortcuts (Ctrl+B bold, etc.) · Edit mode / Split (live preview) / Preview mode |
| `.txt` / `.log` | Plain text viewer |
| Folder | Auto-detect lineage bundle and jump to analysis |

## Lineage Analysis

When you open a folder (or `processes.parquet` / `edges.parquet`), EZView automatically finds the matching pair and provides five views:

- **Summary** — stat cards + confidence/transform/query-type breakdowns
- **Assets** — database → schema → table → column accordion
- **Edges** — filterable table (by confidence, transform type, direction)
- **Processes** — grouped by SQL query type, expandable SQL code
- **Data Flow** — table-to-table write relationships

## Quick start

**Desktop shortcut (recommended for regular use).** One-time setup, then just double-click an icon — no terminal, no editor:

```powershell
# Windows, from the ezview/ directory (requires Python 3.11 and Node.js already installed)
.\create-shortcut.ps1
```

This adds an **EZView** shortcut to your Desktop. Double-clicking it builds the frontend once (first run only, a minute or two), starts a single backend process serving the built UI + API from `:8000`, and opens your browser. Closing the console window it opens stops EZView. If you change EZView's own frontend code, re-run `.\rebuild-frontend.ps1` and restart it to pick up the change.

**Developing EZView itself:**

```powershell
# Windows (from the ezview/ directory)
.\start.ps1
```

This installs dependencies, starts the backend on `:8000` and the frontend on `:5173` with live-reload, and opens your browser automatically.

For manual startup, see [setup.md](setup.md).
