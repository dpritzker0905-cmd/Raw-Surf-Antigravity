# Handoff 2026-08-13 — the map-layer arc, and an audit of how often I was the defect

For a fresh context. Supersedes the 08-12 handoff's status lines; that document's *findings* stand.
**26 commits on `dev` today. CI 20 pass / 0 fail. Nothing uncommitted of mine** (the two
`backend/uploads/forecast_cache/*.json` were already modified when the session began).

---

## ✅ CLOSED 2026-08-13 (after this handoff was written) — READ THIS BEFORE THE SECTION BELOW

**The zoom-floor blank is ROOT-CAUSED AND FIXED by the concurrent session, and my `model_lock`
hypothesis is REFUTED.** Their register entry `40b47946`, from an owner-driven live bisect:

> at an ocean pixel, z2, GFS fixed, **water_temp sits at layer idx 5 while the basemap's `water`
> (11) and `water-shadow` (17) render ABOVE it. The field decodes and paints and is then covered
> by the basemap ocean.**

Mechanism: `moveLayer(id,'ocean-mask-fill')` puts the slot at index 6, but the constraint is
**unsatisfiable as arranged** — it must be above basemap water (11) and below `ocean-mask-fill` (6).
⭐⭐ **"It presents as zoom-related ONLY because `styledata` fires on zoom** and slot rotation
re-mounts the slots where they paint, then the re-assert pushes them back down."
Fixes: `e88b0f68`, `f3fe2c85`. Deployed at `172f66aa`. **FIFTH occurrence of one class** in their
ledger (07-11 lakes · 07-11 coast buffer · 07-11 green landuse · 07-17 inland repaints · 08-13
basemap water): weather fields anchored below basemap fills.

⛔ **WHAT I GOT WRONG, AND IT IS THE SAME TRAP A FIFTH TIME.** My z2-vs-z2.99 discriminator was a
REAL measurement (24 entered / 0 decoded vs 45 / 20) and `model_lock` genuinely blocked on the
build then deployed — `06bf431f` fixed a real one-sided normalisation (`getParentModel(folder)`
compared against a raw `lock`). **But zoom was a SYMPTOM, not the variable.** I had documented
"I measured a transient and called it a state" four times in this very document and then did it
again, one layer down: I treated a zoom-correlated reading as a zoom-caused mechanism.
★ **A CORRELATION WITH ZOOM IN THIS UI IS NEARLY WORTHLESS** — `styledata` fires on zoom, so
anything re-mounted or re-asserted on style events will track zoom without being caused by it.

⇒ The section below is kept for the METHOD (the entry-point probe, the controlled discriminator)
and for the audit. **Its "next action" is spent — do not chase `blockedDetail`.**

---

## ⭐ (SUPERSEDED) THE ONE LIVE THREAD

**Every `om://` raster layer renders blank at the map's zoom floor (z2–z3; `minZoom` is 2 on dev
live).** The owner reported it as "fog isn't activating at the two farthest out zooms". It is
**not fog-specific** — water temp blanks there too.

**Measured, controlled (same layer, settled view, cache cleared, one zoom notch apart):**

| zoom | callback ENTERED (`traceOmUrl`) | reached `TILE_TRUTH.protocolCalls` | decoded |
|---|---|---|---|
| 2.99 | 45 | **20** | yes |
| **2.00** | **24** | **0** | **0** |

⇒ The protocol callback is entered and **exits early, before decoding**.

**✅ THE BRANCH IS IDENTIFIED.** Probes shipped (`ba7f1c18`) on the three early returns; the owner
ran them and reported **`blocked: model_lock`** — i.e. `isModelMatch(requestedModelFolder,
activeModelLock)` is false at the floor and every tile gets a transparent fallback.

### ▶ THE NEXT ACTION IS ONE VALUE
```js
window.__OM_URL_TRACE__.blockedDetail      // recorded as `requestedFolder|activeLock`
```
Why it decides the fix — read `isModelMatch` (top of `openMeteoProtocol.js`) first, because it
returns **true** for: empty folder · folder in `window.__OM_ACTIVE_MODELS__` · empty lock ·
**any folder containing `gfs`**. So a GFS layer blocking means the left side is a **non-empty,
non-GFS string**, which is already surprising.

| detail | reading | fix |
|---|---|---|
| a UI model name on the right (`EURO`/`GFS`) vs a CDN folder on the left | two namespaces compared | normalise before comparing |
| left side is not a model folder at all | `pathname.split('/')[2]` breaks for the floor's URL shape | fix the parse, not the lock |
| left side empty | contradicts the matcher — re-read it | — |

⚠️ **Do NOT skip to a fix.** Nine hypotheses died on these layers today (list below); every one
died to a measurement that was available before I guessed.

---

## ✅ SHIPPED AND VERIFIED

- **Water temp was blank on EVERY model — fixed (`0f13fa7d`), owner-confirmed, deployed.**
  Root cause: the layer requests `variable=surface_temperature`; decode produced **4,718,592 real
  values (−53.95…+38.75 °C)**; colourisation found **no scale under that key** among 49 and emitted
  transparent tiles. `LayerRegistry` had moved the DATA to `surface_temperature` (because
  `sea_surface_temperature` is not CDN-hosted) and **the SCALE kept the old name**.
  ⭐⭐ **A lookup miss that returns "nothing to draw" is indistinguishable from "nothing to show."**
  No runtime signal can catch it — everything upstream read healthy because nothing had *failed*.
  ⇒ **Blank render + green upstream ⇒ diff the NAME KEYS first** (variable/scale/palette/layer id).
  Verified in **two** environments; `aliasIsSameObject: true` proves it aliases rather than copies.
