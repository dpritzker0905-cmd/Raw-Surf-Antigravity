# ICON rain sampling: ruling and radar test (research lead, 2026-11-19; sent to frame-carry and the director)

## Ruling
Keep TODAY's AREA MEAN served until the radar test decides. Any swap ships dark.
- A 0.125° frame shows a cell. The honest value for it is its area average, which is also what radar or gauges
  aggregated to that cell measure.
- Native-field peaks are sub-grid features. Matching them measures grid fidelity, not truth accuracy.

## Test (pre-registered before any radar is read)
- **Truth:** NOAA MRMS QPE (public domain), area-averaged to the 0.125° cells. US only.
- **Collection:** a forward collector of native TOT_PREC, because DWD keeps about 24 h.
  - Every day in the pre-registered window is a case. A "dry" day (< 1% of cells ≥ 0.5 mm/h) is reported separately.
  - Native files stay private and are deleted after scoring.
  - Arm (1) rebuilt from native files must equal the published frames (a null check).
- **Arms:**
  - (1) area mean (today);
  - (2) A′, the nearest native cell;
  - (3) a quantile-mapped area mean, with mass held to ±1%;
  - the native 0.0625° reference, for scale only.
- **Metrics:** FSS at 0.5 / 2 / 5 / 10 mm/h × neighbourhoods 1 / 3 / 5 cells; frequency bias; mass bias; storage.
- **Switch only if** an arm beats the area mean on FSS at ≥ 2 thresholds (Holm), with frequency bias at ≥ 5 mm/h not
  worse, mass within ±1%, and storage passing.
- **Controls:** a null; a planted 1-cell shift (FSS must drop); a planted ×1.2 (frequency bias must rise).
- **Excluded:** OPERA (European radar) until its licence is read.
