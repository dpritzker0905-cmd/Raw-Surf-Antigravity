# HANDOFF 2026-07-29 NIGHT — the instrument, the pin that never syncs, and Florida's tides

**Continues `HANDOFF-2026-07-29-EVE-the-oversize-gate-and-the-windsea-measurement.md`.**
Read [[standing-work-rules-user-mandate]] first.

Owner's brief: *"the science to work so well that when we pin a new surf spot, the forecast and surf
report data automatically sync up with the logic."*

**Branch `dev`, tree clean.** Backend **1277 passed** (1 pre-existing unrelated failure), frontend
**1542 passed / 171 suites**, LOC ratchet green.

| commit | what |
|---|---|
| `c2084874` | `validate_nearshore_transform.py` — the first instrument that scores the transform's OUTPUT |
| `e5546fa5` | horizon blocking explains the DIRECTION of Kr, not its SIZE |
| `dd1915bd` | the friction term could delete 99.6% of a wave |
| `b9595de6` | spectral per-partition transform (science landed, data not wired) |
| `f76f8f36` | 2-second ripples scored 76 "good" — the third additive-floor veto |
| `9b808d05` | the spot hub had opted out of per-spot capacity + `spot_geometry_readiness.py` |
| `5394947b` | **98.3% of spots were served Port Canaveral, Florida tides** |

---

## 1. ★★★ THE ANSWER TO THE OWNER'S QUESTION: NO, AND HERE IS THE ONE REASON

A 12-agent audit (1.88M tokens) plus hand verification established that **everything in the chain
already auto-syncs on a new pin except ONE input**. Spot membership, the marine/wind points, the
precompute (reads the LIVE spot list via PostgREST every run) and the hub (computes live per
request) all follow a new pin already.

**The exception is fine per-coordinate geometry — the shore normal and `break_depth_m` — which lives
only in `data/shore_normals.json`, a git-committed artifact rebuilt by a `workflow_dispatch`-ONLY
GitHub workflow.** Its own header says *"RE-RUN THIS whenever spots are added, moved, or re-placed."*

⇒ **The sync between "a spot exists" and "the spot has geometry" is a human remembering to click a
button in GitHub Actions.**

### Measured cost of a fresh pin (1,360 spots × 8 swell directions = 10,880 evals, full chain)
| | |
|---|---|
| shore-normal error inherited | median **22.3°**, p90 **81.4°**, max **179.4°** |
| spots off by more than 45° | **26.6%** — swell judged against the wrong-facing coast |
| served height off by >25% | 16.0% of evaluations |
| **RATING LEVEL CHANGES** | **45.8% of evaluations, median jump 2 levels** (max 6 of 7) |
| depth-limited breaking cap | **lost at 78.4% of spots** |

★★ **Virginity is the DEFAULT, not an edge case.** 69.6% of catalogued spots have BOTH along-shore
neighbours outside the 1.0 km `MATCH_RADIUS_KM`, and median asset nearest-neighbour spacing is
3.04 km — so pinning a second peak one beach down the sand is enough to lose the geometry. Live
coverage today is **1,360 of 1,773 (76.7%)**; 39.9% have no break depth at all.

### ⚠️⚠️ TWO PLAUSIBLE FIXES I TESTED AND REJECTED — do not re-try them
1. **"Suppress the bad coarse normal."** WRONG, by a lot. Scored against the fine normal as truth,
   the coarse bearing has a mean LEVEL error of **1.04** versus **4.12** for `None` (68% median
   height error), because a `None` normal **disables the directional gate entirely** and every swell
   then scores as head-on. ★ A wrong bearing is bad; **no bearing is far worse.** Keep the fallback.
2. **"The asset is just stale — re-run the build."** WRONG. Of 24 randomly sampled unmatched spots,
   **ZERO were merely missing — every one had been DELIBERATELY REJECTED** by the quality gate: 62%
   `ambiguous_coastline` (genuinely hard geometry), **38% PLACEMENT** (`not_on_open_ocean_inland`,
   `spot_misplaced`, `spot_misplaced_at_sea`). Re-running repairs **none** of the placement group —
   the pin has to move. `accepted()` already returns the precise reason and writes it to a **CI-only
   review CSV that never reaches the product.**

