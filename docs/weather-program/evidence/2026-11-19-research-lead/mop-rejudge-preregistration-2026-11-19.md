# MOP re-judge on NON-Scripps truth: PRE-REGISTRATION (research lead, 2026-11-19)

**Owner word:** "Go with C, re-judge MOP on non-Scripps truth".

**Interim:** `SURF_NEARSHORE_MOP` stays ON until the verdict. Written before any data is read.

**Scope:** almost all California nearshore buoys are Scripps, so this can show "NOT WORSE on independent evidence", not
"better". "Better" needs our own truth (best-sota-path-synthesis step 0).

## Arms
- ON vs OFF (`SURF_NEARSHORE_MOP` 1 / 0).
- Same spots, hours and runs.
- Built by `science_shadow_ab.py` with the MOP archive, offline in Actions.

## Truth (no Scripps data)
- **T-NWPS:** nearshore Hs from NOAA NWPS (LOX, SGX, MTR, EKA) at the nearest wet CG1 cell facing the same water, using
  cycles issued before the valid time.
  - It is reported only, unless row 19a shows NWPS's ME within ±0.10 m vs buoys at those offices.
- **T-S2:** Sentinel-2 white-water extent. Spearman ρ against the served breaking height, stratified by tide stage, with
  onshore wind > 15 kt excluded.
- **T-NOAA (sanity):** NOAA-OWNED California buoys (owner column from NDBC's station table). The ON−OFF offshore input
  difference must be ≈ 0, else VOID.

## Sample
- California spots where MOP binds, frozen from the catalogue as of 2026-11-19.
- NWPS: forward archive for ≥ 30 days.
- S2: 2024-01-01 to the scoring date.

## Statistics
- T-NWPS: paired ΔMAE and ΔME vs NWPS per lead (+24, +48, +72 h).
  - Block bootstrap, 3-day blocks, B = 10,000, seed 20261119.
  - Holm across leads × {MAE, ME}.
- T-S2: Δρ, bootstrap blocked by month.

## Verdict (decided now)
- **KEEP:** ΔMAE Holm upper bound ≤ +0.05 m at every lead, AND |ΔME| not significantly worse, AND Δρ lower bound
  ≥ −0.05, AND T-NOAA ≈ 0.
- **OFF:** ΔMAE significantly > +0.05 m at ≥ 2 leads, OR Δρ significantly < 0.
  - Kill switch `SURF_NEARSHORE_MOP` = '0'. A SCOREBOARD row is required.
- **INSUFFICIENT:** < 10 three-day blocks, or < 40 usable S2 scenes.
  - It stays ON and is re-judged at 60 days or when blind_v1 reaches its minimum.

## Controls (VOID if any misbehaves)
- Null: ON vs ON gives 0.
- Planted +0.10 m / +0.20 m: must be caught by ΔME.
- Planted ×1.15 / ×1.30: must be caught by ΔMAE.
- The 2× plants are required.
- Derangement: the wrong spot's NWPS cell must score worse.

## One scored look
Scored once.
