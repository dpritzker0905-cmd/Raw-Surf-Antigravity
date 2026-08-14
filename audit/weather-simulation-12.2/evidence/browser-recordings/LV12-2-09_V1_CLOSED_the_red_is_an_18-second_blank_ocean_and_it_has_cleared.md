# LV12.2-09 — VERIFY ITEM V1, CLOSED. The red is an 18-second blank ocean, and it has cleared

**Captured** 2026-08-14 by downloading `zoomlab-nightly-31680258907` (59.6 MB, the RED run, expiring
2026-08-27) **and** `zoomlab-nightly-31781976971` (50.2 MB, the first post-fix run). Both verdicts,
both traces, both videos.

> ## This is the first time in this program's recorded history that anyone has watched its own map fail.
> Six audits disclosed producing zero recordings. The recording existed. Here is what is on it.

---

## 1. What the red actually was

`verdict.json` from run 31680258907 (`7b74ae96`, 2026-08-13T08:01Z):

```
verdict: FAIL   observable: True   framesAnalyzed: 387   waterSamples: 156
transportErrors: 0   instrumentFindings: 0   renderFindings: 22
    21 x MULT0_FRAME     t = 323755 … 341698   (contiguous, ~18 s, one per frame)
     1 x SETTLED_STEP    t = 342591, z = 4.805, dL = −18.1
```

`instrumentFindings: 0` + `observable: true` + `transportErrors: 0` — the harness's own way of
saying **the sea under test was delivered and the renderer WAS graded.** This is not a red meaning
"Render was asleep".

### The mechanism, from the frame trace

| page-time | z | **mult** | **hm** | L | drawCalls | `cells` occupancy |
|---|---|---|---|---|---|---|
| 322534 | 6.144 | 1 | 0.713 | 181.7 | 6 | `1111…1111` (all) |
| **323755** | 6.144 | **0** | **0** | 188.3 | 6 | `1110000011110000011100000111110000111110` |
| 329181 | 5.344 | **0** | **0** | 194.0 | 6 | `0011100011110000011110000011110001111110` |
| 335072 | 5.164 | **0** | **0** | 184.7 | 6 | `1111100011110000011110000011110011111110` |
| 341698 | 4.805 | **0** | **0** | 186.8 | 6 | `1111100011110000111110000011100011111110` |
| **342591** | 4.805 | **1** | **0.686** | **168.7** | 6 | `1111…1111` (all) |

**For ~18 seconds across a zoom-out from z6.14 to z4.81, the marine field's multiplier and heatmap
opacity were both zero**, and the per-column occupancy bitmap was shot through with gaps. The engine
kept drawing — `drawCalls` stayed at 6 the whole time — it just drew nothing. Luminance sat
*elevated* (184–194) because the basemap was showing through unshaded; when the field returned,
luminance dropped **18.1** in one step. That step is the `SETTLED_STEP`.

## 2. What it looks like — the frames

Video: 1280×800, vp8, **8 min 07 s at 25 fps**. Frame time maps as
`video_t = (trace_t + t0)/1000`, `t0 = 25726.8` — confirmed twice against the on-screen zoom readout.

| frame | video t | HUD zoom | trace z | ocean |
|---|---|---|---|---|
| `ZL-RED-01-before-z6.9-field-present.png` | 347 s | 6.94 | ~6.9 | **field present** — visible wave texture off Florida |
| `ZL-RED-02-blank-z5.34-mult0-BLANK-OCEAN.png` | 360 s | **5.34** | 5.344 | ⛔ **BLANK** — flat pale blue, no field at all |
| `ZL-RED-03-recovered-z4.81-settled-step.png` | 369 s | **4.81** | 4.805 | **recovered** — field back, and this is the −18.1 step |

⚠️ **And the HUD lies through the whole blank window.** In the blank frame the Diagnostics HUD reads:

```
Model / Layer : GFS / waves
Render Mode   : Marine
Raster Source : LOADED
TRUTH VIOLATIONS: No Causal Layer Violations Detected
```

The application believes it is rendering the marine field. **Nothing is on the water.** An
18-second, user-visible blank ocean passed the truth layer without a single violation — which is a
new instance of this program's signature defect class, this time inside the instrument built to
catch it. It is not covered by WS-CAN-0010/0063 (those were surfaces reporting an *unmeasured*
number; this one measures and reports "LOADED" while `mult` is 0).

## 3. The red has CLEARED

`zoomlab-nightly-31781976971` (`dd6a8126`, 2026-08-14T07:57Z) — the first nightly after the fixes:

| | RED `7b74ae96` | GREEN `dd6a8126` |
|---|---|---|
| verdict | FAIL | FAIL |
| **observable** | true | true |
| framesAnalyzed | 387 | **434** |
| instrumentFindings | 0 | 0 |
| **renderFindings** | **22** | **1** |
| by type | 21 `MULT0_FRAME`, 1 `SETTLED_STEP` | 1 `DEAD_BAND_TRANSIENT` (cols 13–15, 4 frames) |
| CI outcome | **OVER BUDGET → red** | WITHIN BUDGET → green |

**Both budget-serious classes are at zero.** No `SETTLED_STEP`, no `DEAD_BAND_PERSISTENT`, and the
21-frame `MULT0` run is gone.

### `verdict: FAIL` on a green workflow is BY DESIGN, not a defect

Worth stating because it looks alarming: the verdict binary prints `FAIL` for **any** finding, while
the CI step's budget (*≤2 findings, 0 persistent, 0 settled*) is the authority. `marine-nightly.yml`
documents this in-line: *"The verdict binary prints '[verdict] FAIL' for ANY finding; the budget is
the CI authority."* One short water transient is allowed to ride. **Do not "fix" this.**

## 4. ⚠️ What this does NOT establish

- **Causation is not isolated.** n = 1 before, n = 1 after. Between them sit `f3fe2c85` (the
  ocean-mask layer-order fix), `181b7ba7`, `69ac3ddb`, `172f66aa` and three commits of my own — **and
  the nightly grades live production data, so the sea state differs between the two runs entirely.**
  The honest claim is *"the red is cleared"*, **not** *"f3fe2c85 cleared it"*.
- **It is probably not WS-CAN-0061.** That defect was `water_temp` buried beneath the basemap ocean
  by the ocean-mask anchor. zoomlab grades the **marine (waves)** field, a different layer. The fix
  touched `OceanMask.js`, which the marine engine also consumes, so an effect is plausible — but
  nothing here demonstrates it.
- **One green is not a trend.** The lane has failed 18 of its last 38 runs. Two consecutive
  post-fix greens would be the minimum before treating this as settled.

## 5. Disposition

| item | disposition |
|---|---|
| **V1** | ✅ **CLOSED.** The red was real, graded, and is now cleared |
| **K1** in `OPEN_KNOWN_UNKNOWNS.md` | ✅ **ANSWERED** — findings went 22 → 1; both serious classes at zero |
| `WS-CAN-0067` (register the harness) | **STILL OPEN and now better justified.** This instrument caught an 18-second user-visible blank the truth layer declared clean, and it has 0 register presence |
| The HUD reporting `LOADED` / no violations through an 18 s blank | **NEW** — belongs with WS-OBJ-506 as a fourth measure-or-refuse site, and it is a *different* mechanism from the three already closed |
| Watch the next 2 nightlies | one green is not a trend on a lane that fails ~47% of the time |
