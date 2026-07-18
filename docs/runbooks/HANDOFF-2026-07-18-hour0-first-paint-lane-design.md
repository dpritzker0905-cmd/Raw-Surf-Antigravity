# HANDOFF 2026-07-18 — HOUR-0-FIRST PAINT LANE (implementation-ready design, evidence complete)

## The problem (measured, 4× cross-verified — see memory `driverb-stitching-audit-2026-07-17`)
First marine activation on an ingest-covered coast: fine paint at **~4.2 s** (coarse world paint
~2 s first = the "two heatmaps"). Network ladder (probe_first_activation.js, 2 runs): regional
`grid_series` fires **+43 ms** (client is instant) but its 48-hour page takes **2.5–3.3 s**
first-byte during the activation storm; fine commit ≈ land + ~1 s parse/commit.

## The proof that picks the fix (concurrent-curl storm reproduction, 2026-07-18)
| request | in storm | warm | isolated |
|---|---|---|---|
| series p1 (48 h, 618 KB) | **2.998 s** | 0.66 s | — |
| series p2 | **2.855 s** | 0.86 s | — |
| world grid | 0.37 s | 0.25 s | — |
| **hour-0 fine /grid (36 KB)** | **0.30 s — NOT serialized** | 0.22 s | 0.17 s |

Small requests sail through the storm ⇒ **client-side hour-0-first lane wins; no backend change.**
Expected: fine paint ~0.5–1.0 s, BEFORE the world-coarse even fires (+1.5 s) ⇒ the "two heatmaps"
sequence disappears on covered coasts; provisional-infobox + coarse-color windows collapse with it.

## Design (verified against current code, 2026-07-18)
Insertion: `frontend/src/components/map/marineGridSeries.js::ensureMarineSeries` (line ~504) — the
choke point every activation series load passes. On a COLD current page (no fresh cache entry, not
in flight): fire a **mini series load first** — same endpoint, `hours=<hourOffset>` ONLY (server
cost ≈ single-hour /grid: 0.26 s / 36 KB proven) — then continue the normal full-page load.

Mechanics verified:
- Store the mini entry under a DISTINCT key (`pageKey(...)+'_h0'`) with `hours=[hourOffset]`,
  same `bounds/model/layer`. `getMarineSeriesFrame`'s **containment fallback** (line ~602-609,
  iterates ALL `_seriesCache` values) serves it while the exact page key misses; when the full page
  lands under the exact key, the exact-key loop (diff 0) naturally wins. Mini entry then ages out
  via `SERIES_TTL_MS` — no eviction code needed.
- Do NOT store the mini under the page key — `loadSeriesPage`'s freshness check would skip the
  full-page load ("already cached").
- Surf-mode flavor: the mini load must carry the same `surf` param the page load carries
  (`getSurfModeFlag()` — see the `_wantSurf` check in the fallback, line ~606).

## ⚠️ The ONE unverified interaction (verify FIRST, before writing the lane)
Does the orchestrator re-poll `getMarineSeriesFrame` when a series load COMPLETES (the
`series-revalidated` re-arm mentioned in `useMarineOrchestrator.js`), or only on gesture/settle?
If completion re-drives: the mini frame paints the moment it lands (~0.5 s). If NOT: the mini
paints only at the next poll — add the same completion signal the full-page load fires (find it at
the end of `loadSeriesPage`) to the mini load. Read `useMarineOrchestrator.js` (774 LOC) for the
consumer loop before wiring.

## Guards to verify in the probe A/B (both documented interactions expected to pass)
1. No-downgrade gate: mini fine commit (regional dims) → full-page commit (same dims/bounds) =
   same-tier refresh, passes. Watch `__MARINE_NO_DOWNGRADE__.count`.
2. §0l inflight dedup: mini vs page identities differ (different hour lists) — no absorption.
   Verify in the network ladder (both requests fire).

## Ship checklist (house rules)
- Kill switch `__RAW_DISABLE_HOUR0_FIRST__` (+ env-style default-on).
- Unit goldens: mini-entry serve-then-replace; TTL; kill switch; EURO exempt? (EURO series =
  per-hour Copernicus ~10 s — the mini IS one hour, safe, but verify cost before enabling there;
  GFS/ICON re-slice cached coarse products = cheap).
- A/B proof: `probe_first_activation.js` (scratchpad; has network + commit ladders + PROBE_SWR) —
  acceptance: fine commit sinceClick ≤1.2 s, no extra commits, no no-downgrade rejects, zero
  console errors. Then zoomout_ratingoff/_ratingon + staircase_full batteries (opacity-path
  adjacency rule) before push.
- File LOC: marineGridSeries.js is 664 — room to add without an extract; do NOT touch
  useMarineDataFetcherCore.js (927 LOC, extract-first standing warning).

## Session evidence chain (for the reviewer)
SWR-ladder hypothesis falsified → lane-sequencing falsified → payload-size attribution falsified
(localhost curls were CRA HTML fallbacks — ALWAYS check content_type) → storm experiment decisive.
Probes: probe_first_activation.js (net+commit ladders), storm curls (this doc §2). Nine ships this
session (infobox marker 2da69161 · opacity flatten 6141d30c · sharpen ease 983d5b3c · from-hidden
guard 30846e38 · surf v3 e1d88df6 · §5i coherence gate 5764588d · NaN guard 93086581 + harness
upgrades) — all CI-green, live-verified.
