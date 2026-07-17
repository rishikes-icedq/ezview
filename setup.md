# EZView — Setup Guide

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Python | 3.10+ | `python --version` |
| pip | latest | `pip --version` |
| Node.js | 18+ | `node --version` |
| npm | 9+ | `npm --version` |

## Installation

### 1. Backend (virtual environment)

`start.ps1` handles venv creation automatically. To set it up manually:

```powershell
cd ezview
python -m venv .venv                          # creates ezview/.venv
.venv\Scripts\pip install -r backend\requirements.txt
```

### 2. Frontend

```powershell
cd ezview/frontend
npm install
```

## Running (development)

Open **two terminals**:

```powershell
# Terminal 1 — Backend API on port 8000 (activate venv first)
cd ezview
.venv\Scripts\Activate.ps1
cd backend
python app.py
```

```powershell
# Terminal 2 — Frontend dev server on port 5173
cd ezview/frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

The Vite dev server proxies all `/api/*` requests to `:8000` automatically — no CORS configuration needed.

## One-command start (Windows)

```powershell
cd ezview
.\start.ps1
```

## Running tests

```powershell
cd ezview/backend
python -m pytest tests/ -v
```

## Production build (optional)

Build the frontend and serve everything from the backend on port 8000:

```powershell
cd ezview/frontend
npm run build           # outputs dist/

cd ../backend
python app.py           # serves API + static frontend
```

Open **http://localhost:8000**.

## Changing ports

| Setting | How to change |
|---------|--------------|
| Backend port | Edit `app.py` → `uvicorn.run(..., port=8000)` |
| Frontend port | Edit `vite.config.ts` → `server: { port: 5173 }` |
| Proxy target | Edit `vite.config.ts` → `proxy['/api'].target` |

## Troubleshooting

**`ModuleNotFoundError: No module named 'pyarrow'`**
→ Run `pip install -r backend/requirements.txt` from the `ezview/` directory.

**`EADDRINUSE: address already in use :5173`**
→ Another process is using port 5173. Change the port in `vite.config.ts` or kill the other process.

**Backend starts but browser shows blank page**
→ Ensure both processes are running. The frontend dev server must be running separately from the backend.

**Parquet file loads slowly**
→ Large `results.parquet` files (2–9 MB) are loaded into memory. The LRU cache means the second load is instant.
