# Captured, but stored with the run that produced them

102 PNGs across three browser configurations are in `../browser-device-tests/shots-*/`:
- `{GFS,EURO}-<Layer>.png` — 24 per configuration, the differential pixel oracle's ON frames
- `base-{GFS,EURO}.png` — the all-layers-off control each diff is taken against
- `geo-*.png` — the 8-location geography sweep

Measurements derived from them: `../../MODEL_LAYER_GEOGRAPHY_COVERAGE.csv` (101 rows) and
`../../BUILD_BROWSER_DEVICE_COVERAGE.csv`.
