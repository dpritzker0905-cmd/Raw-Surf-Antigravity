# HANDOFF — 2026-06-29 — Cron 403 grant fix + coarse-grid heatmap fade

Context picks up from the surf-rating-engine quality/calibration work ([[rating-quality-data-infra-2026-06-29]]).
The driving goal this session: make the precomputed spot-rating glyphs go **instant worldwide**, and make the
close-zoom heatmap "clamp" read honestly. We found the precompute had been silently failing, fixed the root
cause, and shipped a heatmap-fade. This file is the state to resume from.

---

## TL;DR for the next context
1. **The cron precompute was 403'ing** because `public.surf_spots` + `public.surf_log_entries` granted `SELECT`
   to `postgres` only — never `service_role`. **User has now run the GRANT** (✅ confirmed "success").
2. **User dispatched the `forecast-ingest` workflow on `dev`** (~17:50 UTC 2026-06-29). It runs ~100 min;
   precompute + calibration execute at the **end**. ⏳ **First thing to verify next context: did it succeed?**
3. **Coarse-grid heatmap fade shipped in code** (`WebGLMarineEngine.js`) but is **NOT committed/pushed** —
   it won't be live on Netlify until pushed to `dev`. User was asked; awaiting go-ahead.

---

## ✅ COMPLETED this context

### 1. Root-caused the cron precompute/calibration 403 (the big one)
- The 2026-06-29 cron ingested everything fine (global + regional marine/wind/pressure), but the THREE features
  enabled for it — `SPOT_RATINGS_PRECOMPUTE`, `BUOY_CALIBRATION`, `REPORT_CALIBRATION` (all `=1` in
  `.github/workflows/forecast-ingest.yml`) — each hit **`403 Forbidden`** on `GET /rest/v1/surf_spots` and were
  skipped (non-fatal). So glyphs stayed on the slow 7–22 s live path; calibration wrote nothing.
- **Forensic confirmation** via Supabase MCP (project `jnfbxcvcbtndtsvscppt`, "Raw Surf App Antigravity"):
  - `surf_spots` + `surf_log_entries`: `SELECT` granted **only to `postgres`** (not `service_role`/`anon`/`authenticated`).
  - RLS enabled, **zero policies**. Columns all exist (so it was a grant 403, not a bad-column 400).
  - **Why it was masked:** the Render web box reads spots as `postgres` via `DATABASE_URL` (direct asyncpg) → works.
    CI has no `DATABASE_URL`; it reads via PostgREST as `service_role` → `permission denied for table` (42501) → 403.
  - **Why Storage uploads with the SAME key worked:** Storage auth is bucket-policy based (`storage.objects`),
    independent of table grants. That Storage-OK / PostgREST-403 split is what pinned it.
  - `service_role` "bypasses RLS" but RLS-bypass ≠ table privilege — without the `GRANT` it's denied regardless.
- Code paths that 403'd (all read spots over PostgREST):
  - `backend/services/weather_pipeline/spot_ratings.py:247` (`fetch_active_spots_via_rest`)
  - `backend/services/weather_pipeline/buoy_calibration.py:189`
  - `backend/services/weather_pipeline/report_calibration.py` (reads `surf_spots` then `surf_log_entries:238`)

### 2. Wrote the fix as a tracked artifact + USER APPLIED IT
- `backend/migrations/2026-06-29_grant_service_role_read_surf_tables.sql` (untracked/new):
  ```sql
  grant select on table public.surf_spots      to service_role;
  grant select on table public.surf_log_entries to service_role;
  ```
- **User ran it in the Supabase SQL Editor → "Success. No rows returned"** (✅ expected output for GRANT).
- Deliberately did NOT grant `anon`/`authenticated` (frontend reads spots through the FastAPI backend, never
  PostgREST). I did not run it myself — DB access-control changes are user-applied by policy.

