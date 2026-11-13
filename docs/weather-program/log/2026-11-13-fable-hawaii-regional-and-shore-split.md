# 2026-11-13: PacIOOS ww3_hawaii FAILS as a drop-in; a shore-split rule is pre-registered (Fable repair lead)

Append-only. Docs only. No code, flag or served number changed. Offline, public data, no credentials.

## 1. ww3_hawaii vs GFS-Wave at the Hawaii buoys: FAIL / NOT SHOWN (rule fixed before reading any value)
- Pre-registered 07:00Z: PASS only if ww3_hawaii beats GFS-Wave masked bilinear (the served proxy) pooled, 95% interval
  clear of 0, AND is not significantly worse at any buoy with >= 20 pairs.
- Data: PacIOOS ERDDAP `ww3_hawaii` `Thgt` at the nearest grid point (~0.05 deg); NOAA gfswave f000 HTSGW, 37 cycle hours
  2026-11-04 00Z .. 11-13 00Z; NDBC WVHT within 40 min. 5 buoys, 181 pairs. Day-block bootstrap, 2000 draws.

| Buoy | n | MAE ww3_hawaii / GFS bilinear / GFS nearest | GFS bilinear minus ww3_hawaii [95%] |
|---|---|---|---|
| 51211 Pearl Harbor (south) | 37 | 0.131 / 0.830 / 0.764 | +0.700 [+0.585, +0.801] |
| 51206 Hilo | 37 | 0.164 / 0.295 / 0.293 | +0.132 [+0.064, +0.193] |
| 51212 Barbers Point (southwest) | 33 | 0.198 / 0.254 / 0.242 | +0.057 [-0.047, +0.166] |
| 51202 Mokapu (windward) | 37 | 0.454 / 0.380 / 0.262 | -0.073 [-0.103, -0.044] WORSE |
| 51201 Waimea (north) | 37 | 0.324 / 0.193 / 0.193 | -0.130 [-0.220, -0.049] WORSE |

- Pooled +0.139 [+0.102, +0.171], but worse at 51201 and 51202 (it under-reads the exposed shores by 0.28..0.45 m in this
  north-swell window). FAIL. Almost all of the pooled gain is 51211.
- Limits: near-analysis series (the ERDDAP aggregate), not forecast leads; one window, one swell regime; 51205 and 51208
  had no observations; 51202 and 51211 had already been seen for the two GFS arms.

## 2. Shore-split rule, PRE-REGISTERED 2026-11-13 07:25Z, NOT scored, NOT to be scored on the window above
- **Rule, frozen.** At a point and hour, take the direction the swell comes FROM: GFS-Wave primary wave direction (DIRPW)
  at the point's nearest wet 0.25-deg cell. Cast three rays from the point toward that direction and 22.5 degrees either
  side over ETOPO 1 arc-min (altitude >= 0 = land; the first 3 km skipped). The point is SHELTERED for that hour if all
  three rays meet land within 50 km. Sheltered -> use ww3_hawaii (nearest grid point). Otherwise -> GFS-Wave masked
  bilinear, as today. The numbers 22.5 degrees, 50 km and 3 km are chosen a priori and are not to be tuned.
- **Test window, disjoint:** 2026-11-14 00Z .. 2026-11-27 00Z, 6-hourly cycle hours, the same seven Hawaii buoys.
- **Statistic:** paired |error| difference, GFS masked bilinear minus shore-split, pooled, day-block bootstrap 95%.
- **PASS:** pooled > 0 with the interval clear of 0; no buoy with >= 20 pairs significantly worse; AND at least 100 pairs
  in which the rule chose ww3_hawaii (otherwise it tested nothing: UNTESTABLE). Under 4 buoys or 100 pairs: UNTESTABLE.
- **Also reported, not part of the pass rule:** a nearest-cell arm; how often each buoy was classed sheltered.
- **Honest origin:** the idea came from seeing section 1's per-buoy split. That is why it is scored only on data that did
  not exist when it was written. A pass at lead 0 would justify designing a dark ingest lane, not serving it.
