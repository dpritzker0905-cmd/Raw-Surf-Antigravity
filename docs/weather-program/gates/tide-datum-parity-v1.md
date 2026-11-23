# Gate: tide-datum-parity-v1
Stamp: 2026-11-23 02:25Z. This is the DATUM gate (a) of the advisor's split ruling (RULING, gate file, 2026-11-23 02:17Z), adopted by David's typed "Yes, split it" (director session). It is written before its run and before any data from it exists.
Candidate: #1149's datum, the MLLW offset D, judged on the HEIGHTS of our A + D against NOAA CO-OPS MLLW High/Low predictions, at all 26 v1 gauges (D is served everywhere, harbours included). Timing is not judged here; it belongs to gate (b), `gates/tide-parity-v2.md`.
Metric: #1171's signed instrument (`parity_coops.py` v2). TIDAL-BAND variants (`model_tb`, `sheet_tb`: each side's own seasonal constituents removed). Per event, the SIGNED height error (ours − NOAA, m). Per D variant: median |h|, p90 |h|, the per-gauge median |h|, and the median signed error.
Pass threshold: section 3. The advisor's bar: median |h| ≤ 0.03 m AND p90 |h| ≤ 0.08 m AND per-gauge median |h| ≤ 0.10 m at ≥ 24 of 26 AND median signed error within ±0.02 m.
Controls: section 4. A planted D offset (instrument check), and the finder on NOAA's own curve, read for heights.
Decision rule: section 3. The verdict is on the served D. Raw-band heights and all timing figures are reported beside it, never in the verdict. A gauge that is not measured counts as a FAIL of that gauge.
Unmeasured items: section 6. D at spot keys away from gauges (interpolation, the model D at keys), Alaska and the Pacific territories, and leads past 7 days.
Served change: none from this gate. A PASS lets #1149 proceed to the advisor and David. It must be RE-RUN whenever A changes (section 5).

## 1. Disclosure

- **v1** (`tide-mllw-parity-1`, run 45093427404) FAILED the 01:26:12Z bar on per-gauge TIMING (19 of 26). That
  verdict stays on record, as FAIL-TIMING.
- **v1's RAW-band height figures:**
  - median |h|: model D 0.0462 m, sheet D 0.0361 m. Both are ABOVE this gate's 0.03 m.
  - Per gauge, 24 of 26 under 0.10 m for both variants.
  - v1 compared against NOAA predictions that carry NOAA's seasonal SA/SSA, which our A lacks. S_g, frozen before
    v1 was opened, runs −0.004 to +0.087 m. So the tidal-band figures this gate judges are expected to be lower.
    That is an expectation, not a result.
- **Seen before this stamp:** the v1 artifact (all 26 gauges, raw band, unsigned) and S_g. No tidal-band or signed
  height has been computed for any gauge.

## 2. Scope and data

- **Gauges:** v1's 26 (`own_rules.G3T_M`), ALL of them, harbours included. This gate does not use gate (b)'s
  OPEN_COAST split, because D is served at every US point.
