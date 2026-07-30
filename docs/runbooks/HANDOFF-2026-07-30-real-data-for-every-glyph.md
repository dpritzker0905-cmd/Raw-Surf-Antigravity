# HANDOFF 2026-07-30 — real data for every glyph and every pinned spot

**Read this, then `docs/research/STUDY-2026-07-30-building-our-own-wave-history.md`, then the two
research docs in §6. Everything below was measured, not reasoned.**

---

## 0. THE GOAL, stated once

Every glyph on the map and every pinned nearshore spot — including ones created tomorrow — should
show a **surf height a local would agree with** and a **quality score that means the same thing at
Sebastian Inlet as at Pipeline**. Not a plausible number. A right one, with provenance.

Surfline reaches this with 35 years of surf reports and 20 years of camera streams retraining a
model daily. We cannot buy that. The strategy is to build a **longer record from public data** and
be honest about which parts of it are truth.

---

## 1. ⛔ THE FIVE THINGS THAT WILL BITE A FRESH CONTEXT

1. **NEVER flip `SURF_HEIGHT_H110` alone.** Two measured errors cancel: no-refraction (`Kr=0.797`
   measured vs CDIP) makes us **+25.5% high**, emitting Hs instead of H1/10 makes us **−21.3% low**,
   net **0.988× = accidentally right**. H1/10 alone ⇒ +25.5% too high. Kr alone ⇒ −21.3% too low.
   **Both or neither.** Test-guarded; the audit prints the coupling.
2. **A near-zero aggregate bias is the trap.** Our offshore input compresses: **+0.355 m** at
   0–0.5 m, **−0.363 m** at 2.5–10 m, and the aggregate **+0.107 m** hides all of it. Always
   stratify on the OBSERVED value.
3. **`n` is rows, `n_buoys` is independence.** 87 rows from 8 buoys is 8 samples. Fitting a quantile
   map on that invents big-wave behaviour rather than correcting it.
4. **A flag has a value PER LANE.** `RATING_TIDE` was `'1'` in both ingest workflows and UNSET on
   Render for 11 days. Three lanes: `precompute.yml`, `forecast-ingest.yml`, Render env.
   `surf_science_audit.py --render` reads all three. `test_flag_lane_parity.py` fails on drift.
5. **GitHub Actions runs the workflow file from the CHECKED-OUT SHA.** A run in flight predates your
   flip and looks exactly like a silent failure — and the gate wiring does have a broad `except`
   that skips on error. Check `gh run list --json headSha` before diagnosing.

---

## 2. WHERE THE PRODUCT ACTUALLY IS