### 3. Shipped: coarse-grid heatmap fade (engine-side)  — UNCOMMITTED
- File: `frontend/src/components/map/WebGLMarineEngine.js`, in `renderHeatmapAndParticles`, right before the
  `u_opacity` uniform set (~line 447–471).
- **What:** when the only marine data covering the viewport is the ~10°/cell global-coarse fallback (37×17) and
  the camera is zoomed in past it, fade the heatmap out (so it reads "no fine data here" not a flat "wrong-data"
  wash). Per-spot rating glyphs are unaffected (drawn in MapMarkerLayers, different path).
- **Mechanism:** pure engine-side opacity multiplier folded into `heatmapOpacity` (covers both the marine wash
  AND the rating band — both read `u_opacity`). NO shader edit / no new uniform / no recompile.
- **Regression guards:**
  - Gated on `cellDeg > 1.0°` → regional tiles (<0.3°/cell) can **never** fade.
  - Fade only engages once `<2` grid cells span the viewport (`smoothstepVal(0.5, 2.0, cellsAcross)`), so
    zoomed-out global stays full opacity.
  - Kill switch: `window.__RAW_DISABLE_COARSE_FADE__ = true`. Telemetry: `window.__RAW_GPU__.coarseFade`.
  - Skipped under `__WEATHER_DEBUG_ISOLATE_OVERLAY__`.
- Verified statically only (scope of `smoothstepVal`/`vb`/`waveGrid`/`waveBounds`, syntax, thresholds).
  **Not visually verified** — `/map` is auth-gated and I won't sign in.

### 4. Memory + housekeeping
- `MEMORY.md` ACTIVE STATE updated: the GRANT is now the #1 blocker note; coarse-fade noted with kill switch.
- Flagged a **background task** (spawn_task `task_399b89dd`): fix the storage3 `UnboundLocalError: 'response'`
  in `_delete_from_supabase` (`backend/services/weather_pipeline/store.py:143`) — same bug class already fixed
  for the L2 *upload* path; rewrite the delete as a raw Storage REST `DELETE`. Non-fatal (stale products
  occasionally not pruned). Seen repeatedly in the 2026-06-29 cron log.

---

## ⏳ IN PROGRESS / AWAITING VERIFICATION (do these FIRST next context)

1. **Verify the dispatched cron run** (dispatched ~17:50 UTC 2026-06-29 on `dev`). In the run log, near the end,
   expect:
   - `Spot-ratings precompute complete: N spots × M frames → L2.`  ✅
   - NO `403 Forbidden` / "skipped (non-fatal …)" lines for spot-ratings / buoy / report calibration.
   If it still 403s: re-check the GRANT actually applied to THIS project (`jnfbxcvcbtndtsvscppt`) and that CI's
   `SUPABASE_SERVICE_ROLE_KEY` secret is the real service_role key.
2. **Confirm glyphs flip to precomputed** on the live map: the per-spot fetch should report `src=precomputed`
   (instant worldwide) instead of the live path. (Backend `/api/weather/spot-ratings` serves precomputed via
   `select_precomputed`; live remains fallback.)
3. **Confirm calibration populated:** `/api/weather/buoy-calibration` and `/api/weather/report-calibration`
   should return data after this run.

---

## 📋 REMAINING / NEXT (prioritized)

1. **Commit + push the coarse-fade to `dev`** so Netlify deploys it (it's frontend; the cron dispatch does NOT
   deploy it). User had not yet said yes. Suggested message:
   `fix(surf): fade coarse-global heatmap at close zoom (reads "no fine data", not wrong data)`.
   Branch `dev` is the working branch (not default) so committing on `dev` is fine.
2. **Live-verify the coarse-fade** once pushed: zoom into a region WITHOUT a regional tile (e.g. mid-Pacific)
   with marine on → wash should fade as you zoom in, snap back when zooming out past ~2 cells; FL/SoCal
   (regional tiles) must look unchanged.
