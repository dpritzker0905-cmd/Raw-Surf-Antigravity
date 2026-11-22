# Q4 — Tide: FES2022b + mean level vs TPXO10 and NOAA CO-OPS; which vertical datum to serve (2026-11-22)

Scope: research note for the director's question on the tide lane (#1132 / #1138). Read-only. No served change, no merge.
Status: **partial**. The CO-OPS datum check is measured; the FES-vs-TPXO head-to-head is **not** found in the sources reached here.

## 1. What the served code does

**Served path (#1132, per the director's correction 2026-11-22):** the tide lane serves our **A+M table** (the table built in #1132 and its follow-ups). It has **no CO-OPS path and no EOT20 path**. Water levels are labelled **"heights above local mean sea level"** (commit `ff2bf46b1`).

The CO-OPS → FES2022b → EOT20 → unavailable order, with MLLW/LAT computed offline, is the **M1 design plan** in `docs/weather-program/log/2026-11-15-claude-tide-m1.md`. It is not what #1132 serves. Do not read that order as the served behaviour.

- Predictions are zero-mean about MSL by construction (plan and served table alike).
- The M1 gate (G-M1a parity vs CO-OPS predictions, MSL) was **VOID**. Its diagnosis: a per-station **mean-level offset**
  of 0.02–0.15 m (largest on the Atlantic and Gulf), not a shape error. The positive control's de-meaned median was 0.0089 m.
  Item 4 (|MSL − MLLW| offset error ≤ 0.05 m) held at median 0.0135 m in the first run.

## 2. CO-OPS datums and predictions, measured (read-only, `coops` MCP)

Station 8443970 (Boston, MA), `coops_get_datums` (metric, station datum):

| Datum | m |
|---|---|
| MHHW | 4.205 |
| MHW | 4.071 |
| MSL | 2.660 |
| MLLW | 1.074 |
| NAVD88 | 2.752 |

So **MSL − MLLW = 1.586 m** at Boston. A serving choice of datum shifts every displayed level by that amount.

Harmonic predictions in MSL, hourly, 2025-07-01 to 07-07 (`coops_get_tide_predictions`, `datum=MSL`, 168 records, not truncated):
range about **−1.32 m to +1.35 m**, zero-mean as expected for a MSL-referenced tidal series. Predictions are MSL-referenced, so
they are directly comparable with our synthesis, which is also MSL zero-mean.

This is one station and one week. It is a sanity check on the datum arithmetic, not a parity test. The parity test is the
M1 gate, which is void.

## 3. FES2022b vs TPXO10 — what the sources say

- FES2022 preprint (AVISO / OSTST 2022 and the FES2022 handbook, found via search): tidal-elevation RSS error at tide gauges
  is **42.3 mm**, down from FES2014b; 7.6 mm at deep-ocean altimetry crossovers; 11.3 mm on shelves. These are against
  FES2014b, **not** TPXO10.
- A 2026 Norwegian tide-gauge preprint (`egusphere-2026-5493`) compares FES2022 and TPXO10 against about 250 Norwegian gauges.
  Its snippet reports median errors of 2.4–3.3 cm across five models, **without attributing each value to a model**.
  Unverified until the full tables are read.
- A 2025 study of the eastern China marginal seas (MDPI *J. Mar. Sci. Eng.* 13(3):395) assesses both models against 65 gauges.
  The RMSE numbers were not visible in the snippet.
- Caveat from the same search: FES2022 assimilated **fewer** tide gauges than FES2014b, so gauge validation is not fully
  independent of the model.

**Not established here:** a like-for-like FES2022b vs TPXO10 RMSE table at the US gauges. Next step: read the full text of
`egusphere-2026-5493` and the MDPI paper, then compare on the same gauge set as our G3t panel.

## 4. Is "heights above local MSL" the surf-app convention?

Honest answer: **not established by these searches.**

- No source found states the datum behind Surfline's or Magicseaweed's tide charts. A search of the two surf brands returned
  nothing on the datum. Magicseaweed now sits under Surfline (acquired 2023), so its tide product is likely Surfline's.
- Surf **height** (face height of waves) is a different quantity from the water-level **datum**. Our breaking-height chain
  already handles the wave side. The datum question only affects how a water level is labelled.
- General guidance found (windfinder help, stormglass tidal-datum note): the datum must be stated, because the same high
  tide can read about 1.7 m above MSL and 3.75 m above MLLW. MLLW is the US benchmark for charts and tide tables; MSL is the
  common reference for model and altimetry sea level.
- NOAA's own default for `coops_get_tide_predictions` is **MLLW** (the tool's default), which is what a NOAA tide table shows.

## 5. Recommendation (for the director to decide; nothing changed here)

1. Keep **MSL as the internal and model reference**. It is what FES, EOT20 and the altimetry products are zero-mean about, and
   the eta cap for the breaking height is defined against it.
2. **PROPOSAL, not a change:** an MLLW display at US points would be its own PR, with a SCOREBOARD row and an owner
   decision. Served labels today stay "heights above local mean sea level". The MLLW wording exists only in the M1 design
   plan, not in #1132.
3. Do not claim surf apps use MSL. We have not verified it, so state our own convention and cite NOAA, not the apps.
4. The M1 void stands. The Boston datum sheet and one week of predictions do not change that verdict.

## 6. Open items

- Read the full Norwegian (`egusphere-2026-5493`) and MDPI (13(3):395) papers for the FES2022b vs TPXO10 numbers.
- Ask a surf app's support or read its help page for its tide datum. Not found by search.
- Measure a mean-level offset at more G3t stations via `coops_get_datums` (cheap, read-only), then compare against the
  synthesis if a like-for-like run is approved.

Sources: NOAA CO-OPS via the `coops` MCP (station 8443970, read-only, retrieved 2026-11-22). Repo: `docs/weather-program/log/2026-11-15-claude-tide-m1.md`.
Web: FES2022 handbook (aviso), `egusphere-2026-5493`, MDPI 13(3):395, windfinder and stormglass datum notes.
