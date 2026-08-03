# AUDIT 2026-08-03 (E) — auditing this session's own work

**Scope:** every claim made in session `659a8456` (commits `d095ed3a → b7b950f3`), re-tested
adversarially. **Method:** re-measure at larger n, on a different frame, and check each instrument
against the rule it claims to measure. **Three independent tests**, per the owner's instruction.

**Headline: 2 of 6 load-bearing claims were WRONG, 1 was RIGHT FOR THE WRONG REASON, 3 held.**
The two wrong ones were both mine and both had the same shape — **generalising from a 200-spot
sample of a 1,773-spot catalogue.**

---

## §0 THE THREE TESTS

| | test 1 | test 2 | test 3 |
|---|---|---|---|
| scope | global bbox, n=200 | union of 8 viewports, **n=979** | union of 8 viewports, **n=979** |
| served frame | 17:00Z | 17:00Z | **16:00Z** (independent) |
| `size_gate` share | 39.0% | 39.1% | **39.1%** |
| `swell_exposure` share | 39.5% | 33.2% | 31.4% |
| `wind_period_blend` share | 21.0% | 27.4% | 28.9% |
| at the 0.10 floor | **24.0%** | 18.6% | 17.4% |
| score p50 / max | 13.8 / 69.9 | 19.9 / 69.9 | 20.1 / **69.9** |
| **`n_good` (≥70)** | **0** | **0** | **0** |

⇒ **At n=979 the numbers are stable across frames. At n=200 they are not.** The instability was
**sample size and viewport, never the frame.**

---

## §1 ⛔ WRONG — "the limiter histogram attributes the ceiling"

`/spot-ratings` hard-caps at `limit=200` against ~1,773 spots, so every histogram published so far
is an ~11% sample **selected by viewport**. Regional histograms diverge violently:

| region | swell_exp | size_gate | wind_period | @floor |
|---|---|---|---|---|
| EUR-ATL | 22.0% | 36.5% | **40.5%** | 15.5% |
| NAM-E | 30.5% | 21.0% | **48.0%** | 14.0% |
| AFR | 29.0% | **67.7%** | 3.2% | 9.7% |
| OCE | **45.5%** | 34.1% | 20.5% | 25.0% |
| LATAM-PAC | 31.4% | **62.7%** | 5.9% | 17.0% |

**A concurrent session and I measured the same quantity and disagreed** (theirs: `size_gate` 46.5%
/ `swell_exposure` 31.0%; mine: `swell_exposure` 39.5% / `size_gate` 39.0%). **Neither was wrong;
both were viewport samples quoted as global facts.**
⇒ **STANDING: quote a limiter histogram with its scope and n, or do not quote it.** The union
figure (n=979, 55% of catalogue) is `size_gate` **39.1%** · `swell_exposure` **32%** ·
`wind_period_blend` **28%**, floored **~18%**.

## §2 ⛔ WRONG — "35 of 48 floored spots have `full` geometry ⇒ not the degraded-normal story"

The **conclusion** is right; **the evidence I gave for it was noise.** At n=979:

| readiness | floored (17:00Z) | floored (16:00Z) |
|---|---|---|
| `full` | 109/574 = **19.0%** | 99/574 = **17.2%** |
| `degraded` | 73/404 = **18.1%** | 71/404 = **17.6%** |

**Indistinguishable.** Geometry readiness has *no* association with being floored — which supports
"not the degraded story" far better than my n=48 split did. I had also read a *direction* into that
split (full floored more often); at n=979 that direction does not exist.

## §3 ⚠️ RIGHT FOR THE WRONG REASON — "CONFIRMABLE = 0"

The count is correct and replicates. **The instrument was not.** `cross_model_spread_census.py`
voided unless all three models served an **identical** `served_valid_time` — but production's
`apply_gate_to_frames` joins on the **nearest frame within `CONFIRM_TIME_TOLERANCE_H = 3.0`**,
precisely because the models land on different hours (GFS 15/18, EURO+ICON 13/16). **An instrument
stricter than the rule it measures can only under-count agreement.**
Re-measured under the production join (GFS 16:00Z, ICON+EURO 17:00Z, span 1.0 h): **CONFIRMABLE
still 0.** Fixed in `b7b950f3`; the response now publishes `served_frames_by_model` and
`frame_span_h`. ★ **A number that survives a method fix by luck is not evidence the method was sound.**

## §4 ✅ HELD — the ERA5 guard defect and its fix

`_another_instance_pid` matched the shell that launched it. Proven by direct call, mutation-tested
(4 mutants / 6 cases / **0 survivors**), and the lane then ran end-to-end: **139,016 samples/spot,
~78 s/spot**. Regression check: **298 passed, 1 skipped** across the rating/climatology/observation
suites. Nothing here needed revision.

