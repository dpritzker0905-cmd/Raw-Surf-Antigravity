# HANDOFF 2026-07-22 (Opus 4.8) — 4 lifecycle/race fixes + the EURO coarse Gulf saga (GFS-fill)

Base was `e65530b8` on `origin/dev`. HEAD is now **`7a50c437`**, `HEAD==origin/dev` (verified). **6 commits
shipped + pushed this session.** Two of them (`0fcde49c` pre-existing, `bedc0def` this session) were later
PROVEN INEFFECTIVE by live verification — the real EURO Gulf fix is **`7a50c437` (GFS-fill)**, whose
activation is **pending a coarse marine re-ingest** (run `29922098897`, in progress at handoff).

## 0. BINDING RULES (applied all session)
forensics-not-guessing · Jacobian lens (isolate the ONE variable) · study memory + recent commits before
touching a subsystem · instrument + kill-switch + A/B · test units AND live · **probe the served DATA at the
exact cells, never a proxy** · one change-set at a time, committed with evidence, pushed, `git log origin/dev`
verified · **report faithfully — including two dead-ends here; do not claim a fix works without probing the
served coarse product's actual `is_valid` at the masked cells.**

## 1. SHIPPED (6 commits, newest first)
| Commit | Fix | Kill switch | Tests | Status |
|---|---|---|---|---|
| `7a50c437` | **EURO coarse `waves` GFS-fill** — the REAL Gulf/enclosed-sea/Antarctic fix | `EURO_MARINE_COARSE_GFS_FILL=0` | 7 unit + 2 integ; 88 marine green | ✅ correct; **activates on re-ingest (run 29922098897 baking)** |
| `bedc0def` | EURO coarse `waves` → ECMWF Open-Data (was CMEMS) | `EURO_MARINE_COARSE_ECMWF=0` | 3 + 46 green | ⚠️ INEFFECTIVE for the Gulf (ecmwf_opendata ALSO masks it); harmless (gated, falls back) |
| `152fada5` | 3.4 `fireWhenStyleReady` idle-listener leak | `__RAW_DISABLE_STYLE_READY_FALLBACK__` | +2 FE (11) | ✅ verified 3 ways |
| `4695ef36` | 3.3 debounce-flag strand heal | `__RAW_DISABLE_MARINE_DEBOUNCE_STRAND_HEAL__` | +5 FE | ✅ verified 3 ways (live heal counter) |
| `ddb5e68f` | 3.2 marine coalesce uses the LIVE hour | `__RAW_DISABLE_MARINE_COALESCE_LIVE_HOUR__` | +4 FE | ✅ verified 3 ways |
| `74cca37a` | 3.1 wind viewport-refetch stale-HOUR guard | `__RAW_DISABLE_WIND_VIEWPORT_HOUR_GUARD__` | +3 FE | ✅ **caught firing live** (req +12h; now +96h) |
- FE suite **1433** green (was 1419; +14). Backend **88** marine/ingest green (incl. the new fill tests).

## 2. THE 4 LIFECYCLE/RACE FIXES (queue §5.3 from the prior handoff — all done)
Each verified 3 ways (unit + static trace + LIVE on the :3009 preview) with its own kill-switch:
- **3.1 `74cca37a`** — wind VIEWPORT refetch (`WeatherEngine.js` ~975) had a stale-MODEL guard (23e544a0) but no
  stale-HOUR guard; a scrub mid-flight committed the old hour's grid AS the new hour. Snapshot reqHour, discard
  when `timeOffsetRef.current !== reqHour`. LIVE-CAUGHT the discard.
- **3.2 `ddb5e68f`** — the layer-switch coalesce (`useMarineOrchestrator.js` ~483, deps exclude timeOffsetHours)
  used the frozen switch-time prop for the hour while the model used the live ref. New pure `resolveCoalesceHour`.
- **3.3 `4695ef36`** — pre-dispatch early returns leave requestId=0, so the finally never cleared
  `__MARINE_FETCH_DEBOUNCING__` (stranded true; ~8 gates hold stale frames). New pure `shouldHealStrandedDebounce`;
  live counter `__MARINE_DEBOUNCE_FINALLY_HEAL__`. Safe because :486 clears the flag at dispatch.
