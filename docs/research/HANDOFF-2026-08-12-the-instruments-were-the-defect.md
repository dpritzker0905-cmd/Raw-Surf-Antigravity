# Handoff 2026-08-12 — the instruments were the defect, four times

Supersedes the status lines in `HANDOFF-2026-08-11`. Everything of mine is pushed; nothing is
uncommitted on my side. Tip at writing: `b5632fc7`. Backend CI **20 pass / 0 fail**; `e2e` red for
environmental reasons documented below.

---

## ⭐ THE HEADLINE — `SURF_TIDE_DEPTH`, SIX samples — and the flag now has evidence, not a guess

| # | window | replayable | moved | max abs delta | tail rows |
|---|---|---|---|---|---|
| 1 | 08-09, 3 h | 486 | 0 | 0.2 | none |
| 2 | 08-11, 5 h | 496 | **8** | **3.2** | none |
| 3 | 08-12, 12 h span / **5 distinct served frames** | 123 | 0 | 0.2 | none |
| 4 | 08-12, 1 live frame | 15 | 0 | 0.2 | **4, to 3.22 m** |
| **5** | 08-12, 1 **precomputed** frame | 17 | 0 | **0.1** | **7, to 3.71 m** |
| **6** | 08-12, **14 h span / 5 served frames** | **127** (1 disq.) | **0** | 0.2 | **44** |

**Sample 3 retired the tide-PHASE hypothesis** — it covered a measured 2.4–3.1 m tidal swing and
moved nothing. **Sample 4 is the first observation of the depth-limited regime ever taken** and
shows the same smallness.

⚠️ **SAMPLE 2 IS NOW UNEXPLAINED BY EITHER HYPOTHESIS.** Phase is dead (3), size is not supported by 4, 5 OR 6
. I do not have a third explanation and did not invent one. **Five of six** samples say the term
is user-invisible; the outlier survived both stories I had for it.

✅ **SAMPLE 5 IS DONE (see the table).** The trigger below fired within the hour and the sample ran on PRECOMPUTED tail rows to 3.71 m: 17 replayable, 0 disqualified, 0 level changes, max |delta| **0.1**. ⭐ **The clock ended itself because it named the observation that ends it** — unlike the false blocker it replaced. ⚠️ Sample 2 now stands ALONE against FIVE nulls, three of which cover the depth-limited regime that was its last available explanation. Every hypothesis proposed for it has been tested and failed. I am NOT calling it noise: 8 rows moving 3.2 points is a real observation from a real instrument, and "outlier explained by something unmeasured" is not distinguishable from "outlier that was always noise" on the evidence I have. What changed is the BURDEN. ▶ **Original next step, now satisfied: sample 5, once the precompute writes tail rows.** Unlike the false blocker I wrote
yesterday, this clock names the observation that ends it:
**`rows >= 2.5 m carrying inputs > 0` on a `source: precomputed` frame.**
Then `--frames-file` a production frame and read the **DEPENDENCY** line, never the headline.

---

## ✅ SHIPPED (all pushed, all verified before and after)

- **Tail sampling** (`b5632fc7`) — big surf now sampled UNCONDITIONALLY on top of the uniform 5%
  draw. `SPOT_RATINGS_INPUTS_TAIL_M` default 2.5 m. **Verified live in production:** rows >= 2.5 m
  carrying inputs went **0 of 7 → 4 of 4**; max sampled height **1.93 → 3.22 m**; payload +~0.6%.
- **Three coverage disclosures** in `science_shadow_ab.py`, none able to see the others' failure:
  `! SPAN UNKNOWN` (2323874a), `! REPEATED FRAMES` (70fa7144), plus the tail fix above.
- **The floor-provenance trap fixed at the CLASS level** (d4c4f5d3) — the staleness prescription
  now names BOTH edit sites, the file, the key and the value.
- **CI floors** carried forward correctly: guards 1685→1695→1699, estate `_FLOOR_SET_FROM`→349.

## ⛔ STILL DARK / OWNER-GATED (unchanged from 08-11)

