# Gate: peak-period-ship-v1
Stamp: 2026-11-22 (research lead; pre-registration only. No height row is read, and both flags stay '0' on every lane).
Candidate: ship `ICON_PEAK_PERIOD` (the GWAM partition-peak blend, p = 2) and `COPERNICUS_PEAK_PERIOD` (CMEMS VTPK) ON, so the ICON and Copernicus-EURO lanes feed the surf chain a PEAK period like GFS (PERPW), instead of an energy period of about 0.84 × peak.
Metric: H1 = the paired change in nearshore height MAE, ON minus OFF (m), at the graded stations (section 2), per flag. Reported beside it: height bias, period MAE vs DPD (a re-check of the 2026-10-20 rows), the rating level-shift rate, and the WIND-SEA stratum (DPD < 8 s).
Pass threshold: section 4. NOT WORSE means the upper one-sided 95 % bound of ΔMAE is < +0.03 m pooled, and in every region that meets its floor. |bias| must not grow by more than 0.05 m.
Controls: a null (OFF vs OFF re-run, which must come out NOT WORSE with ΔMAE about 0); a planted +0.10 m height offset on the ON arm in a fixed 30 % of rows, which must be detected as WORSE; floors per region.
Decision rule: two legs (section 1a). `COPERNICUS_PEAK_PERIOD`: NOT WORSE on the retrospective leg R → it may ship ON under D-065 on David's word ONLY IF R's recorded leads are true forecast leads of 24-72 h (section 1a, review 2026-11-23); otherwise R is reported and P decides. When it does ship on R, the prospective leg P must then also be NOT WORSE, or it is reverted. `ICON_PEAK_PERIOD`: P only. NOT WORSE on H1 for a flag → that flag may ship ON under D-065 on David's word (code default stays '0' until then; the switch is the workflow env), with a SCOREBOARD row. WORSE → no flip, and no re-tuning on this window.
Unmeasured items: wind sea under 8 s is reported as a LIMIT, not a bar (the period gets worse there: ICON 1.23 → 1.97 s, CMEMS 1.12 → 1.64 s MAE). SURF_PARTITIONS-on behaviour; the consensus period (`CONSENSUS_PERIOD_MEDIAN`); spots without a graded station.
Served change: none from this gate.

## 0. Why the director's two instruments cannot score this as they stand (read on `dev` 2026-11-22)
- **History filter (`default-on-filter.yml` → `default_on_filter.py`):** its replay (`eval_replay.py`) lists both flags in `UNREPLAYABLE`: "an ICON input flag; v0 replays GFS only" and "a EURO input flag; v0 replays GFS only". It would SKIP them, so it is not evidence here.
- **Nearshore judge (`run_nearshore_validation.py`):** it grades the SERVED `/point` answers, which are built with both flags at '0'. It cannot see the ON arm. (It also reads the live API; this gate adds no live reads.)
- **Hence one offline paired instrument** (section 1). It reuses what the 2026-10-20 evidence used: `peak_period_validation.py` and the production chain run offline.

## 1. Instrument: an offline paired replay
- **Inputs per member, per hour, the same for both arms except the period:**
  - ICON: GWAM Hs, direction, wind, with period = `tm10` (OFF) or the `gwam_peak_period` blend of `ppts`/`ppww` (ON);
  - EURO (CMEMS): MFWAM Hs, direction, with period = `VTM10` (OFF) or `VTPK` (ON).

  Fetched from the public or CI-held sources the 10-20 run used, on GitHub Actions, never on the Render box. The CMEMS credential is referenced by name (`COPERNICUSMARINE_SERVICE_USERNAME` / `..._PASSWORD`) and held only in CI.
- **Chain:** the production `surf_point.estimate_surf_at` offline, at each station's coordinate and depth, the way the nearshore judge computes its station height. The judge's code path is imported, never re-implemented.
- **Window:** the 42 days ending 2026-12-31, fixed now. The run happens after that date, on David's word. Leads 24-72 h.

## 1a. Two legs (the director's question, 2026-11-22: can the evidence come sooner than 12-31?)
- **Leg R, retrospective, CMEMS only.** A Copernicus product's archive holds past dates, so a CMEMS paired replay can run as soon as the instrument is built.
  - **Window:** 2026-10-21 to 2026-11-21 (32 days). It starts after the 2026-10-20 period run's 30-day window, so no period pair is reused.
- **Why R is sound, and its limits (disclosed, not hidden):**
  1. **The question is lead-insensitive by design.** Both arms share the same Hs, direction and wind, and differ only in which period DEFINITION is read from the same spectrum. VTPK/VTM10 is a property of spectral shape, not of forecast lead. R therefore answers "given the sea state, does the peak definition give better nearshore heights?", which is the decision.
  2. **But what R scores is not the served lead.** Past dates in a Copernicus analysis-forecast product may be the best-estimate (analysis-side) value, not the 24-72 h forecast users read. That is not verified here: the product page and the repo do not say whether past forecasts are overwritten.
     - **The build must record, for every R file, the run or production timestamp that Copernicus reports** and the lead it implies. R is reported as "lead as recorded". If the recorded leads are mixed, R is stratified by them.
  3. **"Unseen" means:** no ON-arm height has ever been computed for this window. OFF-arm SERVED heights were seen in passing by the nearshore judge's routine runs (its own stations), which is disclosed. Nobody has read an ON-vs-OFF difference.
  4. **Same bars, controls, stations, QC and floors** as section 4. One look.
