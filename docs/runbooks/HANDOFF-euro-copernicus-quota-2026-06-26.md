# Handoff — EURO→Copernicus + open-meteo quota (2026-06-26)

> Fresh-context pickup. **Read the brain first:** `sync-stabilization-levers-2026-06-26.md` (the live state
> + 2-month meta-pattern), `icon-extended-blend-2026-06-26.md`, and `MEMORY.md`. Operating rules:
> `BRAIN_RULES.md §Weather` — forensics not guessing, smallest targeted fix, **don't DoS the 1-CPU/2GB
> Render box**, dev branch only, verify before/after. The user's console logs are ~90% browser-extension
> noise (`contentscript.js`/`rrweb`/`inpage.js`/`Unchecked runtime.lastError`/`Resetting the streams`).

Branch `dev` (push → Netlify [frontend] + Render [backend] auto-deploy). HEAD at handoff: **`350384c7`**.

---

## 1. ★ IMMEDIATE NEXT ACTION (what the user is doing right now)
The user is running the **full standalone Copernicus fetcher** on the Render shell and will paste the output:
```bash
for P in /opt/render/project/src/.venv/bin/python3 python3; do "$P" -c "import copernicusmarine" 2>/dev/null && { "$P" backend/services/copernicus_global_fetcher.py; break; }; done
```
**Expect:** `SUMMARY: points=612 bands_ok=17 bands_failed=0 timesteps=~80 forecast_end=~+10d wave_height_nonzero=<big> wave_height_max=~1-9 elapsed=~900-1200s`.
- If `points=612 bands_ok=17` + real wave heights → the production EURO→Copernicus ingest is proven end-to-end. ✅
- If some `bands_failed>0` or `band lat=… failed` lines → note which lats; the fetcher already skips failed bands (partial grid). Investigate the CMEMS error in stderr.
- THEN: after the next EURO marine ingestion cycle runs on Render, **re-curl the manifest** (see §4) → confirm EURO marine has a fresh `run_time`, `source_dataset=copernicus_native_global_coarse`, coverage ~14d.

## 2. What this session shipped (all on `dev`, newest first)
- `350384c7` **feat(weather): EURO marine global from Copernicus (native swells) + GFS 10→14d extension.** `ingest_euro_marine_global` is now Copernicus-FIRST (`fetch_euro_marine_global_coarse` → `copernicus_global_fetcher.py` thin-band subsets) for all 4 NATIVE layers 0-10d + cached-GFS 10-14d (sliced tail); open-meteo path is the FALLBACK (zero regression). EURO off open-meteo → frees ~1,200 calls/cycle for ICON. 19 tests pass.
- `8d7fe048`/`87c62d23` the fetcher + `COPERNICUS_FETCHER_QUICK=1` quick-verify mode.
- `b7b92bad`/`15c56e10` probes (`scratch_copernicus_probe.py`, `probe2.py`).
- `f1317560` **stop EURO re-fetching GFS** — cache-align EURO's GFS-fallback `forecast_days`→14 so it's a `_GRID_CACHE` HIT not a 2nd open-meteo fetch (frees ~600 calls/cycle).
- `150c86c2` **stagger marine-global ingestion** (`scheduler/forecast.py`): GFS every cycle, EURO/ICON alternate via `_marine_alt` (`(utc_hour//3)%2`) — caps each cycle at 2 heavy marine fetches.
- `8f13c840` **Phase A frontend**: `marine_sibling_prewarm` DEFAULT-ON (kill switch `localStorage marine_sibling_prewarm='false'`) + infobox switch debounce 400→250ms.

## 3. ★ ROOT CAUSE (confirmed, the thing that actually breaks ICON/marine)
**Open-meteo FREE-tier daily-quota exhaustion.** Limits: 600/min, **5,000/hour, 10,000/day**, 300k/mo. Each global product = **612 locations = 612 billed calls**; one ingestion cycle ≈ **~5,500 calls** (already > the 5k/hr cap → the cycle's LAST marine job, ICON, gets 429'd) and **8 cycles/day ≈ ~45k = 4.5× the 10k/day cap**. Forensic proof: manifest showed GFS/EURO/ICON marine all stale since the day's first cycle (~03:06), the 12:06 cycle refreshed NOTHING; wind fresh @03:41 but marine stale; Render logs confirmed the pattern. Paid **Standard (~€30/mo, 1M/mo, unlimited hr/day)** removes the wall; **Professional (5M/mo)** = no tuning. The EURO→Copernicus move + redundant-GFS dedup REDUCE open-meteo load (EURO→0) but the daily cap is still the root for full 3h freshness. **User decision pending: pay vs accept reduced cadence.**
SEPARATE BUG FOUND (unrelated, real): payment-expiry scheduler jobs crash every 5min — `ImportError: cannot import name 'notify_crew_session_confirmed'/'notify_crew_payment_expiring' from routes.notifications.push` (`scheduler/bookings.py:25,115`). Flag/fix separately.

