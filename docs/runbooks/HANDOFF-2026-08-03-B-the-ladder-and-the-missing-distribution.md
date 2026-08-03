# HANDOFF 2026-08-03 (B) — the ladder is wrong, the fix needs a distribution we do not have wired

**Range:** `ca585099 → e2be3d33` + this. **Read first:** `standing-work-rules-user-mandate.md` ·
`THE-SOTA-LEDGER-…` · `reading-the-marine-diagnostic-rings-2026-08-03.md`.
**Predecessor:** `HANDOFF-2026-08-03-the-consumer-and-the-jacobian.md`.

---

## §0 STATE

Everything shipped is verified live: **`python3 scripts/verify_v7_deploy.py` → 7 pass, 0 fail,
0 skip.** The rating ceiling is now fully attributed. **Three of the four levers are closed by
measurement, and the fourth needs data that exists in the world but is not wired into this repo.**

---

## §1 SHIPPED AND VERIFIED

| commit | what | proof |
|---|---|---|
| `1f5a796f` | antimeridian normalisation · crossing-aware `bboxContains` · series **vector budget** | 20k-input differential = 0 diffs; 4/4 mutations; live A1 **42.6 MB → 8.7–10.7 MB** |
| `6da4c16e` | `rating_factors` + **`limiter`** — the score names its own binding factor | 20k differential = 0 diffs; 5/5 mutations |
| `54304ad8` | **`limiter` reached the wire** — Pydantic was dropping it | 7-field wire-contract suite + a known-failing control; 2/2 mutations |
| `52b27146` | `Date.now()` in a dedup key ran a per-frame diagnostic | 3/3 mutations |
| `96dc9165` | **the ring reader** — reproduces the session's 5 findings from recorded evidence | **9/9 mutations**; BEFORE→5 fails, AFTER→0 |
| `b059ddf1` | removed my own `coverage` field, falsified within the hour | its own live control |

---

## §2 THE RATING CEILING — fully attributed, four levers, three closed

Live, n=200 global, `source=live`: **scores p50 22.0, max 69.9, `good` count 0.**

| lever | verdict | evidence |
|---|---|---|
| **3 — the 0.10 exposure floor** | **REMOVED** | The physics is right where checkable: Backdoor/Laniakea are Oahu N-shore with an **ENE swell 100–108° off-normal** in August. Point-in-polygon over `ne_50m_land.json` (5 land/sea controls passing): **all four normals point seaward, 3/3.** |
| **2 — `_REF_ANCHOR_SCORE`** | **EXHAUSTED** | Owner anchors permit **0.60–0.65 only**; 0.70 breaks *"FL 4 ft @ 9 s is NOT epic"*. And the permitted 0.05 **changes no level in any anchor** — the big days move **+0.0** because size is already saturated. |
| **gate / `CAP_UNCONFIRMED`** | **CIRCULAR — not an independent lever** | Confirmation needs **≥2 of 3 models ≥70**. Measured same spots/hour: **GFS max 40.6, ICON 48.3, EURO 48.0 — zero models above 70.** It resolves itself once scores rise. |
| **4 — offshore wind knee** *(new, owner-prompted)* | **REAL, unshipped** | Research: ideal **3–5 kt**, trouble from **17–22 kt**. Engine's knee is at **4 kt** — inside the ideal band — so it leaves `epic` at **8 kt offshore**. A/B of a research-shaped knee: onshore **byte-identical**, anchors still 10/10. |
| **1 — the conjunction** | **the only structural one left** | `good` needs **1.38× typical AND all eight other factors at exactly 1.0**. |

---

## §3 THE LADDER IS WRONG — and I did not ship the fix

**The published industry ladder has TEN rungs and is a FREQUENCY scale**: each rung is *what fraction
of the waves reach the rung below* (30% → 50% → 70%, three times over), and **EPIC is explicitly
"some of the best surf all year"** — a percentile of that spot's own year.

We ship **seven**. Missing: **FLAT (1), VERY GOOD (8), GOOD–EPIC (9)** — all at the top. `very_good`
appears **nowhere** in backend or frontend. So `epic` (≥84, open-ended) carries three industry tiers
and **the product cannot say "very good"**.

★ **That is the mechanical root of the owner's 2026-07-29 complaint** (*"I wouldn't say 4 ft @ 9 sec
is epic"*): with no VERY GOOD rung, anything better than `good` **had** to be called `epic`.

### ⛔ I BUILT IT, MEASURED IT, AND REVERTED IT

Implemented across all surfaces (`surf_rating.py`, `surfRating.js`, both GPU colormaps; the legend is
data-driven and auto-follows). `epic` had to stay at 84 — the owner's anchors put FL 6–8 ft at 89.3
and 8–10 ft at 87.9 and require both to read `epic` — so `very_good` could only be **bisected out of
`good`**: good [70,77), very_good [77,84).