`__RAW_LAYER_CAP_ALIAS__` · `__RAW_AXIS_FLOOR__` · `__RAW_RATING_SPAN_FADE_HI__ = 40`.
Radar legend units (#9) still blocked on the external RainViewer scheme-7 palette spec.
`BRAIN_RULES.md` still carries a committed live API key — owner rotation.

---

## ⭐⭐⭐ THE RULES THAT PAID FOR THEMSELVES

1. **A sample can look broader than it is, and each way is invisible to the guard for the others.**
   Span=None fell out of BOTH branches · 12 requested hours = 5 SERVED frames · a uniform 5% draw
   reaches a 1.5% tail never. ⭐ **Span is a property of the REQUEST; coverage of the RESPONSE.**
2. **A prescription naming one of two required edits has a 100% miss rate.** Three consecutive
   commits, two authors, same trap. ★ **Fix the INSTRUCTION, not the third instance.**
3. **A prescription computed from the last GREEN run cannot see tests already committed but not yet
   run.** Its number describes the past; a floor must survive the future. Project it, mark it
   PROJECTED, **show the arithmetic** — that is what makes it falsifiable rather than fabricated.
4. **A DEPLOY IS NOT A PRECOMPUTE.** Production ran `b5632fc7` while serving a blob written by its
   predecessor. The first reading said my change had failed; the deploy SHA said it had worked.
   **Both were true and neither was the answer** — the live-compute fallthrough was.
5. **A blocker I authored decays exactly like anyone else's, and I trust mine more.** "A third tide
   sample needs a large swell — a clock, not a task" died to one API call.
6. **A verification inherits the working directory of what it verifies.** A persisted `cd` made a
   restore fail AND made the `git diff` confirming it report "0 lines changed" — a clean reading
   from the wrong scope, leaving a bogus floor in a shared tree.
7. **A hand count is a measurement.** I published "3 distinct served frames"; the instrument said 5
   and was right. I applied no scepticism to it purely because I had done it myself.

---

## ⛔ WHAT I GOT WRONG (the useful half)

| # | wrong claim | what caught it |
|---|---|---|
| 1 | "backend-floor-staleness has already cleared" | RUN-level conclusions vs JOB-level; `gh pr checks` |
| 2 | fixed the floor, left `_FLOOR_SET_FROM` stale | the paired test, on the very next run |
| 3 | my own prescription stated a FALSE equation | forcing the branch to execute against a mutated floor |
| 4 | non-ASCII in a print, on cp1252 stdout | **twice** — my own most-recorded Windows trap |
| 5 | "3 distinct served frames" | the instrument I had just written said 5 |
| 6 | nearly published a "12-hour" sample | inspecting ONE instance before parsing the set |
| 7 | +24 LOC into a file with a HARD 800 limit | checking `wc -l` before committing, not after |

★ **Every catch came from a control, a mutation, or executing the thing. A green suite caught
none of them** — and in the SPAN UNKNOWN case the suite *could not*: its own helper emitted no
`hour_offset`, so all 29 tests ran the silent path.

---

## ⚠️ OPEN, AND WHOSE

- ⛔ **RETRACTED IN PART — "user-facing 503" WAS MY CURL, NOT THE PRODUCT.** `useSpotRatings.js`
  carries an explicit `status: 'skipped_beyond_bound'` path — *"beyond precompute bound —
  endpoint SKIPPED, grid fallback covers"*. Past the bound the client never calls the endpoint,
  so users do not see the 503 at all. ★ **I measured the API and called the result a USER
  experience without checking whether the client makes that call.**
  ⚠️ **What IS real, and sharper: scrubbing past the bound silently SWITCHES LANES.** The
  fallback is the raster BAND, and band vs glyph are on record as disagreeing 2.3–2.7× at
  close zoom (queue E#1). So the number on screen changes its source mid-scrub, with no
  disclosure. Whether that produces a visible jump needs a runtime measurement at the bound —
  **not attempted, and E#1 belongs to the concurrent session: do NOT tune either lane.**
  ▶ The original raw-API observation, kept because it is still true of the API: at 2026-08-13T04Z,
  bbox `-30,30,40,70`, +48 h and +120 h returned 503 for GFS and EURO alike (+1 h returned 200).
  The body — *"live path at capacity; precomputed lane refreshing"* — REFUSES rather than
  serving a stale frame, which is the right failure.


---

## ▶ ADDENDUM 2026-08-13 — WATER TEMP WAS BLANK ON EVERY MODEL: A MISSING COLOUR-SCALE KEY

Owner-reported, owner-confirmed fixed (`0f13fa7d`). Root cause, measured end to end:

| stage | reading |
|---|---|
| requests | correct z/x/y at z9, z5, z2 (dev live) — nothing missing |
| source | `isSourceLoaded: true`, `areTilesLoaded: true` |
| decode | **4,718,592 values, −53.95…+38.75 °C**, 31.6% NaN over land — REAL DATA |
| colourise | **no `surface_temperature` among the 49 registered scales** |
| render | transparent tiles, blank ocean |

`LayerRegistry` points the layer at `surface_temperature` because `sea_surface_temperature` is not
hosted on the tile CDN — **and the colour scale kept the old name. The data moved; the key did
not.** Fixed by `aliasSurfaceTemperature()` in `colorScales.js` (aliased not copied, guarded both
ways), called once at the merge point. 5 tests, mutation kills 1. `openMeteoProtocol.js` held at
its grandfathered **943** by condensing the coastal-QC comment 9→7 with every fact retained.

⭐⭐ **A LOOKUP MISS THAT RETURNS "NOTHING TO DRAW" IS INDISTINGUISHABLE FROM "NOTHING TO SHOW".**
Nothing logged a failure because nothing HAD failed. ⇒ **Blank render + green upstream ⇒ diff the
NAME KEYS (variable / scale / palette / layer id) first.** Seconds of work; I reached it after
SEVEN refuted hypotheses (model capability · ocean mask · cache-buster · cache misses · source
bounds · tile enumeration · RAF cancel-starvation).

⚠️ **TWO OF THOSE SEVEN I PUBLISHED BEFORE TESTING, BOTH FROM SAMPLING A MOVING TARGET.** A tile
trace read *during* a zoom shows a partial set — that produced "only x=0 is requested" and then
"only y=3 is requested", each with arithmetic against the current centre. Held still, the same view
requested all six tiles it should. **Hold the view, clear the trace, toggle the layer to fetch.**

### ✅ Shipped alongside
- **`omUrlTrace.js`** (`82005e35`) — records the z/x/y the `om` protocol is actually asked for; the
  only non-second-hand vantage point (`__RASTER_PROBE__` never fires there, fetches are off-thread
  so they miss the network log, `getStyle()` reports `tiles: []` for sources that ARE serving).
- **`launch.json` backend interpreter** (`7b74ae96`) — pointed at the broken Windows python, so the
  local backend could never start and the local map never had data.

### ⚠️ FOG — NOT REPRODUCED, DO NOT ASSUME IT IS THE SAME BUG
Owner reports fog blank at global zoom (blank, **not** faint). On a clean dev-live page it measures
**healthy at z9, z5.33 and z2**: real URL, `visibility` on `ncep_gfs025`, **5.79% of cells under
1 km**, decode clean, opacity 0.4 at z2. `visibility` HAS a colour scale, so it is not the
water-temp mode. The RAF-starvation theory was measured and **refuted** (556 scheduled / 556 fired
/ 6 cancelled; toggling 30 ms apart did not blank it).
★ The one blank I saw followed heavy console manipulation and did **not** survive a clean reload —
**console residue is a confound; re-test on a fresh page before reporting.**
▶ **The decisive capture must be taken WHILE IT IS BLANK, before reloading:** read the `fog-slot-*`
source URLs. `om://transparent-tile` while the button is pressed ⇒ layer-state desync (the URL
resolve is gated on a **cancellable** `requestAnimationFrame` — latent fragility, not proven
cause). Real URLs ⇒ the failure is downstream in decode/render.


---

## ▶ ADDENDUM 2026-08-13 (later) — THE ZOOM FLOOR BLANKS **EVERY** om:// RASTER LAYER

Owner: *"fog isn't activating at the two farthest out zooms"*. `minZoom` is **2** on dev live, so
that is z2–z3 — the one regime I had never rendered in. That single detail unlocked it after eight
refuted hypotheses.

**Controlled: same layer, settled view, cache cleared, one zoom notch apart.**

| zoom | trace entries (callback ENTERED) | reached `TILE_TRUTH.protocolCalls` | decoded |
|---|---|---|---|
| 2.99 | 45 | **20** | yes |
| **2.00** | **24** | **0** | **0** |

⭐⭐ **THE CALLBACK IS ENTERED AND EXITS EARLY.** `traceOmUrl` sits at the top of the om protocol
callback; `TILE_TRUTH.protocolCalls` increments further in. **Them disagreeing 24-to-0 IS the
finding** — and it is only visible because an entry-point probe exists. Without it, "24 entered /
0 decoded" reads as "nothing was requested", which is exactly what I concluded twice earlier.

⭐ **NOT FOG-SPECIFIC — water temp blanks at the floor too.** Every `om://` raster layer is affected;
the owner simply noticed it on fog. (Distinct from the water-temp colour-scale bug, which was real,
separate, and is fixed.)

### Probes deployed (`ba7f1c18`) — read one number to name the branch
`traceOmBlock` now instruments the THREE early returns between entry and decode:
`missing_run` (MISSING_OM_RUNS) · `transparent_sentinel` · `model_lock` (`isModelMatch`, which also
records `requestedFolder|activeLock`). At the zoom floor:

```js
window.__OM_URL_TRACE__ = { n:0, x:{}, y:{}, z:{}, recent:[], unmatched:0 };
// toggle a weather layer, then:
JSON.stringify({ entered: window.__OM_URL_TRACE__.n,
                 blocked: window.__OM_URL_TRACE__.blocked,
                 detail:  window.__OM_URL_TRACE__.blockedDetail })
```

⚠️ **`model_lock` is a HUNCH, not a finding** — it would explain zoom dependence if the resolved
model folder differs at low zoom, but eight hypotheses have already died here and the probe costs
one deploy to answer properly. **Read the branch; do not assume it.**
★ LOC-neutral: each probe folds into the existing return (`traceOmBlock(...) || fallback(...)`,
always undefined) because `openMeteoProtocol.js` is grandfathered shrink-only at **943**.
