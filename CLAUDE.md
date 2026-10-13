# Raw Surf

Surf forecasting + surf-trip marketplace. **This repository is PUBLIC.** PRs target `dev`; `main` only via the
explicit-instruction + confirmation handshake (BRAIN_RULES §22).

- `backend/`: FastAPI (`server.py`; Render runs `uvicorn server:app`), Python 3.12. ONE 1-CPU Render box serves
  production AND dev, so anything heavy pointed at it degrades the live site.
- `frontend/`: React (CRA via craco) + MapLibre GL, Node 24.21.0 (`frontend/.node-version`; Netlify and CI match),
  deployed on Netlify.
- Supabase: Postgres + Storage (weather products live in the `weather-products` bucket).
- **History, not current architecture:** the root-level `*HANDOFF*`, `*AUDIT*` and `*FINDINGS*` files and
  `MASTER_WEATHER_SIMULATION_REPORT_11.0.md` (Jun–Aug 2026), and `docs/README.md` (May 2026, "Open-Meteo raster
  tiles"). Current weather state is `docs/weather-program/`.

## Commands

Backend: run from `backend/`. pytest from the repo root fails collection, and every mutation check then fakes RED.

```bash
python -m pytest tests/test_surf_point_parity.py -q --basetemp=<writable tmp dir>
python scripts/ci_test_lanes.py --lane guards            # or chain | estate: the test files each CI lane runs
flake8 --max-line-length=150 --select=E9,F63,F7,F82 .    # the CI lint gate
python scripts/check_file_size.py --path . --max-lines 800
```

Frontend: run from `frontend/`. Tests sit beside the code (`src/components/map/*.test.js`) AND in `src/tests/`
(legend/ramp pins live there); run both trees before pushing a palette or shader change.

```bash
CI=true npx react-scripts test --watchAll=false src/components/map src/tests
npm run build
node scripts/check_eslint.js   # CI's shrink-only lint-debt ratchet; a green Jest run says nothing about it
node scripts/wind-color/check.mjs   # wind palettes as COMPOSITED over each basemap, incl. colour-blind (its README)
```

- **Test floors are shrink-only.** For a new backend test, `git add` it first (no lane claims an untracked file), then
  move that lane's floor in `.github/workflows/ci.yml` AND `_FLOOR_SET_FROM` in
  `backend/tests/test_ci_floor_staleness.py` in the same commit, and check that hosted CI's "collected N tests" equals
  your projection. Hosted CI is the authority (the local guards lane takes 15-25 min).
- **Fetchers run as subprocesses by path** (`services/_fetch_common.run_fetcher_subprocess`), where `services` is not
  importable: sibling imports are `try: from _x import … except ImportError: from services._x import …`
  (guard: `tests/test_fetcher_script_imports.py`).
- More CI and PR pitfalls (ledger forks, Windows encoding, stacked merges): `docs/weather-program/LESSONS.md`.

## Project Rules (binding)

- **NO SECRET VALUES IN ANY TRACKED FILE (user mandate 2026-09-24):** this repository is PUBLIC.
  Reference credentials by environment-variable NAME only (`QDRANT_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`) — never paste a key, token, password or connection string into
  code, docs, handoffs, instruction files (`BRAIN_RULES.md`, `.antigravityrules`), test fixtures or
  tool output you commit (lint/test dumps included). Values live only in Render env, GitHub Actions
  secrets, Netlify env and gitignored local `.env` files.
  ⛔ Seven credentials leaked this way (2026-03 → 2026-09), and removing them from history did NOT
  unpublish them — see `docs/runbooks/SECURITY-2026-09-19-committed-credentials.md`. If a value is
  ever committed, treat it as compromised and rotate it at the provider; do not rewrite history
  instead. GitHub push protection is on; do not bypass a block.

- **ONE FORECAST COMPOSITION (user mandate 2026-07-28):** every surface that shows surf height or
  quality — spot hubs, infoboxes, map glyphs, the weather sim, alerts, notifications, any new
  endpoint — must go through the SAME chain: `surf_point.resolve_surf_geometry` +
  `estimate_surf_at` for the **nearshore BREAKING height**, then `surf_rating.compute_surf_rating`
  for the 0-100 quality. `spot_ratings.rate_one_spot` is the reference implementation; mirror it,
  never re-derive it.
  ⚠️ **NEVER report marine `point.speed` as the surf height — that is the OFFSHORE significant wave
  height.** Measured 2026-07-28, offshore vs breaking at the same coordinate and hour ranged from
  **−18.7% (Jeffreys Bay) to +92.7% (Trestles)**, signed both ways, so no constant can correct it —
  only the geometry can. The spot hub shipped the offshore number for months
  (`spot_conditions.py`), showing "2.4 ft" for chest-high surf.
  ★ A size without a quality is also incomplete: a blown-out 6 ft and a groomed 6 ft must not
  render identically. Resolve geometry ONCE per coordinate and reuse it across forecast hours —
  the correction is arithmetic, not I/O.
  ⛔ Do not add a second forecast path "just for this screen". That is how the sim came to over-read
  by 19% (`cf2efb48`) and how the hub came to be wrong by 93%.

- **THREE THEMES, ALL DEVICES (user mandate 2026-07-12):** every UI surface — map controls,
  legends, scrubber, admin panels, overlays, anything rendered — must work in **light mode, dark
  mode, AND beach mode**, on **desktop AND mobile** (and other devices). Use `useTheme()` from
  `contexts/ThemeContext` and theme-aware class patterns (see MapWeatherControls'
  `isLight`/`isBeach` + `textMuted`/`chipBg`/`bgClass` variables, or the shared `ui/*` primitives
  in admin). Never hardcode single-theme colors. Components with separate desktop/mobile layouts
  (MapWeatherControls has three: desktop panel, mobile collapsed float, mobile expanded sheet)
  need changes mirrored across ALL layouts.

- **ACCESSIBILITY (user mandate 2026-07-14):** every interactive UI element shipped or touched
  must be ARIA-accessible: real `<button>`/`<input>` elements (never bare div-with-onClick),
  `aria-label` on icon-only controls, `role` + full keyboard support on custom widgets
  (`ForecastWheel.js` is the house pattern: `role="slider"`, arrows/PgUp/PgDn/Home, visible
  focus), `aria-pressed`/`aria-expanded` on toggles, and information never conveyed by color
  alone (rating glyphs need a text/label equivalent). Existing surfaces are NOT yet compliant
  (2026-07-14 audit: ~41 aria attributes across 132+ interactive elements in the map components;
  keyboard handling in only 2 of 20 interactive files) — see
  `docs/runbooks/HANDOFF-2026-07-14-marathon-close-stability-arc.md` §0a for the debt inventory.
  New/touched code must not add to that debt.

- **WEATHER PROGRAM MEMORY (user mandate 2026-09-29):** the weather program's state, decisions, scoreboard and
  lessons live in `docs/weather-program/` (start at its `README.md`), tracked in git so every session on every
  machine reads the same state and no session silently overwrites another's. Follow its write protocol: logs
  and ledgers are append-only, one log file per session, shared files are edited by exact-string replacement
  (never rewritten whole), and every fix that changes a served number adds a `SCOREBOARD.md` row. Every
  state-changing action is recorded in the hash-chained action ledger (`ACTIONS.jsonl`, BRAIN_RULES §23).

- **SECURITY/STABILITY CONTRACTS (release 2026-07-25):**
  - Credit, payment, booking and conversation routes use strict JWT identity (`get_current_user_id`) plus ownership
    checks; the rest of the BOLA backlog is NOT certified. Stripe webhooks fail closed unless `STRIPE_WEBHOOK_SECRET`
    and a valid Stripe signature are present.
  - Private chat media (`chat_media`, `crew_chat`, private since 2026-07-25): opaque refs plus member-authorized signed
    URLs, failing closed when private storage is unavailable. Do not change the remaining legacy local-media routes
    without an authenticated browser-delivery compatibility design.
  - Generic uploads: public delivery only for the `avatars`, `conditions`, `gallery`, `general`, `stories` and
    `user-gallery` buckets; private chat buckets are excluded.
  - The WebGL global-grid cache guard is caller-aware: normal close-zoom reuse rejects world grids; only the 429
    cooldown fallback may reuse a covering one. As of 2026-07-25, deactivation-retain had no reactivation regression test.

## Weather simulation (read before touching forecast, map or sim code)

**Memory of record: `docs/weather-program/`** (its README holds the write protocol). Start every session with
`python backend/scripts/memory_audit.py --docs-only` and do what its OVERDUE / open commitments owe, then read STATE
("Now", "Next fixes"), the newest `log/` file and any `DECISIONS.md` entry touching your task. STATE is a claim, not a
measurement: check `git fetch`, `gh pr list --state open` and `/api/health` before acting on it.

- **Ingest:** `forecast-ingest.yml` (every 4 h) → `backend/scripts/ingest_forecast_ci.py` →
  `weather_pipeline/scheduler.py` → fetchers in `backend/services/` (GFS `noaa_gfs_*`, EURO
  `ecmwf_opendata_fetcher.py`, ICON `dwd_gwam_fetcher.py` / `dwd_icon_*`, Copernicus `copernicus_*`) →
  `normalizer.py` → `store.py` (bucket + `manifest.json`). Precompute: `precompute.yml` → `scripts/precompute_ci.py`
  → `spot_ratings_precompute.py`.
- **Serve** (`backend/routes/weather.py`, under `/api/weather`): `/grid` (`grid_resolver.py`, `viewport_service.py`),
  `/grid_series` (`grid_series_helper.py`), `/point` (`point_resolution.py` → `point_surf_augment.py`),
  `/spot-ratings`, `/capabilities` (`capabilities.py`, the ONLY source of forecast horizons).
- **Surf chain** (`backend/services/weather_pipeline/`): `surf_point.resolve_surf_geometry` / `estimate_surf_at`
  (nearshore physics in `surf_transform.py`) → `surf_rating.compute_surf_rating`; reference
  `spot_ratings.rate_one_spot`. The sim is NOT a second path: `sim_rating.py` delegates both halves to this chain (the
  private physics copy was deleted in `0cae5d74`). Pipeline sweep at `dev` `52e0ec53` (2026-09-28; 14 s, 315°, 5 kt
  wind from 45°, only swell height varied): `0.5 m → 3.6 ft / 78.0` · `1 m → 6.4 ft / 86.5` · `4 m → 19.3 ft / 86.5`
  · `8, 10, 12 m → 29.5 ft / 61.2` (the depth-limited ceiling). The earlier `8 m → 30.6 ft` and
  `10 m → 36.6 ft / 34.6` readings were the MC-01 cap seam (bigger swell, smaller surf), repaired by #146
  (`SURF_CAP_SEAM_MONOTONE`, default on since 2026-09-28). Sweep the interior of a range, not its ends (LESSONS L-S10).
- **Client** (`frontend/src/components/map/`, ~400 files): `marineGridSeries.js` (48-frame `/grid_series` pages) and
  `backendWeatherServiceClient.js` → `useMarineDataFetcherCore.js` (ONE dispatch slot, `enqueueMarineUpdate`) →
  `useMarineOrchestrator.js` (hour/model/layer) → `marineCommitArbiter.js` / `marineTransitionCoordinator.js` →
  `WebGLMarineLayer.js` → `WebGLMarineEngine.js` + `WebGLMarineShaders.js`. Scrubber: `ForecastWheel.js`. Tier
  gating lives ONLY in `LayerAccessResolver.js`; diagnostics ONLY in the `TruthOverlay.js` HUD (`?diag=1`).
- **Served numbers change dark.** Anything that moves a surf height, rating, glyph, hub or sim value ships behind a
  default-off flag and is flipped only on the owner's explicit word with evidence (D-001), plus a `SCOREBOARD.md`
  row. Backend flags are `os.environ` reads at call time, registered in `_RATING_FLAGS`
  (`backend/routes/admin/surf_forecast.py`) and kept in parity by `tests/test_flag_lane_parity.py`. Client-only fixes
  that change no served number ship on, with a `window.__RAW_DISABLE_<NAME>__ = true` kill switch.
- **The 14-day horizon / subscription-tier contract is LOCKED** (BRAIN_RULES, "14-Day Forecast Horizon"): never cap
  the scrubber to a model's native horizon, never rebuild the ICON/EURO extension blends, never gate tiers outside
  `LayerAccessResolver.js`.
- **Never load-test the live backend.** A fresh map load asks for three 48-frame world series pages (~10-13 s of CPU
  each); headless replays starved the box on 2026-10-01 ("Couldn't load surf spots"). Replay offline against a mock
  backend; at most ONE short live scenario, with `/api/health` probed before and after.
- **Do not rewrite the system.** Map the pipeline, diff against a known-good commit, instrument, find the exact
  mismatch, make the smallest fix, and cite the instrument for every number you claim.

<!-- trevec:rules:start -->

## Trevec MCP Tools

Use these MCP tools to retrieve precise, graph-aware code context instead of reading files manually.

### get_context
Retrieves relevant code context for a natural-language query. Returns relevant code nodes with file paths, spans, and related context. **Use this as your primary tool for understanding code.**

### search_code
Hybrid search over indexed code nodes. Returns ranked results with file paths and signatures. Use for targeted symbol or keyword lookup.

### read_file_topology
Returns the structural topology of a file: all code nodes (functions, classes, methods) with their relationships (calls, imports, contains). Use to understand file structure before making changes.

### repo_summary
Returns a high-level overview of the repository: languages, file/node/edge counts, top-level modules, entry points, hotspots, and detected conventions. Use for onboarding or getting a quick sense of a codebase.

### neighbor_signatures
Given a list of file paths, returns the external API surface those files depend on — imported symbols from other files with their signatures.

### batch_context
Runs multiple `get_context` queries in a single call. Each query can have its own budget and anchor count. Reduces round-trips for multi-query workflows.

### remember_turn
Records a conversation turn into episodic memory. Call this when the user shares important context, decisions, or preferences that should persist across sessions.

### recall_history
Searches episodic memory for past conversation context. Use when the user references previous discussions or when historical context would help answer a question.

### Guidelines
- Prefer `get_context` over reading raw files — it returns only the relevant code with graph context.
- Use `search_code` for quick symbol lookups (function names, class names, error messages).
- Use `read_file_topology` before modifying a file to understand its structure and dependencies.
- Use `repo_summary` for onboarding or to get a quick overview of the codebase structure.
- Use `neighbor_signatures` to discover imports/dependencies of specific files before editing.
- Use `batch_context` when you need context for multiple queries — saves round-trips.
- Call `remember_turn` for important decisions, preferences, or context the user shares.
- Call `recall_history` when the user says "we discussed", "last time", or references prior work.

<!-- trevec:rules:end -->