- **Leg P, prospective:** as registered in section 1 (the 42 days ending 2026-12-31, leads 24-72 h). For CMEMS it CONFIRMS R. For ICON it is the only leg: DWD GWAM partition periods (`ppts`/`ppww`) are not known to be retained for past dates, so ICON has no R leg. If a retained archive is found, that is a new registration, not an amendment after the fact.
- **R may decide only on forecast data (review 2026-11-23; Reflection and LongCat both rated this high).** R can authorise a provisional CMEMS flip only if the build's per-file record shows TRUE FORECAST leads of 24-72 h (a run time and a valid time >= 24 h apart).
  - If the archive holds best-estimate or analysis values (lead about 0, or unknowable), R is REPORTED ONLY. It answers "does the peak definition give better heights given the sea state?", which SubQ (0.93) judged informative, but it cannot authorise a flip. P alone then decides for CMEMS, as for ICON.
  - Rationale: both arms share the same Hs, direction and wind, so analysis inputs do not favour either arm. But an analysis-time estimand is not the served forecast's, and the decision is about the served forecast.
- **R and P disagree, both directions:**
  - R NOT WORSE, P WORSE: P wins. The flag is reverted (the workflow env back to '0') and the disagreement is recorded.
  - R WORSE, P NOT WORSE: P wins (the flag may ship on P under the same rule), and the disagreement is recorded. A lead-insensitive effect that flips with lead is itself a finding.

## 2. Truth and stations
- **Stations:** the shared frozen buoy list, `nearshore_eval` tag (`served-wave-verify-v1` §0.1, built from #1156's `select_stations` rules: directional, 10-40 m, not USACE FRF Duck, not assimilated).
- **Truth:** NDBC nearshore buoys, plus CDIP (EXAM only: scored, never fitted).
- **QC:** the shared module (per-field ranges, ±30 min collocation).
- **Regions:** US West, US East + Gulf, Hawaii, Europe (where CMEMS-EURO serves).
- **Floor per region:** >= 3 stations, >= 21 valid days, >= 300 paired station-hours. Below the floor, a region is INSUFFICIENT, not a fail.

## 3. Statistics
- **Pairing:** by (station, valid hour, lead), with the same Hs, direction and wind in both arms.
- **Bootstrap:** moving blocks of 7-day spans, 10,000 replicates, seed 1185.
- **Lines:** one per flag, pooled, plus each region that meets the floor. Holm-adjusted within each flag's family.

## 4. Bars (NOT WORSE)
- **Height:** the upper one-sided 95 % bound of ΔMAE (ON - OFF) must be < +0.03 m, pooled and in every evaluable region, after Holm.
- **Bias:** |bias_ON| - |bias_OFF| <= +0.05 m pooled.
- **BETTER** (the ΔMAE bound below 0) is reported but not required. Under D-065, "not proven better" does not block.

## 5. Controls
- **Null:** OFF vs a second OFF pass with independent block resampling must be NOT WORSE, with ΔMAE within ±0.005 m. Otherwise VOID.
- **Planted control:** ON + 0.10 m in a fixed 30 % of rows (seed 1185) must come out WORSE pooled. Otherwise underpowered, VOID.

## 6. After a flip (BLIND guardrail)
- Both flags are read by fetcher subprocesses via `os.environ`. The runtime manifest cannot switch them off, and the live guardrail is BLIND (`flag_guardrail.py`).
- The post-flip check is therefore the nearshore judge on SERVED numbers: 14 days after the flip, compared with the 14 days before, on the same stations.
- **Revert** (workflow env back to '0') if the pooled served height MAE rises by more than 0.03 m with the CI clear of 0.

## 7. Limits
- **Wind sea under 8 s gets a worse period** (the 10-20 rows). This is reported as a stratum. A band-switched period (keep the energy period when wind sea dominates) would be a new registration.
- **One season** (northern winter).
- **The 10-20 period result** was one autumn window on Open-Meteo-sourced hindcasts (research only). Section 1 re-checks the period on this window.

## 8. Three-way review, 2026-11-23 (the owner asked for every test to be run by SubQ, Reflection and LongCat)
- **Reflection (high), LongCat:** R may use analysis or best-estimate fields, so it must not decide a flip. **Accepted:** R decides only on recorded forecast leads of 24-72 h, else it is reported only (section 1a).
- **LongCat:** "P wins on disagreement" is undefined. **Accepted:** both disagreement directions are written out (section 1a).
- **SubQ:** R on analyses is still informative for a definition question (0.93). Kept, as a reported leg.