### Feasibility, measured
`build_shore_normals.measure()` takes one `{lat,lng}` and **reproduces the committed asset exactly**
(0.00° and identical break depths on 6 calibration spots — deterministic, so an overlay merges
safely). One NOAA ERDDAP round-trip ≈ **22 s today**, **independent of payload across 34,000×** (the
static ERDDAP index page takes the same 22 s), documented to swing **30×**, and it parallelises fully
(~3.8 s/spot at 6 workers). ⇒ **background job yes, inline on the request path never.**

⛔ Three blockers the adversarial review found, all captured in the spawned task:
APScheduler runs **ON the FastAPI event loop** (would freeze the app ~23 s/tick, up to 279 s);
**nearest-wins lets a new overlay entry displace a correct neighbour** within 1 km; and
`resolve_surf_geometry` resolves the normal and `break_depth` at **two separate sites** — wiring one
leaves the cap dead.

**Shipped now:** `spot_geometry_readiness.py` — the zero-network, zero-DB half. It reads what
`resolve_surf_geometry` already resolved and answers `full | degraded | blind` with the measured
impact of each missing input. Safe on the request path. It deliberately **cannot** say *why* a spot
is unfittable; that needs the ERDDAP fit.

---

## 2. ★★★ THE INSTRUMENT — scoring the transform against instruments, not itself

Every accuracy loop here validated the model's **INPUT** (`buoy_calibration.py` = offshore Hs vs
NDBC). **Nothing ever scored the transform's OUTPUT.** `validate_nearshore_transform.py` does:

```
implied_Kr = [Hs(nearshore buoy) / Hs(deep buoy)] / shoaling_coefficient(Tp, near_depth)
```

Neither side is our model. Pairs are **discovered** from the CDIP catalogue, and it independently
rediscovered both pairs the earlier audit used by hand, reproducing that audit's `100p1->153p1`
ratio **0.840** exactly.

**Kr median 0.797, range 0.612–1.031** over **385,651 QC-good swell hours** at 10 California sites.
Kr > 1 is real focusing.

### ⚠️⚠️ It corrected the roadmap TWICE
1. **Snell refraction does not explain it** — predicted Kr spans only 0.907–0.993 and is
   **anti-correlated (r = −0.565)**. A site at near-normal incidence (θ 11.8°, Snell 0.993) measures
   **0.677**. Snell is ≤1 by construction, so it can never reproduce the focusing site.
2. **Horizon blocking explains the DIRECTION, not the SIZE.** Fitting `Kr = A_site·(1 − B·shadow)`
   over the ETOPO grid gives all five sites the correct negative sign (r = −0.61…−0.90) and tracks
   the full 1.75× swing at the focusing site — **but `A`, the direction-independent site offset,
   spans 0.852–1.250 and dominates, while `B` removes a median 13.5%.** The queue called a land-mask
   ray-cast the *"cheap global 80%"*; measured, it buys ~13%.

⇒ Queue item #2 is now **"build a directional transfer function"**, and the offset is unknown at
1,763 of 1,773 spots.

---

## 3. ★★ THE FRICTION TERM COULD DELETE 99.6% OF A WAVE

Found by auditing **my own instrument**: it omitted `shelf_dissipation`, which production applies
first (and in the default Komar path `shoaling_coefficient` is never called at all). Re-measured
including it, **the Kr headline survives unchanged** — Kf is exactly 1.000 at all five California
sites because `shelf_depth_at` returns 424–1210 m there.

But establishing that exposed the term: `shelf_depth_at` spans **p10 24 m → p90 2,389 m**, **47.2%
of spots read >200 m** (friction switched OFF), and the exponential is **unbounded below** at the
other tail — **Salthill Beach (Galway) retained 0.4% of its swell**, permanently flat. The formula
still reproduces its own documented calibration exactly (0.844 vs the stated "~0.85"); the inputs
run outside it. Floored at the docstring's own citation — Ardhuin (2003) ~90% energy loss ⇒
`sqrt(0.10)` = **0.316**. 44 spots (2.5%) change at 16 s, **every one an increase**.

---

## 4. ★★ SPECTRAL COMPOSITION — science landed, data NOT wired

`estimate_surf_partitioned` transforms each swell train on its own period and bearing, then
recombines in **quadrature**. ⚠️ **Not the `swell_1` swap the roadmap assumed** — the partitions do
not always reconcile (at Hossegor `swell_1` 0.664 m **exceeded** the total 0.571 m) and wind sea is
genuinely part of the surf. Keeping every train: Mavericks −21%, Ocean Beach SF −17%, Bondi −41%,
Hossegor −0.5%, versus −38…−105% for a naive swap.