3. **Worldwide regional coverage is ROLLING, not instant:** each cron does the 2 flagships (FL, SoCal) + 2
   worldwide regions (`WORLDWIDE_REGIONS_PER_CYCLE=2`). Last cycle did UK + East Australia. Hawaii, Iberia,
   Indonesia, Brazil, S-Africa, Mexico get tiles over subsequent cycles (~all 8 every ~12 h). Until a region's
   tile lands it falls back to global-coarse (which now fades at close zoom — consistent story).
4. **Slope asset → breaker-type** (carried over): dispatch the "Build Bathymetry Slope Asset" GH Action
   (`.github/workflows/build-bathymetry.yml`) → commits the 0.1° slope asset → then post-validation enable
   `RATING_TIDE` and `RATING_BREAKER_TYPE` (both gated/neutral-default today; breaker-type is a no-op until the
   slope asset exists — `bed_slope_at` returns None without it).
5. **L2 delete UnboundLocalError** — background task `task_399b89dd` (see above). Start or dismiss.
6. **Optional ops:** external uptime monitor (UptimeRobot) for the keep-warm; expand precompute hours/models.

---

## 🔑 KEY FACTS / GOTCHAS for the next context
- **Repo:** `github.com/dpritzker0905-cmd/Raw-Surf-Antigravity`. Local folder `C:\Users\dprit\Raw-Surf`, branch
  **`dev`** (working branch; `main` = release only, needs the §22 handshake). Cron + Render serve-only build from `dev`.
- **Supabase project:** `jnfbxcvcbtndtsvscppt` (us-east-2). There's a SECOND older project `weewaulkwfwlbhqemxma`
  ("Emergent") — do NOT touch it; the live app is Antigravity.
- **`gh` CLI:** was NOT installed this context (couldn't dispatch from here). Being installed now; after install
  the user must run `gh auth login` (interactive). Once authed, future runs can be dispatched/tailed from here.
- **Architecture:** decoupled — GitHub Action cron = sole ingester → Supabase L2; Render = serve-only
  (`DISABLE_FORECAST_SCHEDULER=1`), restores from L2. Heavy work stays OFF the 1-CPU Render box (that's why the
  precompute lives in CI, not on Render).
- **`provider` stays `open-meteo`** (capabilities/whitelist contract key — don't rename); true origin in `source_dataset`.
- **Cron timing:** `forecast-ingest.yml` schedule `15 */3 * * *` (every 3 h at :15 UTC). Full run ~100 min;
  precompute/calibration are the LAST steps.
- **User's local disk ~100% full** — local builds/tests/git can be impeded; production unaffected.
- **Don't re-investigate "bilinear shader smoothing"** — already implemented (LINEAR wave texture +
  `getRatingColorSmooth`). Concluded last context; no action needed.

## Git state at handoff (uncommitted)
```
 M .claude/launch.json                 (env noise — not ours)
 M backend/diagnostics.log             (runtime log — not ours)
 M frontend/src/components/map/WebGLMarineEngine.js   ← coarse-fade (ship this)
?? backend/migrations/2026-06-29_grant_service_role_read_surf_tables.sql  ← grant record (commit for the record)
?? .codebase-memory/                   (local index cache — gitignore candidate, don't commit)
```
HEAD: `91aa170a fix(surf): precompute spot ratings + live-path cache — kill the 7-22s latency`

## References
- Memory index: `MEMORY.md` → [[rating-quality-data-infra-2026-06-29]], [[p1-spot-ratings-endpoint-2026-06-28]],
  [[decoupled-ingestion-github-action-2026-06-27]], [[l2-supabase-upload-unbound-response-2026-06-26]].
- Prior plan/handoffs: `docs/runbooks/HANDOFF-2026-06-28-surf-rating-engine-PLAN.md`,
  `docs/runbooks/HANDOFF-2026-06-28-surf-rating-toggle-audit.md`.
