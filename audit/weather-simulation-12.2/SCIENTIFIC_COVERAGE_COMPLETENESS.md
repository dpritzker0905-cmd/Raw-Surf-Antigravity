# SCIENTIFIC COVERAGE COMPLETENESS — Audit 12.2

**The headline, stated bluntly:**

> **The validation estate grades the model's OFFSHORE INPUT. The one instrument that grades the
> SERVED NEARSHORE OUTPUT is empty, cannot refuse, and is read by nothing.**

The program's own binding mandate exists because offshore and nearshore are different quantities —
measured 2026-07-28 at **−18.7% (Jeffreys Bay) to +92.7% (Trestles)**, signed both ways. The gate
that can page grades the first. The instrument that grades the second returned, in production, on
2026-08-14:

```json
GET /api/weather/report-calibration
{"available": true, "n_reports": 0, "n_archive": 60000,
 "summary": {"n_matched": 0, "star_mae": null, "height_mae_m": null, "height_n": 0},
 "residuals": []}
```

**60,000 archived nearshore predictions — the archive is at its hard cap
(`ARCHIVE_MAX_ENTRIES = 60000`) — validated against nothing.** And `"available": true`.

---

## 1. What is genuinely validated

Recorded first, because this program's science is stronger than its self-description and the gap
below should not be read as "nothing is validated".

| Instrument | Grades | Cadence | Can it page? |
|---|---|---|---|
| `forecast_skill.py` | offshore `hs_m` error vs buoys, by lead time | scheduled | **yes** — via `forecast_accuracy_monitor.py` |
| `buoy_calibration.calibrate_spots` | T+0 model-vs-buoy residual | scheduled | feeds the above |
| `forecast_accuracy_monitor.py` | paired skill vs persistence; `ACCURACY_PAIRED_GATE=1`, grace to **2026-08-22** | scheduled | **yes — this is WS-OBJ-501's certified gate** |
| `forecast-calibration-census` | constant/threshold drift | scheduled | yes |
| `sim-parity-monitor`, `artifact-interpreter-parity`, `vector-blockmean-parity`, `science-shadow-ab` | internal consistency and A/B controls | scheduled | yes, for *consistency* |
| `validate_nearshore_transform.py` | the nearshore transform itself | **manual, zero cadence** | no |

The self-consistency estate is large and mostly excellent. **But a self-check cannot go red on a
wrong forecast** — it can only go red on an *inconsistent* one.

## 2. The gap, precisely stated

`backend/services/weather_pipeline/report_calibration.py` is the **only** instrument that grades the
quantities the product actually sells:

- `aggregate_pairs()` (`:159-175`) emits `star_mae`/`star_bias` and `height_mae_m`/`height_bias_m`
- `score_to_stars()` (`:202`) maps the **0-100 quality score** onto the surfer-logged 1-5 scale
- the snapshot (`:276`) archives `surf_height_m` from `rate_one_spot` — the **nearshore breaking
  height**, explicitly not `marine.point.speed`
- truth = `surf_log_entries.conditions_rating` / `wave_height`, matched ±6 h

It is **Active-reachable** (`REPORT_CALIBRATION: '1'` in `forecast-ingest.yml:74` and
`precompute.yml:96`). It runs. It is simply never *read*, and its truth side is empty.

### It cannot fail, and it cannot refuse

**Consumers** (`git grep` over `backend/` and `.github/`): exactly **one** — the read-only diagnostic
route `backend/routes/weather.py:638`. No threshold, no gate, no page.

**The gate that can page never reads it.** Absence check on
`backend/scripts/forecast_accuracy_monitor.py` for `star_mae|report_calibration|surf_height`: no true
hits. Positive control from the same file: `height_mae_m` and `calibration` both hit. The search
works; the reference is absent.

**Three silent-zero paths are indistinguishable in the output:**

1. `fetch_recent_reports_via_rest():234` — missing `SUPABASE_URL`/key → `return []`, **with no log at
   all**
2. HTTP failure → `raise_for_status()` → caught by the runner → `rows = []`, warning-log only
3. a genuine drought — no surfers logged sessions

All three render as `n_reports: 0` + null MAEs + `"available": true`. This is the program's own
tracked class — **"a refusal you cannot read is a pass"** — and the *sibling* instrument
(`forecast_accuracy_monitor.py`) implements an explicit `REFUSED` state for exactly this case.
`report_calibration.py` does not.

