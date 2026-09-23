# Weather Simulation Audit 14.1 — two-machine reconciliation, live visual pass

| | |
|---|---|
| **Date** | 2026-09-23 (UTC ~00:30–02:30) |
| **Baseline** | `dev` = `b75ed960`; backend `/api/health` and `dev--rawsurf` service worker both report `b75ed960` |
| **Scope** | Both dev machines' work Sept 7–22, all open PRs, live backend, signed-in visual pass (in-app browser, mobile layout ~731 px, dark theme) |
| **Method** | Forensics (every claim probed) + Jacobian lens (rank by leverage on "the feature works end to end") |

Status vocabulary: VERIFIED PASS / VERIFIED FAIL / OPEN / RETRACTED.

## 0. Headline

The forecast science largely verifies. The largest single blocker is **process**: two machines and two
agents kept **forked state records**, so work was re-discovered, stranded, or conflicted. The largest
**user-facing** defects found live were (a) surf spots silently vanishing after a large zoom-out and
(b) the forecast wheel, the requested time and the displayed frame disagreeing.

## 1. State of the program (VERIFIED)

- **The shared record is forked.** Machine B's `program/weather-simulation/CURRENT_HANDOFF.md`
  (checkpoint chain ending 2026-09-18) differs from `dev`'s (Program 13.0 + Codex 2026-09-20). The
  "weather memory authority" block in machine B's `CLAUDE.md`, `CURRENT_KNOWLEDGE.json`,
  `verify_knowledge.py`, and `audit/weather-simulation-2026-09-17/`, `…-09-18/` exist **only
  uncommitted on machine B**. Its verifier passes, but against a record 18 PRs stale.
- **Stranded work:** 16 commits of 2026-09-08/09 on `codex/weather-accuracy-evidence` are not in `dev`
  (patch-equivalence checked). PRs **#43 and #44 are CONFLICTING** with `dev`. ~24 worktrees exist.
- **PR #48** (remove inline Qdrant/Supermemory credentials from tracked instructions) has been an open
  draft since 2026-09-20.

## 2. Live measurements (VERIFIED, 2026-09-23 ~01:10Z)

| probe | result |
|---|---|
| data lanes | 9/9 `ok`, ages 1.6–2.2 h |
| Data Health Monitor | **3 of last 6 runs failed** — "ratings/precomputed: NO frames", "Regional lanes CRITICALLY stale". Intermittent. |
| `GET /api/weather/grid_series` (server telemetry, 3 h uptime) | n=71, avg 8.07 s, **22/71 > 10 s**, max 23.8 s |
| `grid_series` direct | warm GFS small bbox 0.6 s; EURO `swell_1` 5.9 s / 1.19 MB; wind ~1 MB |
| RSS | 1,153 / 2,048 MB, +31.8 MB/h |
| **F-05** EURO model-cycle identity | **still OPEN: 7,502 / 7,588 EURO products (98.9%) `model_run_time_status: missing`** |
| **F2** rating, `RATING_LOCAL_SIZE=1` (all three lanes) | still OPEN: `size_score(h, ref 4.0)` = 1.0000 at 12 m and 20 m — no oversize penalty |
| frontend map/weather/marine suites at `b75ed960` | 200 suites / 2,113 pass |
| backend forecast-chain selection at `b75ed960` | 200 pass / 2 skip (6 initial errors were a Windows tmp-dir permission, pass with `--basetemp`) |

## 3. Visual pass (signed in, `b75ed960`)

| check | verdict |
|---|---|
| WebGL / waves heatmap | VERIFIED PASS — ANGLE Intel UHD D3D11 (the 2026-09-18 "GL Disabled" blocker is gone); **54 FPS** over 3 s; clean coast |
| mobile layers sheet | PASS — 12 overlays + GFS/EURO/ICON |
| mobile timeline sheet | PASS — legend, honest "~223 km grid (2°)" disclosure, wheel, ±1h/±1d. Minor: the right-side FABs overlap the sheet and hide the legend max label |
| **F-11** projection diagnostic | VERIFIED FAIL — reports `global_mid`, 2°, 15,023 vectors while 169 are uploaded/drawn |
| **F-10** parity flags | VERIFIED FAIL — `infoboxHeatmapParity` and `pointVisualParity` both `false` in steady state |
| model switch GFS→EURO | settles in ~3 s; for ~3 s the GFS grid renders under the EURO selection (`mismatchReason: "activeModel is EURO but grid sourceModel is GFS"`) |

## 4. NEW — S-01 · Surf spots vanish after a large camera change · VERIFIED FAIL → fix in PR #64

Owner report: "surf spots aren't visible". Live: `/api/surf-spots` 200 with **1,773** spots; `MapWebGL`
held all 1,773 with `filter: 'all'`; `spotClusters` = **0**. Camera z2 (world); clustering bounds memo =
the initial z9 Miami box (−80.7…−79.7). One real drag restored every cluster.

Mechanism: `useMapViewState.onMove` stores react-maplibre's *proposed* `viewState`;
`useSpotClusteringData` read `mapInstance.getBounds()` in that same render, before the map applied it
— i.e. the previous camera. Fix re-reads on `moveend`/`resize` (the pattern `useSpotRatings` already
used). Mutation-checked test. PR #64.

## 5. NEW — T-01 · Three clocks on one wheel position (the mechanism behind F-07/F-12) · VERIFIED FAIL, OPEN

Live, +1h button ×4 at wall clock ~01:2xZ (anchor 01:00Z):