## 4. Forensic commands (use these, they're how the truth was found)
- **Manifest freshness** (the key forensic tool — no ingestion-status endpoint exists):
  `curl -s '<render>/api/weather/products' -o p.json` then parse per (model,layer,region) `run_time`/`valid_time_end`. Marine global products: `*_marine_*_global_coarse_*.json`. Render = `https://raw-surf-antigravity.onrender.com`.
- **Render logs**: only a tiny window is retained (free tier); filter `Pipeline Scheduler` / `Hit rate limits` / `429` near a `:06` ingestion run. `[Pipeline Scheduler] Exception during fetch: …` names the per-job failure.
- **Copernicus probes** (`backend/scratch_copernicus_probe*.py`, run with the venv loop above) — chunking/feasibility. KEY result: CMEMS `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i` is MAP-chunked (1024×2048) → lazy `open_dataset`+isel OOMs; only `subset` is efficient; **thin full-lon latitude-band subset = 18MB/77s** → the production fetcher.

## 5. EURO→Copernicus design (shipped, for when you extend/debug it)
- `copernicus_global_fetcher.py`: dual-mode subprocess; loops the coarse latitudes, **one thin (~0.2° tall) full-lon `copernicusmarine.subset` per coarse lat** → extracts the coarse lon points → 612-pt Open-Meteo-shaped JSON, all 12 native vars. Low-strain (~0.3 GB / ~36 MB peak / I/O-bound), slow (~15-30 min, background only). `COPERNICUS_FETCHER_QUICK=1` = tiny region/3d for fast verify.
- `fetch_euro_marine_global_coarse(bbox,resolution,forecast_days)` (`copernicus_marine_service.py`): spawns it (2400s timeout), returns point list or None; test env → mock (flagged `is_test_fixture`).
- CMEMS global waves = **~10-day product** (verified: catalog + `min(forecast_days,10)`); 14-day = Copernicus 0-10d + cached-GFS 10-14d. Filenames `{model}_{domain}_{layer}_{region}_{time}{_estimated?}.json` overwrite by key. Knob `EURO_COPERNICUS_DAYS` (default 10).
- Ingest order matters: `ingest_gfs_marine_global` runs ~1 min before EURO (`scheduler/forecast.py` job list) so EURO's GFS extension is a `_GRID_CACHE` hit.

## 6. Open items / next levers (NOT done — deliberate)
1. **The quota decision** (§3) — user's call: €30 Standard (clean) vs free reduced-cadence vs Professional. Everything else is downstream of this.
2. **Verify EURO→Copernicus live** (§1) — full fetcher run + a post-cycle manifest check.
3. Frontend Phase-A live A/B (toggle prewarm default-on; runbook `verify-zoom-and-marine-toggle.md §1`) + infobox snappier — not yet user-confirmed live.
4. ICON extended blend renders-when-settled (user confirmed "fills in slowly" = works; the GFS-first progressive render for >240h is the optional snappiness win — see `icon-extended-blend-2026-06-26.md`).
5. The `notify_crew_*` ImportError (§3).
6. ICON marine far-hour CORS-less 500 → safe-zero blank: mitigated by the stagger restoring ICON freshness; the durable frontend "fall through to blend when native unavailable" was discussed, not built.

## 7. Diagnostics/globals (frontend, visible-tab forensics)
`window.map`, `setActiveModel`, `toggleLayer`, `setTimeOffsetHours`; `__MARINE_SERIES_DIAG__` (loads/hits/misses), `__MARINE_GOVERNOR_STATE__`, `__MARINE_ENGINE__._waveData.waveGrid`. The MCP/preview tab runs HIDDEN (rAF paused) → use it for LOGIC counts, NOT repaint timing; verify snappiness on a VISIBLE tab. Runbook: `docs/runbooks/debug-weather-engine.md`.
