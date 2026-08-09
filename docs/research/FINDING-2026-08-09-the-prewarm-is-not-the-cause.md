# The prewarm is not the cause — and the harness could not have told us either way

2026-08-09. Owner hypothesis: one unbounded series prewarm explains all three reported symptoms
(admin slow after heavy map navigation, animations clearing during fast pan/zoom, forecast slow to
load after a timeline scrub). Owner asked for it to be **tested before fixing**. It was. The answer
is no, twice — and the third measurement invalidates both tests as attribution.

## Arm 1 — `prewarmMarineSeries` disabled

Kill switch added for the test: `window.__RAW_DISABLE_SERIES_PREWARM__ = true`
(`marineGridSeries.js`, in `prewarmMarineSeries`). A suspected cause you cannot switch off cannot
be measured.

| | ON | OFF |
|---|---|---|
| `grid_series` requests | 63 | **58** |
| total MB | 114.8 | 116.0 |
| panzoom wall-clock | 95s | **138s** |
| scrub wall-clock | 43s | **73s** |

It accounts for **5 of 63** `grid_series` requests, so it is not the traffic driver; and without the
eager warm the work moves **into** the gesture instead of ahead of it, which is exactly what the
function exists to prevent. **Disabling it is a regression, not a fix.**

## Arm 2 — the global warm disabled

`window.__RAW_DISABLE_GLOBAL_SERIES_PREWARM__` (pre-existing) — requests went **63 → 81**, the
opposite of the prediction. Its "no abort signal" is deliberate and documented at its own call site
(`marineController.js`): a best-effort background warm must survive the pan/zoom that would
otherwise cancel it, and it is already `currentPageOnly` + deduped + TTL'd + capped at 2 concurrent.

## ⛔⛔ The measurement that invalidates both arms

The **same configuration**, run twice:

| metric | run A | run B | spread |
|---|---|---|---|
| `grid_series` requests | 47 | 63 | 34% |
| total MB | 129.9 | 114.8 | 13% |
| panzoom | 141s | 95s | **48%** |
| scrub | 82s | 43s | **91%** |
| admin bytes | 9.2 MB | 3.0 MB | **3×** |

**The control condition's variance exceeds every treatment effect measured.** At n=1 per arm this
harness cannot attribute anything on this box.

★★★ **THE LESSON: an instrument was built and used to assign causes before its own noise floor was
measured.** The repeat-the-same-config control is the FIRST control that should run, not the last —
the same family as the trend test whose window was chosen from its own series (see
[[a-threshold-outlives-the-calibration-of-its-input-2026-08-08]] §"a control that could not fail").
Any future perf claim from `live_session_diagnostic.js` must carry repeated runs and a stated noise
floor, or it is a story about scheduling jitter on a shared dev box.

⭐ **The cheaper instrument for the next attempt:** count the specific code-path entries directly
rather than bytes and seconds. The A/B showed counts are far more stable than timings (34% spread vs
91%), and a per-path counter has no scheduling noise at all.

## What still stands

The agents' **code** findings are read from source and do not depend on the noisy timings:
the 900 ms debounce re-armed on every `moveend`; `updateMarineGrid` returning while
`map.isMoving()`; `u_opacity = mult` so a zeroed multiplier removes the animation while the coarse
wash survives (which matches the owner's description exactly); and `reinitParticles` re-seeding on
camera drift, so gesture distance-per-time is its trigger. What is NOT established is which of them
dominates.

## Shipped from this work

Both default-unchanged, no behaviour change:
- `__RAW_DISABLE_SERIES_PREWARM__` — the kill switch above.
- `LSD_FLAGS` on the harness — sets `window` flags PRE-BOOT so a hypothesis can be A/B'd without
  editing code between runs. Editing between runs changes two things at once and makes the
  comparison worthless.

**Not shipped:** any change to prewarm behaviour. The measurement says don't.

## Footnote — how this file came to exist

The kill switch's rationale originally lived as a six-line comment in `marineGridSeries.js` and took
it 796 → 802 LOC, past the 800 ceiling, on a file that is not grandfathered. It was pushed red
because the verdict line of `loc_ratchet.py` was cut off by a `tail -2` and the separator was read
as success — the identical truncation defect fixed in the calibration-census workflow the same
morning, where `tail -40` hid the failing exemplar. Rationale relocated here per the 08-04 finding
that both prior ratchet regressions were ~90% rationale: **move it, never delete it.**