## §5 ✅ HELD — the swell_exposure floor is real, and its cause is still OPEN

`swell_exposure` returns exactly `0.10` for an entire half-plane (Δθ ≥ 90°); **56.0% of all
`swell_exposure`-limited spots sit on that floor** (n=979). What is *not* established is that the
floor is WRONG — the 47-year probe found Arugam's best decile only **0.7%** floored (control
Hossegor 0.0%), refuting my "wrapped swell" explanation. **Measured: yes. Attributed: no.**

⚠️ One nuance the audit added: `size_gate` winning argmin is largely **honest** — **78.3% of
`size_gate`-limited spots sit below the 0.60 typical-day anchor**, i.e. the surf really is smaller
than typical there. But `wind_period_blend` **never exceeds 0.789 across 268 spots**, so it wins
partly *by construction* (`blend = 0.6·wq + 0.4·pq` with `pq` floored at 0.40 rarely approaches 1.0,
while six of the nine factors return exactly 1.0 when inert). **Argmin over factors with different
natural ranges ranks design alongside defect.**

## §6 ⛔ THE LEDGER'S OWN CLAIM IS HALF WRONG — "the gate self-resolves; do not fix it"

`gate_self_resolves_probe.py` simulates the conjunction fix as a multiplicative lift `raw' =
min(100, raw·k)` applied equally to all three models — the most generous possible case for
agreement — over 979 spots × 3 models. **Control passes: k=1.0 reproduces the measured 0.**

| k | unlocked (≥2 models ≥70) | withheld by gate (exactly 1) | withheld share |
|---|---|---|---|
| 1.00 | 0 | 4 | 1.00 |
| 1.30 | 19 (1.9%) | 67 | 0.78 |
| **1.40** | **42 (4.3%)** | **80** | **0.66** |
| **1.50** | **61 (6.2%)** | **110** | **0.64** |
| 2.00 | 212 (21.6%) | 169 | 0.44 |

The ledger's own arithmetic puts `good` at **1.38× typical**. **At that operating point the gate
withholds ~2 of every 3 spots that qualify.** Not circular — but not self-resolving. Only past a
**doubling** does the withheld share fall below half.

⭐⭐⭐ **AND THE GATE'S STATISTIC MEASURES THE WRONG THING.** `internal_confirmation` counts
**threshold crossings**, not agreement. At k=1.4 on real served spots:

| | GFS | ICON | EURO | spread | rule says |
|---|---|---|---|---|---|
| Majestics | 100.0 | 72.5 | **5.5** | 94.5 | **GOOD** |
| Inch Beach | 80.4 | 72.5 | **3.4** | 77.0 | **GOOD** |
| Yo-Yos | 68.7 | 67.8 | 68.3 | **1.0** | withheld |
| Echo Beach | 69.4 | 69.9 | 74.6 | 5.2 | withheld |

The gate exists to stop *"single-model over-excitement."* **Majestics with EURO at 5.5 IS
single-model over-excitement, and the rule awards it `good`** — while three models agreeing within
1.0 point get nothing. Counting crossings and measuring agreement coincide only when the spread is
small, which is exactly when the gate is unnecessary.

---

## §7 THE WORK ORDER THIS CHANGES

1. **The conjunction is still first** — a prerequisite, because at k=1.0 nothing qualifies and gate
   work would be invisible. (`_REF_ANCHOR_SCORE = 0.6` caps a typical day at 60; `good` needs 1.38×,
   `epic` 1.90× — arithmetic independently confirmed against `surf_rating.py`.)
2. **The gate is a SECOND project, not a side effect.** Replace "count of models ≥70" with a
   statistic over the model *distribution* (median, or spread-aware). Shipping (1) alone takes the
   product from *"never says good"* to *"says good for 1 spot in 3 that deserves it, and awards it
   to spots where one model says 100 and another says 5.5"* — the same conditions reading
   differently depending on which model the user selected, which
   `apply_gate_to_frames`' own comment already names as the failure to avoid.
3. **The 24% floor stays OPEN until the probe runs over a sample of floored spots** —
   `floored_top_decile_frac` is the discriminator, ~78 s/spot.

## §8 PROCESS — what actually caught things

| caught by | count |
|---|---|
| larger n / different viewport | 2 (§1, §2) |
| checking the instrument against the rule it measures | 1 (§3) |
| a control that could exonerate | 1 (the Arugam refutation) |
| a mutation harness | 1 (my own guard fix) |
| review / green suite | **0** |

⭐ **Every correction came from a measurement, none from reading the code again.** The two wrong
claims shared one shape — **generalising from n=200 of 1,773** — and neither felt uncertain when
written. ⇒ **STANDING: before quoting a share, state what fraction of the population it covers.**
