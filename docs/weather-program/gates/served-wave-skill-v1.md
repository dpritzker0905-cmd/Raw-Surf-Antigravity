# Gate: served-wave-skill-v1
Stamp: 2026-11-22 (research lead; DRAFT for the advisor, pre-registration only. It reads the point archive (`served-wave-verify-v1`, design #1168, build #1177), which has collected nothing yet. No row is read.)
Candidate: the served offshore wave forecast (GFS, EURO and ICON members, as the map draws them), verified against matched NDBC buoys. This gate is the baseline that every later nearshore, period or consensus claim is scored against.
Metric: ONE primary, P1 = the served Hs RMSE skill score against persistence, at the [24,48) h lead bin, Tier B (the 0.25° regional frames, where a box covers the buoy), per model, pooled over regions. SS = 1 - RMSE_served / RMSE_persist (section 3). Reported, not bars: Hs bias and RMSE at every lead bin, Tier A beside Tier B, and Tp and Tm MAE and bias with the period definition named.
Pass threshold: section 5. For a model's P1 to PASS, the lower one-sided 95 % bound of SS must be > 0.
Controls: section 6. A planted +0.25 m Hs bias must lower SS below its unplanted value; a null (served vs served, independent resample) must read SS ≈ 0 difference; a decoder-parity check (the #1168 CI test) must pass on the scored window.
Decision rule: PASS → that model's served Hs at [24,48) h, Tier B, is a verified baseline that later gates may compare against. Every other (tier, lead) is REPORTED, NOT VERIFIED: a later gate that needs one registers its own check. FAIL or INSUFFICIENT → no later gate may cite served skill for that model, lead and tier. Nothing ships or switches from this gate.
Unmeasured items: Tier A as a pass/fail line (reported only); leads beyond 48 h as pass/fail lines (reported only); partitions (reported as indicative); CDIP stations (EXAM-only, reported in a separate table, never pooled); nearshore and surf height (this gate is offshore Hs at buoys).
Served change: none.

## 0. Why one primary, and why persistence (director's SOTA directive, 2026-11-22: one primary metric, Holm, clustered bootstrap, n fixed in advance)
- A verification gate needs a comparator, or "RMSE 0.4 m" means nothing. Persistence is the minimum bar a forecast must clear, and it needs no external data: the archive holds the run's own earliest step.
- [24,48) h is the bin Q9 could not fill (n = 0), and the first bin where a forecast must beat "it will be like now".
- Tier B is primary because it is what surfers read at the coast. Tier A stays the common baseline, reported beside it (#1168 §2a).
- **Second opinions are logged in section 9 before this is final.**

## 1. Data
- Records: the point archive, `purpose = served`, schema `point-archive/1`, per member, as written by #1177's sampler. Truth: the shared NDBC QC (per-field ranges, ±30 min collocation) and the daily truth snapshots.
- **Window:** the first 42 days after the archive's 14-day coverage acceptance (#1168 §8) passes, fixed by that date and logged before any score is read.
- **n fixed in advance:** for each model, P1 needs >= 300 collocated `ok` pairs in [24,48) h Tier B, from >= 10 buoys and >= 20 distinct runs. Below that, the model is INSUFFICIENT, not a fail.

## 2. Persistence reference
- For each (model, run, buoy), persistence is that run's own value at its earliest sampled step (lead ≈ 0-3 h), held for every later valid time.
- This uses the same frame, cell and decoder as the forecast, so pipeline effects cancel.

## 3. Statistic
- RMSE over the window's pairs, per model, at [24,48) h, Tier B.
- SS = 1 - RMSE_served / RMSE_persist, over the same pairs.

## 4. Uncertainty
- **Clustered block bootstrap:** resample whole runs nested in whole days (blocks of 1 day; every buoy and run of a day together), 10,000 replicates, seed 1168.
- **Holm** across the three models (GFS, EURO, ICON): one family, alpha 0.05, one-sided.

## 5. Bar
- PASS: the Holm-adjusted lower one-sided 95 % bound of SS is > 0 (the served forecast beats persistence).
- Reported beside it, not a bar: SS point estimate, RMSE, bias.

## 6. Controls (a failed control voids the gate)
- **Planted bias:** add +0.25 m to every served Hs in a copy. Its SS must fall below the unplanted SS, with the difference's bootstrap interval excluding 0.
- **Null:** the served arm vs itself, under two independent bootstrap streams. The SS difference must cover 0.
- **Parity:** the decoder-parity CI test must pass at the window's decoder version.

## 7. Secondaries (reported, never decide)
- Hs bias and RMSE for every lead bin and both tiers; Tp and Tm MAE and bias by model. The period definition is named (GFS peak; ICON and CMEMS energy period until the peak-period flags ship, gate `peak-period-ship-v1`).
- Per-region and sheltered-vs-exposed strata; partitions as indicative.
- **S-FID, fidelity to the upstream model (added after the second opinions, section 9). GFS only.**
  - Served GFS Hs RMSE minus the RMSE of NOAA's own GFS-Wave at the same buoy, run and lead. Upstream is read from the public NOAA GRIB (`noaa-gfs-bdp-pds`), nearest wet 0.25° cell, by the same cell rule.
  - Reported with its block-bootstrap interval, and labelled "pipeline damage" if the lower bound is > +0.05 m. It never decides this gate.
  - It is what later gates read to know whether a served error comes from the model or from our serving (decode, quantisation, cell choice, fills).
  - EURO and ICON upstream are not read here: their raw fields need the CMEMS credential and the DWD archive.
- **S-CLIM:** SS against a 30-day running buoy climatology, reported, as the weak-reference bracket on the other side of persistence.
- **Other tiers and leads:** each (tier, lead bin) gets the same SS and interval, reported in one table. They are not verified by this gate (decision rule).

## 8. Limits
- Buoys are offshore. This is a floor, not surf truth (#1168 §11).
- One season.
- Persistence is a weak reference at 24-48 h. A PASS says "better than nothing", not "state of the art". Comparing with the upstream raw model and with public references is a later gate.

## 9. Second opinions and decision (logged before freeze)
Asked 2026-11-22 with public context only (the design above and four candidate primaries). The answers are advisory; SubQ figures are model confidence, not statistics.

| Question | SubQ (snap-1.2) | Reflection (Beam-1.0, high) |
|---|---|---|
| Best single primary | A, skill vs persistence (0.64); B, fidelity vs upstream (0.34); C 0.002; D 0.01 | A, skill vs persistence |
| Persistence too weak at 24-48 h? | yes (0.81) | no: Hs is strongly autocorrelated at 24-48 h, so persistence discriminates more than climatology |
| Fidelity as a pre-registered secondary? | yes (0.99) | (not asked) |
| Strongest flaw | (not asked) | the primary covers only Tier B at 24-48 h, so it never validates Tier A or the other leads the gate is meant to baseline |

**Decision (research lead):**
- **Keep A as the ONE primary.** Both opinions pick it, and it needs no external data.
- **Persistence:** the two disagree. Persistence stays the primary's reference, with two brackets reported beside it: climatology below (S-CLIM) and the upstream model above (S-FID, GFS).
- **Fidelity:** added as the pre-registered secondary S-FID, per SubQ's 0.99. It is the stronger reference, but it is GFS-only, so it cannot be the primary across three models.
- **Scope flaw (Reflection), accepted:** the decision rule now says PASS verifies only Tier B at [24,48) h. Every other (tier, lead) is reported, not verified. Adding them as co-primaries would break the director's one-primary rule.
