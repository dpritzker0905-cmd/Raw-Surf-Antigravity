# The validation estate grades the INPUT, and the one instrument that grades the OUTPUT is empty

Audit 12.2 — independent refutation attempt. Verdict: **CONFIRMED GAP, with the claimant's proof corrected.**
Repo HEAD `791fdf78`, branch `dev`. All reads read-only.

## 1. The claimant's proof, re-run at HEAD

| Claim | Reproduces? | Note |
|---|---|---|
| `buoy_calibration.py:441` `model_hs = marine.point.speed  # offshore significant wave height (m)` | YES | verbatim |
| `:438` pins `domain="marine", layer="waves"` | YES | verbatim |
| `:410-413` model resolved AT THE BUOY to exclude nearshore shoaling | YES | "Resolving at the spot conflated two different things: our MODEL's error, and the real physical difference between deep water where the buoy floats and the nearshore where the spot breaks." |
| `forecast_accuracy_monitor.py:146` grades `summary.get('height_mae_m')` | YES | **path corrected**: `backend/scripts/`, NOT `backend/services/weather_pipeline/` |
| `forecast_skill.py:326` computes one error `err_m` on `hs_m` | YES | verbatim |

## 2. What the claimant MISSED — an instrument that does grade the served quantities

`backend/services/weather_pipeline/report_calibration.py` grades **both** disputed quantities:

- `aggregate_pairs()` (:159-175) emits `star_mae` / `star_bias` and `height_mae_m` / `height_bias_m`.
- `score_to_stars()` (:202) maps the **0-100 quality score** onto the surfer-logged 1-5 scale.
- The snapshot (:276) archives `surf_height_m` from `rate_one_spot` — and `spot_ratings.py:120` sets
  `surf_h = marine.surf_height_m`, the **nearshore breaking height**, explicitly NOT `marine.point.speed`
  (the same file calls `point.speed` "the OFFSHORE significant height — the repo's loudest landmine").
- Truth = `surf_log_entries.conditions_rating` / `wave_height`, matched +/-6 h.

Runtime classification: **Active-reachable.** `REPORT_CALIBRATION: '1'` is set in
`.github/workflows/forecast-ingest.yml:74` and `.github/workflows/precompute.yml:96`; dispatched via
`backend/scripts/ingest_forecast_ci.py:115` and `backend/scripts/precompute_ci.py:90`.

So "not graded by any instrument" is **too strong**. The correct statement is narrower and worse.

## 3. Live production measurement (the decisive evidence)

`GET https://raw-surf-antigravity.onrender.com/api/weather/report-calibration`, 2026-08-14:

```json
{"available":true,"generated_at":"2026-08-14T01:31:18.737897+00:00","model":"GFS",
 "n_reports":0,"n_archive":60000,
 "summary":{"n_matched":0,"star_mae":null,"star_bias":null,"star_n":0,
            "height_mae_m":null,"height_bias_m":null,"height_n":0,"height_mae_ft":null},
 "residuals":[]}
```

The report is **fresh** and the prediction archive is **at its hard cap** (`ARCHIVE_MAX_ENTRIES = 60000`).
The observation side is **zero**. 60,000 archived nearshore predictions are validated against nothing.

## 4. It cannot fail, and it cannot refuse

Consumers of the rating-calibration output (`git grep` over `backend/ .github/`): exactly one — the
read-only diagnostic route `backend/routes/weather.py:638`. **No threshold, no gate, no page.**
Positive control: the buoy/skill keys ARE consumed, at `forecast_accuracy_monitor.py:426`.

Absence check on the monitor — needle `star_mae|report_calibration|surf_height` in
`backend/scripts/forecast_accuracy_monitor.py`: no true hits (the `score` hits are the substring
`scored`, i.e. the skill ledger). Positive control from the same file: `height_mae_m` and
`calibration` both hit. **The gate that can page never reads the nearshore instrument.**

Worse, the truth feed has three silent-zero paths that are indistinguishable in the output:
1. `fetch_recent_reports_via_rest():234` — missing `SUPABASE_URL`/key → `return []`, **no log at all**
2. HTTP failure → `raise_for_status()` → caught by the runner → `rows = []`, warning-log only
3. a genuine drought (no surfers logging)

All three render as `n_reports:0` + null MAEs + `"available": true`. This is the program's own tracked
defect class **"a refusal you cannot read is a pass"** — the sibling instrument
(`forecast_accuracy_monitor.py`) implements an explicit `REFUSED` state for exactly this, and
`report_calibration.py` does not.

## 5. Register diff — no covering row

Positive control: `WS-CAN` occurs 65× / 39× / 30× in the task register, objective register and gap
matrix respectively, so grep works on these files.

- **WS-OBJ-501** "The accuracy gate grades the quantity that matters" — CERTIFIED; instrument
  `forecast_accuracy_monitor.py`; acceptance "The gate can page on a real skill loss."
- **WS-OBJ-005** — finish line "Forecast quality is graded by an instrument that can fail";
  acceptance "The gate grades the paired comparison and can page." Satisfied by offshore Hs alone.
- **WS-CAN-0026** — the paired row; its entire evidence column is height MAE / `hs_m` skill.
- **SOTA B7** — MET, acceptance "A gate that grades paired skill and can page."
- **WS-CAN-0051** — a Gate 8 *defer* with Remaining Work "None until the observation dataset grows".
  A parking space for a learned *transform*, not a validation task. Its stated blocker is the
  **evidence for** this gap (and §3 sharpens it: the prediction archive is at cap; it is the
  OBSERVATION side that is zero).

Absence, with control: `report_calibration|star_mae` appears in **no file** under
`audit/weather-simulation-12.0` or `audit/weather-simulation-12.1`. Control: `buoy_calibration`
appears in `12.0/evidence/artifact-manifest.csv`, `RV-08_model_census.py`,
`RV-09_per_band_euro_addendum.md`. **The 12.x program is blind to this instrument's existence.**

## 6. The sharpest point: "nearshore" is measured by an instrument built to exclude the nearshore

**WS-OBJ-006** finish line: *"Nearshore skill exceeds a public reference at every lead."*
Acceptance: *"Paired skill win at +24h sustained over two weeks."* That paired ledger is
`forecast_skill.py` scoring `hs_m` against NDBC buoys — resolved **at the buoy** precisely so that
nearshore shoaling is excluded (`buoy_calibration.py:410-413`). The objective uses the word
"nearshore" for a number measured in deep water. WS-OBJ-006 does not cover the gap; it embodies it.

## 7. Why the offshore gate cannot substitute

The offshore gate catches upstream/ingest regressions, and `WS-OBJ-201` certifies the chain is
*wired* (a wiring proof, not an accuracy proof). What neither can catch is an error in the
**transform itself** — gamma, `REFRACTION_KR`, `SURF_HEIGHT_H110`. Project memory records exactly such
a live, admitted error: after the 08-05 height pair shipped, *"mid-range still reads high — the
uncancelled INPUT-COMPRESSION error, still open."* A transform error is invisible to every
instrument that can currently fail, and CLAUDE.md measures offshore-vs-breaking divergence at
**-18.7% to +92.7%**, signed both ways.

## 8. Verdict

**CONFIRMED GAP** — but re-scoped. Not "nothing measures the served numbers": an active instrument
measures both, produces `n_matched = 0`, cannot refuse, and is read by no gate. The certification of
WS-OBJ-501 as "grades the quantity that matters" is a **certification-scope defect**.