**The measurement killed it.** A 1.2 m @ 8 s windswell scores **81.3** and would move `good` →
`very_good`. Under the frequency semantic, VERY GOOD = *"most (70%) waves are GOOD"* — an 8-second
windswell is not that. **The bisection inflates an existing case with no principled justification**,
and 77 is a midpoint, not a derivation.

⇒ **My own finding had already said the boundaries "encode no semantic and must be re-derived."
Inserting a rung into an underived ladder just relabels.** Reverted; tree clean; **687 backend tests
green**.

---

## §4 ★★★ THE LINCHPIN — the owner is right, and it unblocks three things at once

> Owner, 2026-08-03: *"our model should also rely on 80 years of data that we collected from public
> sources too."*

**`docs/research/STUDY-2026-07-30-building-our-own-wave-history.md` says ERA5 gives 1940→present,
hourly, at every one of the 1,773 spots — 85 years against Surfline's 35. The study is written. It
is NOT wired in.**

⛔⛔ **AND HERE IS THE DEFECT THAT MATTERS.** `spot_size_climatology.py` computes the per-spot size
reference as a percentile — **of OUR OWN FORECASTS over ~2 days** (the study's own words). That is
**circular**: the "typical day" that normalises the model is defined by the model's own recent
output. Any bias in the model propagates straight into the reference that is supposed to correct for
it, and a 2-day window cannot describe a spot's year at all.

**One dataset closes three open items:**

1. **The ladder boundaries** (§3) — percentiles need a distribution. 85 years gives one per spot.
2. **The size reference** — replaces 2 days of our own forecasts with 85 years of independent
   reanalysis. This is the **dominant limiter at 46.5%** of served spots.
3. **`epic` as rarity** — *"best surf all year"* is only computable against a year.

⚠️⚠️ **ERA5 IS NOT GROUND TRUTH — it under-reads extremes by 30–32%** and the study is explicit that
using it to correct our tails would *launder our own error*. **Its value is COVERAGE (every spot,
every hour, 85 years), not truth at the extremes.** Use it for the *distribution shape*; keep
instruments for truth. Three roles, never conflated: **INSTRUMENTS = truth · ERA5 = climate ·
models = forecast.**

---

## §5 THE FRESH QUEUE

### Tier 1 — the linchpin
1. **Wire ERA5 per-spot climatology.** Pull 85 years at the 1,773 spots; build the per-spot
   distribution; replace the 2-day self-referential reference. **Unblocks §3, the 46.5% limiter, and
   the rarity semantic.** Guard: the new reference must be A/B'd against the owner anchors — they are
   the acceptance test and they already exist.
2. **Then re-derive the bucket boundaries as percentiles**, and only then add `very_good`
   (+ `good_epic`). The implementation is already known-good — see §3 for every surface.

### Tier 2 — independent of the data
3. **The offshore knee** (§2 lever 4). Research-backed, anchors pass, onshore provably untouched.
   **Needs one owner decision: where does the offshore penalty begin?** ~8–10 kt plateau with full
   effect by ~25 kt is the research-faithful shape.
4. **Wire the ring reader into a lane.** Shipped in `96dc9165` and **nothing calls it** — an unread
   consumer is the disease it was built to cure. ~10 lines.
5. **`clamp_resharpen`** — 19 of 34 detaches (56%), the named committer behind the heatmap thrash.

### Tier 3 — known, unchanged
6. Mask rebuild thrash (20 rebuilds, 2048↔4096; **five recorded false fixes — needs eyes on the map**)
   · 7. flavor cache 63% miss · 8. `is_dynamic_viewport_product` threading · 9. the unfound bbox
   inflation rule · 10. **the skill score against instruments** — still the only thing that makes any
   of this falsifiable · 11. the conjunction · 12. v5 F7/F8.

### ⛔ STRUCK — do not re-propose without new evidence
arbiter A/B (`arb_shadow_diverge: 0`) · react-scan (`reactRerenderCounter: 0`) · no-downgrade as the
thrash cause (3 of 32 commits) · bounds-based `coverage` (the MISS inflated *less* than the HITs) ·
`CAP_UNCONFIRMED` as the ceiling (0–1 of 200 capped; circular) · exposure floor as a defect ·
`_REF_ANCHOR_SCORE` as a lever.

---

## §6 PROCESS — the session's own error rate is the signal

**Seven wrong claims, all caught by measurement**, none by review: the encode attribution;
`encodeDupCount` being "blind"; "the guard never fired"; bounds-based coverage; the arbiter's wiring;
`bathymetry.depth_at` as a land test (it scored my **known-good control** as backwards and would have
shipped *"3 of 4 shore normals are reversed"*); and my own clock detector, which was `/\b\d{10,13}\b/`
and **could not match the key that motivated it** because `_` is a word character.

Rules now standing from this: **an event name is not a call site** · **sample state for levels, read
the event ring for occurrences** · **ask the server what it is running, don't feature-detect** ·
**a field is not shipped until a test asserts it survives serialisation** · **the known-good control
is what saves you.**

⚠️ `surf_rating.py` is at **760 LOC against an 800 ceiling** — the next substantial rating change
forces a split first.
