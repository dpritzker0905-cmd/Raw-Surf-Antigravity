# CLIM_GUST table for the long-range wind v2 gate (public mirror)

A station-record climatology of the 6 h window maximum of adjusted NDBC gust (`GST`), by station, day of year (+-15 days) and 6-hourly
UTC hour, built for the pre-registered gate `wind-long-range-v2` (amendment G1). It is a comparator table: it serves nothing and moves no
number shown to users.

- **Source and attribution:** derived from NOAA National Data Buoy Center (NDBC) historical standard meteorological data, 2016-2025
  (https://www.ndbc.noaa.gov/), U.S. Government public data. NOAA/NDBC did not produce or endorse this derived table.
- **Built by:** `backend/scripts/wind_lr2_gust.py build-clim`, workflow run 45266543788 (`wind-lr2-clim.yml what=clim_gust`), over the frozen
  station list `docs/weather-program/evidence/wind-long-range-v2/wind_lr2_stations.json` (sha256 `ec87dc04d27caaab75cb3b021c0620f2acccb3f3d55a168b97394c61393602c8`).
- **File:** `wind_lr2_clim_gust-1e7df526a8598fc1.json` (12810040 bytes), canonical JSON (`sort_keys`, compact separators).
- **sha256 (the whole file):** `1e7df526a8598fc10e476318645829e792f5abd7cf6bdc3862d964f9954d01d8`

## Verify before use
`sha256sum wind_lr2_clim_gust-1e7df526a8598fc1.json` must print the sha256 above. The scorer does not trust any copy: `wind_lr2_gust.load_clim_gust` checks the bytes
against the hash COMMITTED in the repository (`wind_lr2_clim_gust.json.sha256`) and refuses on any mismatch.

## A corrected table
Nothing here is ever overwritten or deleted. A corrected table gets a NEW hash-named asset (`wind_lr2_clim_gust-<new sha256[:16]>.json`) in a
NEW release (`wind-lr2-clim-gust-<new sha256[:16]>`), a new committed hash file through a gated pull request, and a dated amendment saying why;
the old release stays as the record of what was frozen.

## Publication procedure (run by the dispatching session once the PR carrying this file is gated)
```
gh run download 45266543788 --repo dpritzker0905-cmd/Raw-Surf-Antigravity -n wind-lr2-clim_gust-45266543788 -D clim_gust_dl
sha256sum clim_gust_dl/wind_lr2_clim_gust.json            # must print 1e7df526a8598fc10e476318645829e792f5abd7cf6bdc3862d964f9954d01d8; stop if it does not
cp clim_gust_dl/wind_lr2_clim_gust.json wind_lr2_clim_gust-1e7df526a8598fc1.json
gh release create wind-lr2-clim-gust-1e7df526a8598fc1 wind_lr2_clim_gust-1e7df526a8598fc1.json --repo dpritzker0905-cmd/Raw-Surf-Antigravity --target dev --latest=false \
  --title "CLIM_GUST table for wind-long-range-v2 (1e7df526a8598fc1)" --notes-file docs/weather-program/evidence/wind-long-range-v2/clim-gust-release-notes.md
```
(If the run artifact has expired, download the bucket object `calibration/wind-lr2/45266543788-1/wind-lr2-clim_gust-45266543788/wind_lr2_clim_gust.json` instead and verify the same hash.) Then commit the
publication time and publisher into `wind_lr2_clim_gust.release.json`.
