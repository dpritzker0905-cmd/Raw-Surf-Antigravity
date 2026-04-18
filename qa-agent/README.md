# 🏄 Raw Surf — QA Companion Agent

A shadow agent that watches every file the main coding agent touches and automatically runs lint + tests.

## How to Start

Open a **new PowerShell terminal** and run:

```powershell
cd "C:\Users\dprit\.gemini\antigravity\scratch\raw-surf\Raw-Surf-main\qa-agent"
powershell -ExecutionPolicy Bypass -File watcher.ps1
```

The watcher will:
1. Run an **initial full check** on startup
2. Open the **live dashboard** at `http://localhost:7734` in your browser
3. Watch all `.js`, `.jsx`, `.ts`, `.tsx`, `.py` files for changes
4. Re-run checks **automatically** within ~800ms of any save

## Dashboard

- 🟢 **Green cards** = passing  
- 🔴 **Red cards** = errors found (with file + line numbers)  
- ⚠️ **Yellow** = running  
- History panel shows the last 20 runs

## What Gets Checked

| Tool | Target | What it catches |
|------|--------|-----------------|
| **ESLint** | `frontend/src/**` | JS/JSX errors, undefined variables, React hooks violations |
| **Ruff** | `backend/**` | Python style + logic errors (fast, replaces flake8/pylint) |
| **pytest** | `backend/test_*.py` | Unit test regressions |

## One-Time Setup (if tools missing)

```powershell
# Ruff (Python linter)
cd backend
.\venv\Scripts\python -m pip install ruff pytest

# ESLint is already installed via frontend/node_modules
```

## Files

```
qa-agent/
├── watcher.ps1       ← Run this to start
├── run-checks.ps1    ← The check engine (called automatically)
├── config.json       ← Watch paths, ports, debounce settings
├── qa-status.json    ← Live status (read by dashboard + main agent)
└── dashboard/
    ├── index.html
    ├── style.css
    └── app.js
```