**Live now**
- `RATING_OBS_GATE = 1` in all three lanes (`04a203ce`). The model no longer awards Good/Epic on its
  own — it caps at 69.9 `fair_good` (Surfline's model ceiling) unless **≥2 of GFS/EURO/ICON agree**
  or a fresh ≥4★ report confirms. **Production-verified: 10,638/10,638 entries gated, 0 ceiling
  violations, 260 capped, 740 of 933 would-be good/epic survive (79%), nothing at or below `fair`
  moved.**
- Accent/apostrophe-insensitive spot resolution (`0d102e91`) — 127 of 1,773 names (7.2%) were
  unreachable by their natural spelling.
- Hourly trevec index GC (`793ea8b0`) — the index had reached 437 GB over 0.46 GB of data.

**Built, measured, deliberately OFF**
- `RATING_LOCAL_SIZE` — go/no-go now reads **SANE** after fixing two defects in the reference
  (`e3aedb06`). Flipping moves **41.1% of levels, 4,177 down vs 192 up**. Correct but large; ship it
  separately from the gate so the two can be judged apart.
- `SURF_HEIGHT_H110` — see §1.1. Blocked on Kr.
- `SURF_PARTITIONS` — height half wired, rating half dark.

**Open**
- `RATING_TIDE` lane split (ingest 1 / serve 0). A decision, not work — but `normalize_tide` divides
  out the spring–neap amplitude, so check the factor before choosing a direction.
- EURO blank-day cadence bug.

---

## 3. THE CENTRAL INSIGHT OF THIS SESSION

★★★ **The product compresses TWICE, independently, and the two were found by separate
investigations that did not know about each other.**

    RATING side:  size_score saturates      -> 4 / 6 / 8 / 10 / 12 ft all score 84.0, identically
    HEIGHT side:  the offshore input        -> small seas read big, big seas read small

Same defect shape, two layers. `RATING_LOCAL_SIZE` fixes the first. Quantile mapping fixes the
second. **They are independent and can proceed in parallel** — but see §4 for the ordering that
matters.

---

## 4. THE STRATEGY, in dependency order

**Phase 1 — fix the height DISTRIBUTION (the uncancelled error).**
Fit empirical quantile mapping on the three bands that have real independence today (0.5–1.0 m: 38
buoys; 1.0–1.5: 46; 1.5–2.5: 33). Leave 0–0.5 (13) and 2.5–10 (8) on the identity map. Gate behind
`HEIGHT_QUANTILE_MAP=0`; report MAE **per band**, never aggregate. Use **EGQM** (Gumbel-tailed) when
the tails are attacked, because an empirical tail cannot be fitted from 8 buoys.

**Phase 2 — replace the size climatology with 85 years of ERA5.**
`RATING_LOCAL_SIZE`'s reference currently comes from a blob accumulating **our own forecasts for
~2 days**. ERA5 gives the same quantity from **1940→present hourly at every spot**. It also kills the
cold-start problem: a NEW pin gets a real reference immediately instead of waiting weeks.
⚠️ ERA5 is CLIMATE, not truth — it shares our compression (underestimates extremes by up to 30%,
bias −0.058 m overall against NDBC, which is the same misleading near-zero). Use it for the
distribution SHAPE that a percentile reads, never to correct a tail.

**Phase 3 — flip `RATING_LOCAL_SIZE`.** After Phase 1, so a local reference is not amplifying a
compressed input.

**Phase 4 — Kr + H1/10 together.** Kr must be a **directional per-site transfer function**; measured,
it swings **1.75× at a single site** with swell direction, and both a scalar Kr and a Snell-law Kr
were measured to be the wrong shape. CDIP's own MOP system computes exactly this.

**Phase 5 — the feedback loop, which is the real long-term answer.**
`REPORT_CALIBRATION` writes snapshots to L2 and **nothing reads them back**. Every constant in the
engine is a guess validated once instead of a number that improves. This is now a *dependency*, not
a luxury: the observation gate withholds Good/Epic without confirmation, and reports are the human
half of that confirmation — currently only model-agreement carries it.

★ **Retain our own forecast↔observation pairs permanently, starting now.** That is Surfline's 35
years, built forward. Every day not retained cannot be recovered.

---

## 5. WHAT TO BUILD FIRST — three scripts, in order

1. `scripts/fit_quantile_map.py` — EQM on the fittable bands, identity elsewhere, versioned
   coefficient blob, per-band before/after.
2. `scripts/era5_spot_climatology.py` — per-spot climatology for all 1,773 spots from ERA5. Replaces
   the 2-day blob and fixes cold-start for every future pin.
3. `scripts/backfill_ndbc_history.py` — NDBC yearly archives (verified: 1980 file → HTTP 200) paired
   against ERA5 hours, published as a tail-shape PRIOR only. ⚠️ Pairing NDBC↔ERA5 measures *ERA5's*
   bias, not ours. Never use it as the correction for our feeds.

---

## 6. THE INSTRUMENTS THAT ALREADY EXIST — use them, do not rebuild

| tool | what it answers |
|---|---|
| `scripts/surf_science_audit.py [--render]` | what is true right now: flags per lane, owner anchors, dynamic range, statistic, vetoes. Offline+credential-free by default. |
| `scripts/local_size_gonogo.py` | the `RATING_LOCAL_SIZE` go/no-go, no admin JWT — uses `RENDER_API_KEY` from `backend/.env`. Prints a percentile sweep on a NO-GO. |
| `scripts/validate_nearshore_transform.py` | the Kr measurement against CDIP. Neither side is our model. |
| `scripts/calibration_solver.py` | solves the owner's anchors as a constraint system. |
| `scripts/validate_period_vs_ndbc.py` | period bias, 18 buoys. |
| `tests/test_flag_lane_parity.py` | lane drift fails the build. |

**Docs:** `docs/research/STUDY-2026-07-30-building-our-own-wave-history.md` (sources, access,
method) · `HEIGHT-ACCURACY-two-errors-that-cancel-2026-07-30.md` (the cancellation) ·
`STATE-OF-THE-ART-surf-rating-2026-07-30.md` (why the gate went first).

---

## 7. METHOD NOTES EARNED THE HARD WAY THIS SESSION

1. ★★★ **Double-check before flipping, not after.** The obs-gate flip was one command away when the
   check found its cross-model join required an EXACT `valid_time` — and the models do not share one
   (GFS 15/18, EURO+ICON 13/16, **and it drifts run to run**). It was capping **59.9%** of good/epic
   for want of a peer frame rather than for disagreement. **Absence of a peer is not evidence of
   disagreement.**
2. ★★ **Two points are a lead, not a finding.** Feeding the measured Waimea buoy through our own
   transform implies an input **1.73×** the buoy (Mavericks 1.82×) — far more than the band bias
   explains. But the buoy reading was 2.5 h older than the forecast valid time. The 1,913-row archive
   is the measurement; this is the next thing to check, **not** something to act on.
3. ★★ **A guard that has never been red is decoration.** Every guard added this session was verified
   by re-enacting the real defect.
4. ★ **Verify the source, never recall it.** Every dataset in the study was fetched and its HTTP
   status recorded, because coordinates and endpoints recalled from memory have been wrong in this
   repo repeatedly.
5. ★ **`df -h` first.** A full disk masqueraded as 96 flaky tests and as an empty log, costing two
   investigations.
