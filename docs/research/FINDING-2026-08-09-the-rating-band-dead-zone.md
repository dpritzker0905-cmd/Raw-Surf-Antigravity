# The rating-band DEAD ZONE: a rated grid painted at alpha zero (spans 9.5°–40°)

**Found** 2026-08-09 during the queue-E#1 forensic sweep (band vs glyph colour).
**Status** CONFIRMED in source, pinned by tests, **NOT re-tuned — owner call.**
**Code** `frontend/src/components/map/marineEngineDecisions.js` → `resolveRatingBandFade`
**Tests** `WebGLMarineEngine.ratingBandFade.test.js` → the `DEAD ZONE` describe block
**Class** *a threshold outlives the calibration of its input* (2026-08-08)

## The defect in one sentence
Across viewport longitude spans **9.5°–40°** the backend resolves, computes and ships a **fully
rated** grid, and the frontend multiplies its opacity by **zero** — so the user sees the honest
height wash where quality data exists and was paid for.

## How the two halves drifted apart
`resolveRatingBandFade`'s span window ends at `HI = 9.5°`. Its own spec comment derives that number
from the tier handoff:

> the band's last rated tier is the clipped global_mid, which the resolver stops serving once the
> padded request span exceeds `MARINE_MID_RES_MAX_SPAN` (15°); the next commit is the unrated 10°
> global (surf transform skipped: coarse_extent) and `ratingMode` drops.

Every clause of that premise has since changed, in the same week the fade shipped:

| date | change | file |
|---|---|---|
| 2026-07-12 | fade ships; `HI = 9.5°` derived from a **15°** ceiling | `marineEngineDecisions.js` |
| 2026-07-12 | backend flips to **RATING the mid-res tier** so the band "should show SOME rating at overview zooms rather than vanish" | `grid_resolver_surf.py:66-71` |
| 2026-07-22 | `MARINE_MID_RES_MAX_SPAN` **15 → 40** ("TS Bertha vanishes on zoom-out to z5.35") | `mid_res_tier.py:116-143` |
| 2026-07-23 | **40 → 400** ("Bertha STILL clears further out") — the 2° field is now the base at *every* zoom | `mid_res_tier.py:116-143` |

So the rated tier no longer ends at 15°. What actually ends the rating today is the backend's
**span ≥ 350°** skip (`grid_resolver_surf.py:72`), reached only because the frontend globalizes past
its own 40° ceiling (`__RAW_MARINE_GLOBAL_SPAN__`).

Three regimes result:

- **span < 9.5°** — band fades in as designed. Correct.
- **span 9.5°–40°** — ⛔ **DEAD ZONE.** `ratingMode` is true, the grid carries quality, `bandMult`
  is 0.0 and `washStrength` is 1.0.
- **span > 40°** — globalized → served span ~360 ≥ 350 → genuinely unrated. A zero band is the
  honest answer here, so the fade's *intent* is still right. **Only its endpoint is stale.**

## Why it was invisible
It reads as correct behaviour from either side alone. The backend log says "rated"; the frontend
telemetry says "faded"; no test spanned both. It also *masks* queue E#1 — the band-vs-glyph colour
disagreement can't be observed in the dead zone, because the band isn't drawn, which is part of why
the owner saw "agreement at wider zooms".

## The fix is one value, and it is already a lever
`__RAW_RATING_SPAN_FADE_HI__` moves the window without a code change. Pinned by test:
`HI = 40.0` restores the band across the dead zone (`bandMult > 0.3` at span 20) while keeping the
band gone at the globalize boundary (`≈0` at 39.9).

**Why this was not just done:** it is a visible product change across a 4× span range, painting
quality over ~2° cells — precisely the "blocky world-zoom rating band isn't the experience"
objection the original spec raised. The 2026-07-12 backend flip argues the other way. That is a
product judgement, and the honest close is an owner look plus a zoomlab trace, not a code reading.

**Recommended experiment:** set `__RAW_RATING_SPAN_FADE_HI__ = 40` in a session, sweep z5→z12 over a
coastline with live swell, and decide whether 2°-cell quality at overview zoom reads as information
or as blocks. If it reads as blocks, the alternative is to move the *backend* skip up to meet the
fade (rate only what the fade will actually show) — which at least makes the two halves agree
instead of paying for a computation nobody sees.

## Pinned, deliberately, as known-defective
The three tests in the `DEAD ZONE` describe block assert **what ships today, not what is right**,
the same way the census pins its two honest refusals. When the owner re-tunes `HI`, that block must
be rewritten in the same commit — it exists so the re-tune is a deliberate act with a visible diff,
and so nobody re-derives this from scratch a third time.
