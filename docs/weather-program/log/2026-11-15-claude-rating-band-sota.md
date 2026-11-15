# 2026-11-15 — rating band SOTA lane (claude, worktree rating-band-sota-51340a)

Owner report (dev site, 2026-11-15): (1) while zooming, band colours in some areas CHANGED then corrected; (2) the band sometimes
did not appear, or was slow; (3) panning was slow to cover the next tile; (4) re-verify the science.

## 0. PRE-REGISTRATION (written 2026-11-15 ~13:05 EST, before any reproduction run or any accuracy number was read)

### Symptom gate (offline harness `scn_band_zoom_stability.js`, synthetic store, no live load)
- **S1 flash**: frames where the band is visible (bandMult >= 0.5) and a probe shows a score >= 10 points (about one rating
  level) away from the score the same probe settles to at the end of the same step, at the same hour. PASS: 0 flashes in the
  fix arm across load, zoom out, zoom in, two pans; the nofix arm must show > 0 for the fix to be credited (otherwise "not
  reproduced" is recorded and no flash fix is claimed).
- **S2 first paint**: ms from Waves-on (Surf Rating ON) to the first visible covering band. Reported, both arms. No bar set:
  a fix is credited only if the fix arm is not worse by more than 500 ms.
- **S3 pan cover**: ms from drag end to a visible covering band. Same rule as S2.

### Science gate (decided before reading any number)
- **G1 one chain (deterministic, offline)**: for coastal cells of a synthetic rated frame, the band's score must equal
  `compute_surf_rating(estimate_surf_at(...))` with the same inputs `rate_one_spot` would pass at that coordinate (eta = 0, no MOP,
  the band's declared exclusions), |delta| <= 0.05 points in >= 99 % of rated cells. NULL control: the same comparison with
  `RATING_BAND_ONE_CHAIN=0` (the bare second path) must FAIL the bar. POSITIVE control: +5 points injected into one cell must be
  the one cell flagged.
- **G2 zoom invariance (deterministic, offline)**: the same model, run, hour rated on the 0.25-deg regional lattice and on a
  strided (series) lattice: at every node the two lattices share, identical score (|delta| = 0). Null control: a lattice offset by
  half a cell shares no node (reported, not gated). Positive control: a +1 point perturbation on one node is detected.
- **G3 accuracy (existing artifacts only; no new run against the live box)**: the last 7 days of `nearshore-validation.yml`
  reports (CDIP nearshore buoys vs the serving chain's nearshore height), pooled and per station: bias and MAE as reported, n in
  station-hours (never spot-hours). Reported as measured, good or bad. The comparison that decides "state of the art" is the
  report's own null arm (bulk offshore Hs at the station, no transform): the chain must have lower MAE than the bulk arm pooled.
  Not gated on per-station rows (n too small); those are reported only. The repair lead (local_ff1641e7) owns the offshore
  per-buoy split, 46267 and Hawaii windows: this lane does NOT read or spend those.