⛔ **Nothing supplies `partitions` yet** — live behaviour is unchanged by design. Wiring costs 2
extra point resolutions per spot and must be costed against **precompute**, never the live lane.

---

## 5. ★★ THE THIRD ADDITIVE-FLOOR VETO, AND FLORIDA'S TIDES

**`period_gate`** — 2-second ripples scored **76.0 "good"** because `period_quality` floors at 0.40
inside `(0.60·wq + 0.40·pq)`. ★ Dropping that floor to 0.0 would *still* leave 60 "fair_good", so
only a multiplicative veto works — the third instance after `wind_gate` and `oversize_gate`, pinned
by a test asserting the additive path could not have worked. Inert at/above 7 s so the Gulf,
Mediterranean, Baltic and Great Lakes are not punished for surfing 5–8 s windswell.

**Tides** — `/tides/{spot_id}` picked from a five-entry, all-Florida region map and defaulted to
**Trident Pier, Port Canaveral FL**. Verified in production: **1,743 of 1,773 spots (98.3%)** across
491 regions took that default. Pipeline, Mavericks, Nazaré and every new pin were served Florida
tide times stamped with their own spot_id. ★ **The correct global source already existed** —
`tide.py`, whose docstring says it *"deliberately sidesteps the NOAA CO-OPS path"* — and was wired
only to the rating. Two tide paths; the wrong one served the product.

Now routed through it, via new pure `tide_extrema` / `tide_trend_at` with a parabolic sub-hour fit.
⚠️ **Collapse trap:** a flat-topped tide wobbles High → shallow Low → High, so the spurious highs are
**not adjacent** — comparing against the previous event never fires. Collapse the **triple**, repeat
until stable. Live: Thurso **10.5 ft** vs Pipeline **2.4 ft**, gaps 6.14–6.50 h against the
semidiurnal 6.21 h.

---

## 6. ⛔ THE QUEUE

1. ★★★ **Auto-resolve geometry for a new pin** (§1) — spawned as a task with all three blockers.
   **The direct answer to the owner's question.**
2. ★★★ **Kr as a directional transfer function** (§2) — the site offset needs a measured or
   MOP-style spectral source; `validate_nearshore_transform.py` is the instrument to score it.
3. ★★★ **Wire `partitions`** (§4) — cost against precompute.
4. ★★ **Depth-dependent height**, then **tide/moon** in the RATING (tide is now correct in the
   endpoint but `tide.py:76-81` still divides out spring–neap).
5. ★★ **Shore normals** — 434 spots with none, and §1 shows re-running repairs only ~62% of them.
6. ★ `SURF_V3_KOMAR=0` is a mislabelled landmine.
7. **NEW** ⚠️ **EURO waves blank day** — user-reported, Sat 2026-08-08 rendered nothing while
   Fri/Sun were fine. Spawned; a one-day hole suggests a horizon-tier step boundary.
8. **NEW** ⚠️ Friction is *inert* at ~46% of the catalogue (§3). May be correct for narrow deep
   shelves, but it is unverified.

### Carried over
`weather_sim_mcp.py` **789/800** — extract before the next change. The MCP server holds the OLD
module until a host restart. `RATING_LOCAL_SIZE` is absent from both workflow env blocks, so the
climatology path is inert. Precomputed frames are authoritative — a new spot is simply absent from
the glyph layer until the next cron write. **No report/calibration loop feeds back into the forecast
at all**, so "sync up" in the model-correction sense does not yet exist anywhere.
`test_media_privacy_contracts.py` fails on `dev`, pre-existing, spawned separately.

### ★ METHOD NOTES
1. ★★ **Audit your own instrument before trusting its headline.** Mine omitted a term production
   applies; the number survived, but only checking proved it.
2. ★★ **A positional call is how a new engine input silently fails to reach a surface** (§ the spot
   hub). Pass every optional factor by NAME.
3. ★ **A regeneration procedure that lives in a chat log is not a procedure** — the 4,320 parity
   goldens went stale and the grid had to be reverse-engineered. Now
   `backend/scripts/gen_rating_parity_goldens.py`.
4. ★ Two hypotheses were killed by measurement before any code was written (§1). Both were plausible
   and both were wrong.
