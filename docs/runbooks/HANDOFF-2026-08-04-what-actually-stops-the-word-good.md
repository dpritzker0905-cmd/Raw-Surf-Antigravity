# HANDOFF — 2026-08-04 · WHAT ACTUALLY STOPS THE PRODUCT SAYING "GOOD"

**Supersedes the exposure-floor thesis entirely.** Everything here is MEASURED. No hypothesis
survives into a recommendation without a number and a control beside it.

---

## §0 THE ANSWER, IN ONE LINE

> ⛔⛔ **CORRECTED 2026-08-04 (later the same day, `scripts/served_good_spotcheck.py`). THE
> UNCONDITIONAL HEADLINE BELOW IS REFUTED: THE PRODUCT DOES SAY "good".** At the 13:00-15:00Z frames
> production served `level: "good"` with `confirmed: "good"` at real spots — **Rock Island 71.0,
> Cloud 9 - Inside 72.0** — read directly off the served objects, not reconstructed. So
> `P(display >= good)` is **~0.2 % (2 of 979), not 0**.
>
> What survives is the CONDITIONAL claim, which is sound arithmetic: **while `confirmed is None`,
> `min(raw, 69.9) < 70.0`, so that spot cannot read good.** What was wrong was generalising a
> single frame (01:00Z, n=600, which genuinely had zero) into an arithmetic impossibility. **Rule 22
> in a document written the same day: the supply of `confirmed` is RARE, not ZERO, and rarity has a
> distribution while impossibility does not.**
>
> ⚠️ The 08-04 01:00Z numbers below are RETAINED because they were correctly measured — but they are
> a property of THAT HOUR. Quote them with the frame or do not quote them.

> **The product cannot say "good" because it caps itself 0.1 points below "good" and nothing
> anywhere supplies the key that lifts the cap.**
> *(unconditional form: REFUTED above; conditional form: stands)*

    GOOD_T          = 70.0     a score >= this displays "good"
    CAP_UNCONFIRMED = 69.9     applied whenever `confirmed is None`

`observation_gate(s, None) = min(s, 69.9)`. **P(display >= "good" | unconfirmed) = 0 exactly.**
Not rare — arithmetically impossible.

### The supply of `confirmed`, measured live (`scripts/confirmation_supply_census.py`)
n = **600 distinct spots**, four basins, one served frame `2026-08-04T01:00:00Z`:

| | |
|---|---|
| `confirmed = None` | **600 / 600 = 100.0 %** |
| display max | **69.9** — exactly the cap, not 69.8, not 70.1 |
| raw >= 70 (*would* read good) | 8 / 600 = **1.3 %**, max raw **90.1** |
| display >= 70 (*does* read good) | **0 / 600 = 0.0 %** |
| levels served | `very_poor` 43 % · `poor` 31 % · `poor_fair` 14 % · `fair` 9.5 % · `fair_good` 2.3 % · **`good` 0 · `epic` 0** |

**The forecast produces good days. The display refuses to show them.**

### Both confirmation sources are empty — measured, not assumed
1. **Model consensus** (`internal_confirmation`: >= 2 of {GFS, ICON, EURO} at >= 70, same spot-hour,
   3 h join tolerance) — **0 of 979** spots carrying all three models.
2. **Human reports** (`report_confirmation`: any report >= 4 stars within 12 h) — live REST fetch:
   **0 spots, 0 reports.**

⇒ In production the gate is not a gate. It is an **unconditional cap at 69.9**.

---

## §1 ⛔⛔ THE SOTA LEDGER'S PREDICTION IS REFUTED

Ledger row #1 says: *"the obs gate is CIRCULAR … it self-resolves once the conjunction is fixed.
**Do not 'fix' the gate.**"* That is a claim about WORK ORDER, and it is wrong.

`scripts/gate_self_resolves_probe.py`, run 2026-08-04, n = **979 spots × 3 models**. It simulates the
conjunction fix as a uniform multiplicative lift `raw' = min(100, raw·k)` — deliberately the most
generous possible case, since a uniform lift preserves inter-model ratios and therefore maximises
agreement:

| k | unlocked (>=2 models good) | **withheld by the gate** (exactly 1) | withheld share |
|---|---|---|---|
| **1.00 — today** | **0 (0.0 %)** | **12** | **1.00** |
| 1.10 | 2 (0.2 %) | 14 | 0.875 |
| 1.30 | 22 (2.2 %) | 60 | 0.732 |
| **1.50** | 109 (11.1 %) | **118** | **0.520** |
| 2.00 | 268 (27.4 %) | 149 | 0.357 |
| 3.00 | 471 (48.1 %) | 154 | 0.246 |

★★★ **The withheld count does not fall toward zero — it stays roughly FLAT (12 → 60 → 118 → 149 →
154) while `unlocked` grows.** The gate levies a near-constant tax of ~150 spots no matter how good
the forecast becomes. At a 50 % uniform lift — an enormous change — **more than half the spots that
have earned "good" are still withheld.**

⇒ **These are TWO SEQUENTIAL PROJECTS, not one.** Landing the accuracy work without touching the
gate ships roughly half of what it looks like it should.

---

## §2 THE SCIENCE — AND IT SAYS THE GATE IS A CATEGORY ERROR

Operational practice (WMO Lead Centre for Wave Forecast Verification, hosted at ECMWF since 2016;
~400 quality-controlled buoys and platforms) uses observations for exactly three things:

1. **Data assimilation** — observations improve the forecast *before* it is issued;
2. **Verification** — observations *score* the forecast afterwards, published separately;
3. **Ensembles** — uncertainty is quantified by *spread*, not by clipping the value.

**Nothing in operational practice withholds a forecast's value pending observational confirmation.**
A forecast is issued at its predicted value with uncertainty attached.

Two further points from the same source:

* The buoy network is **geographically concentrated** — North America, Europe, Brazil, Japan, Korea,
  India, Australia. Any observation-keyed gate systematically penalises every coast without a buoy,
  which for a global surf product is most of the tropics.
* ⭐⭐⭐ **OUR GATE IS NOT OBSERVATION-BASED AT ALL.** The dominant path is `internal_confirmation` —
  **agreement between our own three models.** The field is named `confirmed` and the constant
  `CAP_UNCONFIRMED`, which reads as instrumental confirmation. It is **model consensus**, i.e. a
  three-member ensemble — *used to clip the mean instead of to express spread.* That is the inverse
  of the standard use.
* ★ And it is **self-blocking**: the gate withholds "good" until >= 2 models independently score
  "good". Confirmation is strictly rarer than the event it gates, by construction.

---

## §3 WHAT IS NEXT IN THE QUEUE, AND WHY — JACOBIAN ORDER

Leverage = sensitivity × uncertainty × reachability. Every row measured today.

> ⛔ **RE-RANKED 2026-08-04 (later, `scripts/exposure_flip_census.py`, n=979). THE GATE IS A
> SYMPTOM, NOT THE ROOT.** What the cap withholds is dominated by spots with EXTREME cross-model
> spread, and that extremity is manufactured by the `swell_exposure` cliff: 12.0 % of spots have the
> exposure floor engaged in SOME lanes and not others, and every one of the 8 widest-spread spots in
> the population is such a flip (max spread **85.0**; no non-flip spot exceeds 55.4). Fixing the
> confirmation statistic without fixing the cliff just changes which unstable number gets displayed.
> ⇒ See `HANDOFF-2026-08-04-B-the-exposure-cliff-is-what-the-gate-is-hiding.md`.

### 1. ⭐⭐⭐ THE GATE — the only single change that can move the product from "never" to "sometimes"
**Sensitivity:** turns `P(display >= good) = 0` into `P = 1.3 %` at today's physics, and unlocks the
~150-spot flat tax at every future accuracy level. **Cost:** a decision, not an engineering project.
**Why first:** it is the only item whose payoff does not depend on any other item landing, and it
gates the visible value of everything below it.

⚠️ **This is an OWNER DECISION, not an agent's** — the cap was an explicit owner ruling (#13,
2026-07-31: *the sim and hub answer "what will the app SHOW"*). Three options, in increasing order
of work:
* **(a)** Keep the gate, publish the ensemble spread as CONFIDENCE beside the score, and let the
  forecast display its value — the operational-practice answer, and it aligns with ledger #3's free
  50-member `ifs/waef` stream.
