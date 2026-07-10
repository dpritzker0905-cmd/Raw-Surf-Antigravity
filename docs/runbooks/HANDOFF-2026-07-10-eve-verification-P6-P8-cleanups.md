# HANDOFF — 2026-07-10 EVE: #22/#7 VERIFIED, P6+P8+P9 phases banked, 5 code commits, NEW #24

**Bootstrap order:** memory index → `WEATHER-SIM-MASTER-AUDIT-2026-07-10.md` (findings #1-#24
authoritative) → `HANDOFF-2026-07-10-audit-day-close.md` (the day ledger) → this doc.

## 1. VERIFIED TONIGHT (the audit-day §2 list — CLOSED)
- ✅ **#22 ICON wind pre-bake** — run 29124845622 (dispatched-then-evicted by the 74-min-late cron;
  GH pending-slot mechanics, see §4): log 21:40:25 "Ingested 52 ICON wind extended-tail files";
  health 113.7→**323.2h**; far +250h /grid **0.62s** stored (`…20260721T070000Z_estimated.json`,
  629 vectors, basis icon_loop_extrapolation). Was 504@40s.
- ✅ **#7 awake-cycle window probe** (backlog ⑤) — EURO/marine held 319-320h through the ENTIRE
  21:36→22:50Z window, zero dips (3-min polls; `ingest_window_probe.log`); extend job saved 144.
- ✅ `6859caa1` deployed (SW `BUILD_VERSION`==`1939082b`==then-HEAD). ⚠️ USER GESTURE still owed:
  waves-scrub → switch ICON wind → expect "holding last frame", no clear. Same for the #21 capture.

## 2. SHIPPED TONIGHT (all pushed together; kill switch in parens)
| Commit | What |
|---|---|
| `938302aa` | viewport_service.py split 800→638 + viewport_upstream.py 242 (pure motion; db94a7c3 shield surgery untouched; backend 569) |
| `3c1b9aec` | **#18/A3 + #19**: series frames MINT truthTag (buildTruthTag; grid+wrapper) → commit/webglUpload share product+traceId; TruthDiff report un-gated (B1) + all-layers rules (B2). FE 765, 2 pinning tests |
| `3379b47b` | #12-class: [MapCore] observability block opt-in (`__RAW_MAP_OBSERVABILITY_LOG__`); WARN/error stay. Live-verified 0 vs 1 lines/pan |
| (2 commits) | Dead-code: WebGLSynchronizedOverlay deleted (unmounted, held the last unguarded setWindData); /tiles/{layer} route retired (forecast_cache FILES stay — wind_ingestion.py:169 reads wind_global.json as ingest fallback) |
| (docs) | Audit doc: P6 OceanMask lifecycle DOCUMENTED · P8 static+latency DONE · P9 commit-site invariant 3/3 · #22/#7 verified rows · NEW #24 |

## 3. NEW FINDING #24 (USER DECISION) + strategy outcome
**grid_series GFS/ICON marine regional = flat ~30s stall** (×4 probes, hours=0 identical):
`GFS_ICON_SERIES_FASTPATH=1`'s live open-meteo fetch times out at `OPENMETEO_SERIES_TIMEOUT=30.0`
every call, then the per-hour loop serves stored instantly. Options in audit row #24 (kill the
Render var / SWR-ify / tune ceiling). May explain client series "loads:N, hits:0" stalls.
**Strategy (triple-audited, forensics + 3-mo commits + MDN/Render/GH docs):** ① pre-bake EURO wind
240→336h + ICON marine >168h on the Stage-6I.2 rail (`ingest_euro_marine_extended_estimates`
pattern; #22 proved the effect) → ② Render dashboard build filter (ignore docs/**) → ③ #9
capabilities truth (native_horizon_hours has ZERO frontend consumers — safe; max_forecast_hours
untouched) + /status truth → ④ external uptime probe (user) → ⑤ A1 absence watchdog → ⑥ run-keyed
grid URLs THEN CDN long-TTL immutable (f8c0c6b2 = the burn scar; 84bb1351 = the immutable-success
precedent; MDN pattern) → ⑦ dev/main (239 commits apart) → ⑧ capacity last.

## 4. LANDMINES (tonight)
- GH concurrency: ONE pending slot per group — a late cron EVICTS a queued dispatch ("cancelled,
  jobs: []", jobCount 0, harmless). GH cron is documented best-effort (5-30min routine, silent skips).
- #22's log line is "extended-tail files", NOT the "loop-ext tail" prefix — grep "extended-tail".
- Preview zero-network marine stall: matches the 07-06 stranded-marker wedge (hard refresh) but #24's
  30s series stalls are a second candidate — separate them before diagnosing either.
- `frontend-verify` launch config (port 3009) = this-session preview; dev build auto-seeds mock user;
  map at /map; layer buttons have NO titles (find by button text "Waves").
- Bash tool on this box: background commands don't inherit cwd — absolute paths.

## 5. NEXT QUEUE
1. USER: 6859caa1 gesture-verify · #21 capture · #24 decision · Render build filter · uptime probe.
2. Pre-bake slice ① (EURO wind ext + ICON marine ext) — new scheduler stages, Stage-6I.2 template.
3. P7 (SpectorJS, user session) · P9 races (remaining classes) · P12 · P14 readiness.
4. A3 live lineage check (series product ids in `__WEATHER_TRUTH_TRACE__` on a real scrub) — unit
   tests pin it; browser check optional.