- **Instrument:** `parity_coops.py` v2 (#1171): signed per-event rows, p90, and tidal-band variants that remove
  NOAA's SA/SSA (CO-OPS harcon, NOAA convention) from NOAA's events and FES2022b's Sa/Ssa from our A.
- **Window:** 7 days from the run's UTC start day.
- **D variants:**
  - **model:** our 19-year NTDE computation at the gauge. This is the served FIRST source wherever the CI table
    build has filled it.
  - **sheet:** the gauge's CO-OPS datum sheet. This is the served fallback (a sheet within 2 km).

## 3. Bar and decision rule

Per D variant, on the tidal-band heights:

1. median |h| ≤ **0.03 m**;
2. p90 |h| ≤ **0.08 m**;
3. per gauge, median |h| ≤ **0.10 m** at **≥ 24 of 26** gauges (a gauge not measured counts as failing);
4. median SIGNED height error within **±0.02 m**: a bias that D alone could cause.

**The verdict is on the SERVED D.** Both variants are served: model first, and sheet where the model value is
missing. So:
- **PASS** requires the **model** variant to pass all four legs.
- If the **sheet** variant fails while model passes, that is a named **LIMIT** on the gauge-sheet fallback. #1149's
  owner must then show the fallback's reach, or narrow it, before merge.
- If model fails, the gate FAILS.

This treatment of the two served variants is the lane's reading of "verdict on the served one". It is stated here so
the advisor can rule on it before the run.

**Reported beside the verdict, never in it:**
- raw-band heights, per variant and per gauge;
- all timing figures (median, p90, max, signed);
- S_g per gauge;
- each gauge's d_model and d_sheet.

## 4. Controls

- **Planted D offset (instrument check):** re-score one variant with D + 0.05 m. The median signed height error must
  move by +0.05 m, within 0.002 m, and the event times must be unchanged. Otherwise the run is VOID.
- **Finder on NOAA's own curve** (`finder_check.py`, heights): the served event finder, fed NOAA's own hourly curve,
  must reproduce NOAA's event heights with median |h| ≤ 0.01 m at every gauge. Otherwise the event-height measurement
  itself is in question, and the run is VOID.

## 5. Re-run rule (LongCat's D-regression point)

This gate judges D on top of a particular A. D's measured parity is only valid for that A. The gate must be RE-RUN
(new tag, David's word), and its PASS is suspended until the re-run, whenever any of these change:
- the served A: the FES model or version, the constituent list, the long-period term or the `tide_own` build;
- the event finder;
- D's sources, or their order.

A PR that changes any of them must name this gate.

## 6. Unmeasured, named now

- **D at spot keys away from gauges:** the interpolated source, and the model D at keys that are not gauges. The
  leave-one-out study (`research/tide-datum-loo-2026-11-22.json`) covers station sheets only.
- **Alaska and the Pacific territories:** no gauge among the 26.
- **Leads beyond the 7-day window.**

## 7. Run

- A new tag `tide-mllw-parity-datum-1` (matched by `tide-mllw-parity.yml`'s `tide-mllw-parity-*` trigger), after #1171
  is retargeted or merged so the v2 instrument is what runs.
- Starting it is a dispatch and needs David's typed word.
- The result goes to `results/tide-datum-parity-v1.md`, in a later commit than this file.

## 8. Amendment 1 (2026-11-23 02:50Z, before the run and before any data from it): when a gauge counts as MEASURED

Requested by the advisor, through the director, before dispatch.

**Rule:** a gauge is MEASURED for a D variant only if, over the run's window, both of these hold:
- at least **70%** of NOAA's High/Low events at that gauge are matched to one of ours (the same type within the
  instrument's 3 h match window);
- at least **8** events are matched.

Otherwise the gauge is NOT MEASURED for that variant, and **counts as a FAIL** in the per-gauge leg: it is never
dropped from the 26.

**Effect on the per-gauge leg:** "≥ 24 of 26" counts only gauges that are MEASURED AND have median |h| ≤ 0.10 m. A gauge
that is not measured cannot be one of the 24.

**What the aggregate legs use:** median |h|, p90 |h| and the median signed error are computed over the matched events
of the MEASURED gauges only. The events and gauges left out are listed by name.

**Reported per gauge and variant:** NOAA's event count, the matched count, the matched share, and MEASURED or NOT
MEASURED.

**Disclosure:** in v1 (raw band, run 45093427404), Pensacola matched 6 of 14 NOAA events (43%), so under this rule it
would have been NOT MEASURED, and therefore a FAIL. Every other gauge matched all of its events. The rule is not chosen
to help or to hurt any gauge: it is the advisor's proposed rule, stated before the run.

**The verdict is unchanged:** it is on the **model** D variant, the served first source. The sheet variant is judged
and reported, and a sheet failure is a named limit on the fallback (section 3).

## 9. Amendment 2 (2026-11-23 02:58Z, before the run and before any data from it): the two VOID controls, made runnable

**Why.** Before dispatch, this lane checked the instrument on #1171's head (`e427002d7`). Section 4's controls, as
written, could not run:
- the instrument has no planted-D option;
- the finder check (`finder_check.py`) compares event TIMES, not heights.

Under section 4, a control that cannot run would VOID the run. So both controls are restated here, computed from the
run's own artifact and from read-only CO-OPS calls. Neither needs a second CI run, and neither changes the bar.

**1. Planted-D identity (replaces "re-score with D + 0.05 m").** The model and sheet variants use the SAME A and the
same event finder, and differ only by a per-gauge constant D. So, for every MEASURED gauge:
- every NOAA event that both variants matched must have the SAME event time in both, within 0.1 min;
- the signed height error must differ by exactly d_sheet − d_model, within 0.002 m.

This is the planted-offset test, with the offset d_sheet − d_model, which is 0.0–0.13 m at these gauges. Any
violation makes the run VOID. The instrument then responds to D other than as a constant, and its heights cannot
judge D.

**2. Finder heights on NOAA's own curve (restates the finder control).** `finder_check.py` is extended, read-only, to
report HEIGHT errors as well as times: the served event finder, fed NOAA's own hourly MLLW curve, against NOAA's own
High/Low heights, over the run's window, at all 26 gauges.
- If the median |h| exceeds 0.01 m at any MEASURED gauge, the run is VOID. The event-height measurement, not D, would
  then be in question.
- This runs offline after the run completes, before the verdict is read. The extension is committed before it runs.

**Unchanged:** the bar (section 3), the MEASURED rule (section 8), the verdict on the model D variant, and the re-run
rule (section 5).