| wheel | `requestedValidTime` | `selectedValidTime` (drawn) |
|---|---|---|
| +1 h (02:00) | 03:00 | 01:00 |
| +2 h (03:00) | 03:00 | 04:00 |
| +3 h (04:00) | 03:00 | 04:00 |
| **+4 h (05:00)** | **06:00** | **04:00** |

These are different instants (compared as times, not strings).

**Mechanism (source + API verified):**
1. `marineGridSeries.buildPageHours` requests offsets `0,3,6,…` from the **hour-rounded** series anchor
   (`getSeriesAnchorMs`), so series frames land at anchor+3k (01, 04, 07 Z) — **off the model's 00/03/06
   grid**. `nearestFrameInEntry` then snaps the wheel to the nearest of those (+4 h → 04:00).
2. `getSharedValidTime` (the coverage/single-grid lane) snaps the same wheel position to the nearest
   **manifest** product (3-hourly, 00/03/06) → 06:00.
3. The manifest is strictly 3-hourly for GFS, ICON and EURO (measured). But for the Florida viewport
   `grid_series` is served by **live Open-Meteo hourly** data: every frame `provider: open-meteo`,
   `model_run_time: None`, `frame_substituted: false`, distinct payload per hour — while the manifest /
   single-grid lane is NOAA-direct 3-hourly. "GFS waves" is two suppliers on two cadences.
4. `run_census.min_run_time = 02:12:58Z` equals the frames' `ingested_at` — a **fetch time presented as a
   model run time** (the F-05/F-06 provenance class).

The direct-coverage policy that would keep this viewport off the Open-Meteo series lane was PR #43,
which never merged and now conflicts.

**Repair design (not yet implemented — changes paging, cache keys and pixels; needs owner visual acceptance):**
- align series offsets to the active product's cadence grid in UTC (not anchor+3k), and include the
  anchor frame for "Now";
- make the wheel either step at the active layer's cadence or label the frame actually drawn;
- one selection function for both lanes, so `requested`, `selected` and the wheel cannot disagree;
- resolve the supplier question first (direct vs Open-Meteo for regional series) — it determines the cadence.

## 6. Stranded-patch forensic note

Machine B's uncommitted F2 pin (2026-09-14) had been inserted **mid-function**: the prior test's last
three `mavs_big` asserts moved into the new function, where `mavs_big` is undefined. Under a plain
`xfail(strict=True)` the resulting `NameError` would satisfy the xfail forever without testing the
rating. Re-landed correctly with `raises=AssertionError` in PR #65, together with the F3 env-leak fix
(reproduced on `dev`: a sim test passes alone and fails after the leaking file).

## 7. Retractions (mine, this audit)

- "The mobile forecast wheel sits under the bottom nav and is unreachable" — **RETRACTED**. It is a
  collapsible sheet; the collapsed state is by design and it opens correctly.
- "Caspian/Black Sea painted flat cyan (no-data as value)" — **NOT CONFIRMED**; on the next settled frame the
  Black Sea showed normal texture. Not a finding.

## 8. Leverage ranking and plan

1. **One record** — merge the machine-B knowledge base into `dev`, reconcile the two handoffs, close/rebase
   #43/#44, triage the 16 stranded commits, finish #48 and rotate keys, prune worktrees.
2. **A visual gate that can finish** — Playwright with the E2E access code on deploy previews: model ×
   layer × zoom/pan/scrub × theme × device, asserting decoded pixels, matching times, sustained FPS,
   and spot-cluster presence after large camera jumps (S-01 class).
3. **T-01** timeline clocks (above), then F-12 cancellation.
4. **Transport** — price F-03's remaining bytes; target p90 `grid_series` < 5 s; chase the
   intermittent precomputed-ratings gap.
5. **Provenance** — F-05 EURO cycle, F-06, F-11, F-10, F-09 temperature rows, `run_census` fetch-time label.
6. **Owner decisions** — F2 calibration, cap-seam flag, F-08 regional coverage.

## 9. Addendum — later the same day (2026-09-23)

- **Pipelines verified (owner mandate: marine from NOAA GRIB / ECMWF).** Ingestion runs `35792283418`
  / `35795126132`: GFS regional "GFS-Wave multi-region OK" (12 + 3 regions, NOAA byte-range GRIB),
  ICON "DWD-direct OK", EURO mid "ECMWF-direct OK", EURO regional CMEMS. Stored products comply.
  ⚠️ Manifest `provider: "open-meteo"` on those rows is the render-whitelist key, not the transport
  (off-openmeteo runbook §5); origin is `upstream_provider`. I briefly misread this — corrected.
- **The request path did not comply:** `GFS_ICON_SERIES_FASTPATH=1` served every GFS/ICON scrub from
  a live Open-Meteo fetch over stored NOAA tiles (and at a coarser grid: 64 vs 169 vectors at the
  same view). PR #68 routes to stored products; it needs PR #67 (series offsets on the product grid).
- **T-01 accepted on the #67 deploy preview**, A/B against dev at the same phase: dev mismatched at
  +1 h and +4 h; the PR matched at every step. Evidence on PR #67.
- **F-07, a third clock:** the timeline readout printed browser time + offset ("4 AM" while the
  anchor meant 05:00 and 06:00 was drawn). PR #69.
- **F-11 is user-visible:** the legend's "~N km grid" notice reads `__MARINE_PROJECTION_DIAG__`;
  live at z9 it said "~223 km grid (2°)" over a 221-vector regional field. PR #70.
- **F-12** not reproduced here: no queue exists in the wheel or `useWeatherState`; the drain is
  downstream, and 14.0 never reproduced the entry by real gestures. Left open.
- **F-08** priced: `F08-COVERAGE-PROPOSAL.md`.