⇒ **Nobody currently knows whether the observation feed is broken or the ocean is quiet**, and the
system reports the same thing either way.

### No existing row covers it

Positive control: `WS-CAN` occurs 65× / 39× / 30× in the task register, objective register and gap
matrix, so grep works on those files.

| Row | Scope | Why it does not cover this |
|---|---|---|
| **WS-OBJ-501** *the accuracy gate grades the quantity that matters* — **CERTIFIED** | instrument = `forecast_accuracy_monitor.py`; acceptance = *"the gate can page on a real skill loss"* | Satisfied by **offshore `hs_m`** alone. The certificate is defensible for what it graded; its scope stops at the model input |
| **WS-OBJ-005** finish line *"forecast quality is graded by an instrument that can fail"* | acceptance = *"the gate grades the paired comparison and can page"* | Same — satisfied by offshore Hs |
| **WS-CAN-0026** the paired row | its entire evidence column is height MAE / `hs_m` skill | offshore |
| **SOTA B7** — **MET** | *"a gate that grades paired skill and can page"* | offshore |
| **WS-CAN-0051** | Gate 8 defer, *"None until the observation dataset grows"* | It is the *observation feed* that may be broken — which this row assumes away |

## 3. The coverage matrix, honestly

| Dimension | Covered | Not covered |
|---|---|---|
| **Variable** | significant wave height (offshore) | **wind, air temp, pressure, precip, water temp, wave period, wave direction, secondary swell, wind waves — none validated against an observation** |
| **Offshore vs nearshore** | offshore, at the buoy, deliberately (`buoy_calibration.py:410-413` resolves at the *buoy* to exclude shoaling) | **nearshore breaking height and the 0-100 quality — only by `report_calibration`, which is empty** |
| **Lead time** | binned by lead in `forecast_skill.py` | — |
| **Model** | GFS primary; EURO/ICON compared model-to-model | **no model other than GFS is validated against an observation at the served quantity** |
| **Geography** | 60 distinct buoys in the live report | **the accuracy estate is partitioned by height band, lead and model — never by geography.** A regional failure is invisible |
| **Temporal interpolation** | — | **never measured.** Interpolated frames are served through the full chain with no instrument on them |
| **Spatial interpolation** | `_selection_key`, converged | not validated against an observation |
| **Grid orientation (row order, UV flip)** | — | **unverified in BOTH directions** — SOTA A5, `WS-CAN-0028`, four audits |
| **Land/ocean masking** | guarded in tests | not validated against truth |
| **Observation sources** | NDBC buoys; `surf_log_entries` (empty) | no second independent source for the served quantity |

## 4. What this does *not* say

- It does **not** say the forecast is wrong. It says the served nearshore quantity is **ungraded**.
- It does **not** invalidate WS-OBJ-501's certificate. That gate does what it says; **its scope
  stops at the model input**, and no row ever claimed otherwise — which is exactly why nothing
  noticed.
- This audit's own pixel measurements (72/72 layer cells, 24/24 geography cells) grade **reachability
  and rendering, never value correctness.** A wrong-but-colourful field passes all of them, and
  passes zoomlab too. Value correctness is `WS-CAN-0028`, still not run.

## 5. Recommendations

1. **Make `report_calibration` refuse.** Distinguish *"no observations available"* from *"zero
   matched"* from *"the fetch failed"*. Copy the sibling's `REFUSED` state. This is a small change and
   it converts a silent zero into a readable state. **Do this before anything else here** — until it
   lands, nobody can tell whether the observation feed is broken.
2. **Expand `WS-OBJ-501`'s scope statement** to say, in writing, that the certified gate grades the
   **offshore input**, and open the served-output gate as its successor. Do not revoke the
   certificate; correct its scope (governance rule 16).
3. **Partition the accuracy estate by geography.** A regional failure is currently invisible, and the
   program's own largest measured accuracy lever (`C1`, 0.25° coverage) is a *regional* decision being
   made without a regional error signal.
4. **Run `WS-CAN-0028`.** Its stated blocker cleared on 2026-08-13. It is the only thing in the
   program that grades whether a rendered value is *correct*.
5. **Do not start `WS-CAN-0049`/`0051`** (AI bias correction, learned nearshore transform). Their
   stated prerequisite is *"a validated baseline"*, and this document is the measurement showing the
   served quantity has none. The premise is not merely unmet — it is now known to be unmet.
