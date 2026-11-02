# 2026-11-01 (UTC 2026-11-02) · claude · science SOTA audit (docs only)

Branch `claude/science-sota-2026-11-01` off `origin/dev` `4b3e27aa6`. One writer: this session.

- 03:34Z: wrote `docs/research/science-sota-2026-11-01.md`, which holds the audit of 7 topics against the literature, the top-10 actions, and the second opinions from Reflection and SubQ. No code, flag or served-number change.
- Measurements, numbered as in the doc:
  - M1: in WW3's `ww3_grib.F90`, SWPER/WVPER carry the partition PEAK period (PTP).
  - M2: ECMWF open data carries the AIFS Single wave stream (no pp1d) and the IFS ENS `waef` stream.
  - M3: AIFS Waves reduces medium-range SWH error by ~10% vs ecWAM (Hahner et al. 2026).
  - M4: interpolating Hs² in time is 2-4% worse than linear Hs.
  - M5: one short live probe with health checked before and after. The Cocoa GFS regional tile came from run 10-30 18Z when read about 51 h later (n=1; not chased, delivery scope).
  - M6: cross-model reads from Nausika and Solano.
- Live load: `/api/health` ×2 and `/api/weather/point` ×9. Health was 200 both times (1.5 s, then 0.54 s).
- SCOREBOARD: no row, because no served number changed.