* **(b)** Keep the gate but fix the self-blocking threshold: confirm on *agreement*, not on
  *agreement above the very threshold being withheld*.
* **(c)** Supply the missing key — but note both sources measured **0**, so this is the largest
  project and the least certain.

⛔ **Do not simply raise `CAP_UNCONFIRMED` to 70.0.** That converts "never good" into "every 69.9
spot is good", which is a worse lie in the other direction and is exactly the constant-tuning the
ledger bans.

### 2. THE MEASUREMENT — still the gate on all accuracy work
`69f7b148` added RMSE / de-biased scatter index / correlation / symmetric slope / observed-height
bands. ⛔ **Still owed: depth and exposure stratification of the buoy set** — `fetch_ndbc_station_coords`
returns lat/lng only. Until that exists, §3's accuracy items remain unfalsifiable, exactly as the
master audit said.

### 3. THE PHYSICS CEILING — only **1.3 %** of spot-hours reach raw >= 70
Even with the gate gone, "good" would be rare. This is the accuracy programme: skill score → the
`copernicus` routing decision (3.2× better where it applies, but ⛔ `ecmwf` is WORSE than GFS at
36 % of coverage, so a blind flip helps 64 % and hurts 36 %) → geometry.

### 4. GEOMETRY — a real secondary lever, ~2× what I first credited
Served bearing graded at n=140 against OSM: median **19.6°** (`etopo` 8.7 · `borrowed` 29.0 ·
`coarse` 34.8), precedence chain VALIDATED, asset beats coarse 81 % / 67 %. ⛔ **OPEN and
unattributed: the 15.7 % tail beyond 90°** — the worst cases are disproportionately barrier islands,
where a lagoon shore reverses the OSM truth column just as easily as the asset can be wrong. **Next
step is a two-shores-within-2 km discriminator, not a fix.**

### 5. THE ERA5 CAMPAIGN — running, ~100/1773, ~5 days
Unblocks the empirical per-spot directional exposure, the level ladder as percentiles, and the
learned nearshore transform. Accumulation-gated; nothing to do but let it run.

### ⛔ CLOSED BY MEASUREMENT — do not reopen
* **The exposure floor is not the problem.** Spectral physics (`2d17dc41`): onshore flux at
  Δθ=100° is 0.013 for swell vs a flat 0.100 floor — the floor is too GENEROUS for swell, and the
  "37° past the cutoff" spots are correctly floored. Control: flux → cos(Δθ) exactly as s → ∞.
* **The identical-normal discriminator is void** (`3c89bd2f`): permutation p = 1.000, observed 786
  = null 786 on every shuffle.
* ⚠️ **The owner-anchor harness cannot grade a directional change** — every anchor is head-on; a
  47 % height cut moves all five by exactly 0.0.

---

## §4 TWO THINGS I MEASURED THAT CONTRADICT STANDING DOCUMENTS

1. **SOTA ledger #1** — "the gate self-resolves; do not fix it." Refuted above; the withheld count
   is flat in `k`.
2. **MASTER AUDIT §2b** — "one transient timeout = a 60 s window, the breaker cools down." The
   failure was also cached for 3600 s and the breaker was cleared by the *healthy* leg, so health
   read UP while the answer stayed MISSING. Wrong by 60×; fixed `77f66211`, doc corrected `32cc2ee1`.

★ Both were confident, well-written, and wrong in the same way: a mechanism was described correctly
and its *magnitude* was never measured.

---

## §5 INSTRUMENTS ADDED OR RE-RUN TODAY

| instrument | question it answers |
|---|---|
| `scripts/confirmation_supply_census.py` **(new)** | how often is `confirmed` non-None on the served population, and what is the display ceiling |
| `scripts/gate_self_resolves_probe.py` (re-run) | does the gate self-resolve under a uniform lift — **no** |
| `scripts/directional_exposure_science.py` | what a real directional spectrum delivers vs our single ray |
| `scripts/exposure_floor_margin_probe.py` | how far past the cutoff floored spots sit |
| `scripts/served_shore_normal_review.py` | grades the SERVED bearing, with the permutation control |

All five refuse rather than answer when their preconditions fail, and all five carry a control that
can return "the thing you suspect is fine."