- **Colour-scale class guard** (`2dd8f1ff`, extended `6bef6eda`) — every raster **and marine**
  layer's variable must resolve to a scale. Mutation-proven: remove the alias and it reports
  `water_temp -> surface_temperature`. Marine matters because those render through the raster path
  when `webglMarineFailed` — a blank that only appears where WebGL is unavailable.
  ⚠️ **It false-positived on its first run** (`temperature -> temperature_2m`, a layer that renders
  fine). The library strips **level suffixes** before lookup (`LEVEL_REGEX`), so `temperature_2m` →
  `temperature` resolves while `surface_temperature` reduces to nothing. The rule is now calibrated
  against those two observed outcomes with a control test pinning both.
- **`omUrlTrace.js`** (`82005e35`) + **`traceOmBlock`** (`ba7f1c18`) — the only non-second-hand view
  of this path (`__RASTER_PROBE__` never fires here, fetches are off-thread so they miss the network
  log, `getStyle()` reports `tiles: []` for sources that ARE serving). **Today's finding is only
  visible because of it:** without an entry-point probe, "24 entered / 0 decoded" reads as "nothing
  was requested" — which I concluded twice before it existed.
- **`launch.json` backend interpreter** (`7b74ae96`) — pointed at the broken Windows python, so the
  local backend never started and the local map had no data for most of the session.
- **CI**: pre-push floor hook (`c40b7fff`, perf `2d2a29cb`, tests `3f19ed70`), floors carried
  correctly, and a warning that `core.hooksPath` would silently disable the LOC guard (`11217c2d`).

**LOC discipline:** `openMeteoProtocol.js` is grandfathered **shrink-only at 943** and is still
exactly 943 — every addition paid for itself (probes folded into existing `return` expressions;
comments condensed with all facts retained).

---

## ⛔ SELF-AUDIT — I WAS THE DEFECT MORE OFTEN THAN THE CODE

**Nine hypotheses died on water temp / fog:** model capability · ocean mask covering ocean ·
`&_cb=` cache-buster · "the cache never hits" · source `bounds` · tile enumeration dropping
columns/rows · RAF cancel-starvation · model selection · react-map-gl not propagating a url change.

**Published before testing (the expensive ones):**

| claim | why it was wrong |
|---|---|
| "only `x=0` is requested" | tile trace read **mid-zoom**; bounds still moving |
| "only `y=3` is requested" | same, again |
| "the disqualified row is an INTERACTION" | my oracle returned `-1` on a REFUSAL and `-1 > 0` scored it as "fine" |
| "1 nulls" in a handoff table | a regex I wrote derived it; its own output said `movers=[1,2,3,4,5]` and I didn't read it |
| "0 of 22 exceed the envelope" | dedup hid 4 of 128 |
| "47% degraded geometry" | sized a population from a sample **I had deliberately biased that morning** |
| "user-facing 503" | I measured the API and called it a user experience; the client never makes that call |

⭐⭐ **FOUR of them were the same shape: I measured a TRANSIENT and called it a state** —
mid-zoom (×2), mid-deploy, mid-style-load. **`styleLoaded: false` with 0 slot sources IS what
initialisation looks like**, and I diagnosed it as failure in two environments; the codebase even
documents a *"measured 2.1s in the isStyleLoaded()-false path"*.
⇒ **Before reading map state, assert it is settled** (`isStyleLoaded()`, a stable zoom/bounds), then
read **once**. For a tile trace: hold the view, clear the trace, toggle the layer, then read.

★ **Other traps worth carrying:** console residue is a confound (a layer desync did not survive a
clean reload) · a guard I wrote nearly reddened CI on a working layer, so **verify a new test's
FAILURE against production before trusting it** · a throwaway script that builds its own copy of
the thing it checks measures the copy (mine missed `CUSTOM_COLOR_SCALES` and reported a false MISS)
· **assert the match count before `str.replace` in an edit script** — that guard prevented four
half-applied edits today.

---

## ⚠️ OPEN, WITH OWNERS

- **Zoom-floor `model_lock`** — mine/next session. One value away (above).
- **Recurring non-attaching map state** — seen 3+ times in 2 environments: `styleLoaded` never
  true, 0 slot sources, layer activation yields 0 protocol calls; clears on its own schedule. It
  **blocks measurement**, and I mistook it for the bug under investigation twice.
- **`SURF_TIDE_DEPTH`** — owner call, now with evidence not a guess: six samples, five nulls; the
  harness proves it can see a 38.1-pt move. Sample 2 (8 rows / 3.2 pts) remains unexplained and
  every hypothesis for it has been tested and failed.
- **Geometry coverage** — **44.0% of 1,052 sampled spots degraded, 17 blind** (Europe/Med 20%,
  N.America 34%, Asia/SE-Asia 64%). ⚠️ Quote as "of 1,052 sampled spots", never "the estate":
  4 of 6 regions hit the endpoint's `limit=200` cap.
- **Blind geometry is undisclosed** — 15 of 17 blind spots report `confidence: medium`, identical
  to full-geometry spots; the only signal is a **missing word** in `why`.
- **Unchanged owner items** — three dark frontend flags · `BRAIN_RULES.md` committed API key ·
  radar legend (needs the external RainViewer scheme-7 spec).

## ▶ IF YOU DO ONE THING

Read `window.__OM_URL_TRACE__.blockedDetail` at the zoom floor and fix whichever side of the
comparison is wrong. It is the last unknown in a bug that blanks **every** weather raster layer at
the two farthest-out zooms, and the instrument to answer it is already deployed.
