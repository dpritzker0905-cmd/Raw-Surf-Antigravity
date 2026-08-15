# Mission packet — the nearshore outcome loop (WS-CAN-0076)

**Date** 2026-08-15 · **Status** CORE BUILT + FIRST LIVE MATCH (`da730a9b`); run-loop/cron = the
registered remaining work.

**⚠️ LIVE-SUBSET CORRECTION (measured after the packet)**: the census counted ARCHIVED stations;
the realtime catalogue carries 78, and the pair table's live intersection is **7 stations / 17
spot links right now** (CA + FL + NC, incl. 433p1 Duck FRF) — still ≈400+ matchable spot-hours
per day, the audit's 1,000 in ~2.5 days, but the denominator is 7/20, not 20/20. The lane
tolerates per-station outages by design (one dead buoy costs one buoy, counted in the report).

**THE FIRST MATCHED OBSERVATION** (end to end, live): Blacks ↔ 153p1 — model 0.573 m vs
instrument 0.940 m (−39.0%) on a 16.2 s swell 67° off-normal at a canyon-focusing site: the
chain works, and its first datum points at exactly the directional site-specific transfer the
2026-07-29 Kr study concluded a scalar cannot express.
**Source** Master Codex Audit 1.0 MC-03/Phase-2 ("observations from nearshore buoys where
available"; "accrue at least 1,000 matched nearshore spot-hours") — the deepest measured gap:
60,000 archived predictions, zero matched observations of the served nearshore quantity.

## The feasibility census (measured 2026-08-15, read-only; `nearshore-outcome-loop-census-2026-08-15.json`)

- CDIP archive catalog: 192 station ids, 135 with usable coordinates+depth.
- **53 stations are NEARSHORE (depth ≤ 30 m; median ~20 m, min 9.8 m)** — instruments sitting
  INSIDE the transform chain: after shelf friction and most shoaling, before breaking.
- Against the production catalog (1,773 spots, read from the production API):
  **35 spots within 10 km** of a nearshore station · **168 within 25 km** · 267 within 50 km.
- The closest pairs are the validation population you would pick by hand: Steamer Lane 2.0 km,
  Blacks 1.9, La Jolla Shores 1.9, Swamis 3.2, Cardiff Reef 3.3, Oceanside Pier 3.3, Cowell's
  2.7, Hollywood Beach 2.7, plus Gulf coverage (Okaloosa 1.7/3.0).
- Volume: 35 spots × hourly QC'd observations ⇒ the audit's 1,000 matched spot-hours accrues in
  ~. one to two days of wall time once the lane runs; segmentation minimums (per site × lead ×
  direction sector) are the real clock.

## What gets matched (the quantity decision, stated before any code)

**Model side:** the transform chain evaluated AT THE BUOY'S DEPTH — the pre-cap, pre-convention
intermediate (Kf · Ks(Tp, d_buoy) · exposure · Kr · Hs_offshore). NOT the breaking height: a 20 m
buoy is not in the break, and pretending otherwise would manufacture a mismatch.
**Observation side:** CDIP Hs, `waveFlagPrimary == 1` only (the existing script's QC discipline).
This validates everything BEFORE the cap — and the cap binds on 0.145% of served spot-hours, so
this quantity carries ~all of the served height's error budget. The 2026-07-29 Kr study is the
prior art (385,651 QC-good hours, 10 sites) — but it was climatological and one-shot; this lane
is FORECAST-time and recurring, which is what makes it an outcome loop rather than a study.

## Design constraints (each one a lesson this repo already paid for)

1. **ONE COMPOSITION, structurally.** The at-depth intermediate must come from the SAME code that
   serves — refactor `estimate_surf`'s pre-cap prefix into one internal helper both paths call.
   A parallel formula "just for validation" is the +19.1% sim defect shape, in an instrument.
2. **Refusal from day one** (the WS-CAN-0073 pattern): `available:false` with a reason until
   per-stratum minimum samples exist; a stratum below minimum reports its n, never its MAE.
3. **Segment by site × lead × direction sector.** The Kr study's own conclusion: the deficit is
   directional and site-specific (up to 1.75× swings at one site). A pooled MAE would hide
   exactly what this lane exists to see — and the per-site directional table is the input the
   eventual Kr(site, direction) correction trains on. That correction is the first genuinely
   state-of-the-art science step this program has measured its way to.
4. **Pair discovery from the catalog, never recalled** (station numbers/coordinates from memory
   have been wrong repeatedly — the existing script's own rule).
5. **Banked like buoy_calibration** (L2 report + cron step + monitor row), with the lane's cost
   bounded and measured before it joins any cron (the CMEMS-prewarm budget lesson).
6. **No skill claims from this lane** until the gate thresholds exist (audit: no "validated"
   language before minimum samples + baselines; persistence and Open-Meteo rows alongside, per
   WS-CAN-0026's design).

## Build plan (one mission, est. one session)

1. `transform_at_depth()` refactor inside `surf_transform` (shared prefix; property test: the
   served path is byte-identical — the refactor cannot move a published number).
2. `nearshore_validation.py` service: pair table (spot ↔ station ≤10 km first slice), fetch +
   QC + match by valid_time/lead, L2 report with refusal semantics.
3. Cron step behind a default-OFF flag + registry row; cost measured on one manual run before
   any schedule.
4. Register WS-CAN-0076; monitor row once two clean weeks exist.

## What this is NOT

Not SWAN/WW3/ML (parked by three audits until this ledger exists — this lane IS the ledger);
not a calibration change (measure first; the ERA5 campaign and dual-floor gates stand); not a
frontend surface (WS-CAN-0039 gates user-facing value).
