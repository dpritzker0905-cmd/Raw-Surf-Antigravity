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

## 2. Shore-split rule, PRE-REGISTERED 2026-11-13 07:20Z, NOT scored, NOT to be scored on the window above
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

## 3. Amendment to the shore-split pre-registration (appended 2026-11-13, before the test window opens at 11-14 00Z)
Made after the advisor's red-team of section 2 (shared notes: redteam-859-shore-split-prereg-2026-11-13.md). No constant
is changed. The section 2 header first read 07:25Z; the commit that carries it is 07:20:08Z, so the header now says 07:20Z
(the ledger line's "07:25Z" is corrected by a correction line in the same fragment).

**Why section 2's pass rule was too weak.** Hours where the rule chooses GFS contribute exactly zero to the paired
difference, so the pooled leg reduces to the hours it chooses ww3_hawaii, which in practice is 51211, a buoy already seen
(+0.70 m). Without 51211 the section 1 pool is -0.005 m. Section 2 as written could not fail.

**Pass rule, replacing section 2's (stricter):**
1. The gain is judged ONLY on pairs where the rule chose ww3_hawaii: mean(|GFS bilinear err| - |ww3_hawaii err|) > 0 with
   the day-block 95% interval clear of 0, at EACH of at least 2 buoys that have at least 20 such pairs.
2. If only one buoy has at least 20 such pairs, the verdict is "CONFIRMS 51211, RULE UNTESTED", whatever the numbers.
3. No buoy with at least 20 pairs significantly worse under the rule than under GFS bilinear.
4. The DIRECTIONAL claim (shelter depends on the swell direction) counts as tested only if some buoy has at least 20
   pairs in EACH state (sheltered and not sheltered). Otherwise it is reported as untested.
5. Null: the same rule with the swell direction rotated by 180 degrees must NOT pass legs 1-3. If it passes, the rule's
   skill does not come from direction and the result is reported as such.
6. Wiring check before scoring: DIRPW is a "coming from" bearing. Shown by one case with a known answer (a north swell
   at 51201 must give a bearing near 315-360 and class 51201 NOT sheltered).
7. Fallback, fixed: where ww3_hawaii is masked or missing at the nearest grid point for that hour, use GFS masked
   bilinear, and count those hours per buoy.

**Arms added:** a static-list arm (ww3_hawaii at 51211 always, GFS elsewhere), so the directional rule is compared with
the simplest thing that could explain its gain; ww3_hawaii everywhere on the new window; GFS nearest cell.

**Buoy list, checked for wave-height reports only (no scoring), fixed:** 51201, 51202, 51205, 51206, 51208, 51211, 51212.
Other Hawaii nearshore wave buoys do not report: 51207 and 51210 (Kaneohe Bay), 51213 (Lanai SW), 51203, 51204, 51200
return no file. The open-ocean buoys 51001-51004 and 51101 report but are not sheltered and may sit outside the regional
grid. So at most 52 pairs per buoy, and legs 1 and 4 very likely end UNTESTED on this buoy set: that is recorded now, not
discovered later.

**Reported, not pass legs:** per buoy, how many hours flip between sources and the median jump at a flip; a
classification-only sensitivity table (25 / 50 / 100 / 150 km and +-15 / 22.5 / 30 degrees: how the sheltered count
changes, with no error scores); how many catalogue spots the rule classes sheltered; the lead mismatch (GFS f000 against
an aggregated "best" series whose forecast age can be up to a day).