- **3.4 `152fada5`** — `fireWhenStyleReady` never removed its `once('idle')` listener on a fallback-timeout win
  (leaks the fn closure for the map's life when idle never fires). Idempotent `settle` offs the listener + clears the timer.
- (`useRasterTransactions` finding from the hunt = DEAD CODE, not patched — correct call.)

## 3. ★ THE EURO COARSE GULF SAGA (the user's headline issue) — TWO DEAD-ENDS, THEN THE REAL FIX
**USER-REPORTED:** zoomed out, the EURO marine `waves` heatmap inflates the Gulf of Mexico (~4-5ft off Texas
where reality is ~1.5ft); GFS & ICON are correct.
**Jacobian ROOT (proven by probing served `is_valid` at the exact 10° cells):** it is a **LAND-SEA-MASK gap,
not sampling.** At the 10° `global_coarse` tier a Gulf cell's subcells lie entirely inside the enclosed basin;
**both CMEMS (`cmems_mod_glo_wav`) AND ECMWF-WAM (`ecmwf_opendata`) structurally MASK the Gulf** → all-NaN block
→ `is_valid=FALSE` → the heatmap inflates the hole from distant open-ocean cells. **NOAA GFS (`ncep_gfswave025`)
and DWD (`dwd_gwam`) masks DO carry the Gulf** — which is exactly why GFS/ICON are correct and EURO is not.
- **`0fcde49c` (block-mean, pre-session) — INEFFECTIVE.** Block-mean can't invent ocean subcells the mask lacks.
- **`bedc0def` (swap EURO coarse `waves` CMEMS→ecmwf_opendata) — INEFFECTIVE.** Verified against the RE-BAKED
  product: ecmwf_opendata ALSO masks the Gulf. Swapped one masking source for another. Harmless, not a cure.
- **`7a50c437` (GFS-FILL) — THE REAL FIX.** New `_fetch_common.fill_masked_waves_from_gfs`: after fetching the
  coarse `waves` source (ecmwf or CMEMS) and the in-hand GFS coarse grid (`gfs_ext_src` — a `_GRID_CACHE` hit,
  NO extra quota), per-cell fill every `is_valid=FALSE` wave-height cell from the **aligned** GFS grid (all coarse
  fetchers share `coarse_axis` → identical cell centres). Open-ocean ECMWF/CMEMS values untouched; dir/period
  fill alongside; true-land (GFS-also-masked) stays empty; **time-format robust** (GFS-via-open-meteo is naive
  `...T00:00`, ECMWF/CMEMS aware `...Z` → normalize to datetime — a bug the first draft had). Uses the RAW
  `gfs_ext_src` (FULL 0-14d), **NOT** the `_slice_after` tail (landmine: the tail would leave 0-10d cells masked).
  Wired in `scheduler.py ingest_euro_marine_global` before the layer loop (mutates the waves source in place).
  `_fetch_common.py`, `scheduler.py`, `test_gfs_fill_masked_waves.py`, `test_ecmwf_euro.py`.

### 3a. ⚠️⚠️ THE VERIFICATION TRAP (fooled BOTH prior fixes — do not repeat)
`provider:'open-meteo'` is a normalizer artifact (all direct-GRIB); the `/api/health/data` lane tracks a
different EURO marine product than the coarse-global; a zoomed-in viewport quietly serves the finer mid tier
which ALWAYS has the Gulf. **The ONLY valid check is the served `global_coarse` product's actual `is_valid` at
the masked Gulf cells (lat20/-90, lat30/-90).** Probe: `/api/weather/grid_series?model=EURO&domain=marine&layer=waves&bbox=-179,-70,179,78&hours=24`.

### 3b. WORLDWIDE coverage review (user asked "don't miss gaps") — NO GAPS
The fill is location-agnostic (fills EVERY masked cell). Verified GFS carries valid cells at every masked EURO
enclosed sea: **Gulf of Mexico, Gulf of California, W Mediterranean, Adriatic/Aegean, Sea of Okhotsk, Yellow/E
China Sea** all → FILL COVERS. Caribbean/Baltic/North Sea/Red Sea/Persian Gulf/S China Sea/Bay of Bengal: EURO
already ok. E Med / Black Sea: no dedicated 10° cell in EITHER model (interpolated, not masked). **No case where
GFS also lacks the data.** Scratchpad: the review table + `sea_before_snapshot.json`, `coarse_coverage_before.json`.

### 3c. ANTARCTIC projection regression — SAME fix restores it (Jacobian)
The EURO coarse masked the Southern Ocean south of ~-60 (GFS reaches -78). Those masked southern cells are filled
by the SAME GFS-fill → EURO projection extends toward -78 like GFS. One change, three symptoms.

### 3d. ⚠️ HONEST CAVEAT — coarse block-mean reads high
GFS COARSE (10° block-mean) itself reads ~0.9-1.9m in the Gulf (vs ~0.5m at the fine tile), because a 10° block
averages a wide area. So the fill makes EURO **match GFS/ICON at the coarse tier**; it does NOT make the world-zoom
value equal the fine-zoom ~0.5m. At close zoom EURO already serves the fine ECMWF tile (correct ~0.5m). If world-zoom
still reads high enough to bother the user, the follow-up is filling from a FINER GFS grid (down-sampled), not the
10° coarse — a resolution refinement, not the masking bug.

## 4. ⚠️ OPEN / PENDING
1. **ACTIVATION of `7a50c437`** — the coarse products are pre-baked. Run **`29922098897`** (dev, has the fill) is
   baking at handoff. When it lands + the Render serve-box restores (`L2_RESTORE_INTERVAL_MIN=30`), VERIFY the served
   `global_coarse` Gulf cells go `is_valid=FALSE → TRUE` (§3a probe). If it doesn't land: `gh workflow run
   forecast-ingest.yml --ref dev`. Monitor for `provider` is a TRAP — check `is_valid`.
2. **USER-REPORTED (07-22, live): "toggle out and back → EURO Gulf shows incorrect again."** Characterized but NOT
   fully root-caused: the served coarse Gulf is STABLY masked right now (fill not landed), so the render inpaints/
   dilates the masked cells = the inflation; a toggle re-commits the coarse grid and the masked cells inflate. It is a
   SYMPTOM of the masked cells — the GFS-fill (removing the masked cells) should fix it. COULD NOT cleanly reproduce a
   distinct client tier-regression (my Swell↔Waves toggle showed consistent state); resident grid is React-state, not
   on `window`. RE-VERIFY once the fill lands (stable correct data); if a toggle STILL inflates, it's the frontend
   dilation of coverage-gap cells (WebGLMarineTextureEncoder.dilation) — the interim gate the earlier workflow flagged
   as high-blast-radius. Repro harness: hook `fetch` for EURO marine grid URLs + capture cols/rows/is_valid per toggle.
3. **bedc0def disposition** — leave (harmless, gated) or revert; the Gulf needs the GFS-fill regardless.

## 5. LANDMINES / LESSONS (cost real time — DO NOT REPEAT)
- **Provider label + health lane + zoomed-in viewport all LIE about the coarse Gulf** — see §3a. This trap made
  `0fcde49c` and `bedc0def` both look fixed when neither was. ALWAYS probe the served `global_coarse` `is_valid`.
- **The Gulf bug is a MASK gap, not sampling** — all 3 coarse fetchers already block-mean; the differentiator is which
  model's land-sea mask carries the enclosed basin (NOAA/DWD yes, ECMWF-WAM/CMEMS no).
- **GFS-fill must use the RAW `gfs_ext_src`** (full 0-14d), not the `_slice_after(_cop_max)` tail (0-10d cells).
- **Time formats differ across fetchers** — GFS-via-open-meteo naive `...T00:00`, direct GRIB aware `...T00:00:00Z`;
  match by normalized datetime, not string (the fill's first draft silently filled 0 cells).
- **Serve-box L2 restore lag ≤30 min** after the ingest writes L2 — the served product trails the bake; don't conclude
  "fix failed" until after a restore window. And the FE dev-server needs `rm -rf node_modules/.cache` if it won't boot.
- **`computer` click/screenshot unreliable on the WebGL map** — drive via `.click()` + `window.map.jumpTo` + JS probes;
  reach `/map` via the dev-mock user in localStorage.
- Two GH ingest runs can overlap (concurrency group queues them); a scheduled run started before your push does NOT have
  your fix — trigger a fresh `--ref dev` run and watch THAT run id.

## 6. WHERE THINGS LIVE
- Backend fix: `backend/services/_fetch_common.py` (`fill_masked_waves_from_gfs`), `backend/services/weather_pipeline/
  scheduler.py` (`ingest_euro_marine_global`, ~340-430). Tests: `backend/tests/test_gfs_fill_masked_waves.py`,
  `backend/tests/test_ecmwf_euro.py`. Backend pytest: `cd backend && "$LOCALAPPDATA/Python/bin/python3.exe" -m pytest`.
- FE lifecycle fixes: `WeatherEngine.js`, `useMarineOrchestrator.js`, `useMarineDataFetcherCore.js` +
  `frontend/src/__tests__/` and `frontend/src/components/map/*.test.js`. Craco test:
  `cd frontend && node node_modules/@craco/craco/dist/bin/craco.js test --watchAll=false`.
- Memory: [[session-2026-07-22-lifecycle-fixes-and-enclosed-sea-activation]], [[euro-coarse-ingest-anatomy-gulf-fix-2026-07-22]],
  [[marine-coarse-enclosed-sea-dropout-2026-07-22]]. Scratchpad: `euro_gulf_ROOT_CAUSE.md`, sea/coverage snapshots.
- Ingest = GitHub Actions (`forecast-ingest.yml`, checks out default branch `dev`), NOT the Render cron. Serve-box is
  serve-only (restores L2). Prod backend: `raw-surf-antigravity.onrender.com`. Can't trigger prod admin re-ingest via
  API (dev-mock token ≠ prod JWT) — use `gh workflow run`.
