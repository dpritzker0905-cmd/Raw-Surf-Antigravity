# JAC-1 calibration against CDIP MOP: what should the swell-angle factor do beyond 90°?

Run 2026-11-10, read-only on the repo (worktree `fable-repairs-ec7369`, branch `fable/cmp1-band-one-chain`, HEAD `1d5afe260`).
No call to the app backend. Only public CDIP THREDDS data was used.

## Answer first

**The MOP data do not support JAC-1. No edge angle E fits, and every taper is worse than today's flat 0.595 floor.**
Beyond 90° from the chain's shore normal, MOP keeps **about 0.70 of the head-on height ratio** (pooled, count-weighted:
0.73 at 90-110°, 0.67-0.70 at 110-150°, 0.57-0.61 at 150-180°). That is ABOVE the current floor, not below it.

| pooled fit, bins dθ ≥ 80°, 19 spots, 95 spot-bins, 133,799 two-hourly samples | count-weighted MSE |
|---|---|
| today's flat floor (0.595 beyond 90°) | **0.032** |
| best constant floor beyond 90° (fitted) = **0.695** | 0.024 |
| taper E=180 (the "best" E, a boundary of the search) | 0.096 (3.0× flat) |
| taper E=150 | 0.148 (4.6×) |
| taper E=120 (the audit's guess) | 0.241 (7.5×) |
| taper E=90 (hard cutoff) | 0.403 (12.6×) |

Swell-only sensitivity (buoy Tp ≥ 10 s): same ranking. Flat 0.049, constant floor 0.73 gives 0.035, E=180 gives 0.117, E=120 gives 0.269.
Excluding the three focusing outliers (La Jolla Shores, Capitola, Sands): flat 0.020, E=180 0.063, E=120 0.193.
Per spot, E=180 "wins" at 18 of 19 spots only because it is the gentlest taper on the grid, and flat beats it at all 18.
Carmel has too few hours beyond 90° (37) to say anything. The only spot-level exception is Newport Point in the swell-only
variant, where E=140 edges flat (0.0111 vs 0.0133) on about 145 hours beyond 100°. That is noise, not a signal.

**Recommendation from this evidence: do not ship JAC-1's taper.** If anything changes, the floor beyond 90° should go UP to
about 0.70, not down to 0. Raising it would also be a served-number change and would need its own SCOREBOARD row and gates.

## Data sources

- MOP v1.1 alongshore hindcast, hourly, 2000-01-01 to 2025-03-31. Used **2022-01-01 00Z to 2025-03-31 23Z, every 2nd hour**
  (14,232 samples per point; OPeNDAP index `192864::2`), variables `waveHs`, `waveDp`, `waveTp` plus `metaLatitude`,
  `metaLongitude`, `metaWaterDepth`, `metaShoreNormal`.
  URL pattern: `https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_alongshore/<ID>_hindcast.nc`.
  The nearest ID was found by sampling `metaLatitude/metaLongitude` along each MOP prefix and then refining
  (catalogue: `https://thredds.cdip.ucsd.edu/thredds/catalog/cdip/model/MOP_alongshore/catalog.xml`).
  The MOP files' `waveModelInputSource` lists offshore drivers `191p1-067p1-071p1` for the SoCal points, so the buoys below
  are the same family that drives MOP.
- Offshore reference: CDIP archived buoys, `https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/<stn>/<stn>_historic.nc`,
  `waveHs`, `waveDp` (peak FROM direction), `waveTp`, `waveFlagPrimary==1` only, same window, matched to the MOP hour exactly:
  - **029p1 Point Reyes** (37.945, -123.468): Ocean Beach SF, Linda Mar
  - **157p1 Point Sur** (36.339, -122.102): Santa Cruz spots, Carmel
  - **071p1 Harvest** (34.456, -120.775): Santa Barbara and Ventura spots
  - **067p1 San Nicolas Island** (33.223, -119.876): LA, Orange County, San Diego
- Shore normals: `services.weather_pipeline.surf_point._shore_normal_precedence(lat, lng)[0]` (the value `chain_shore_normal_at`
  returns), run with `RUNTIME_FLAGS_MANIFEST=0 TESTING=1`. All are `etopo`-sourced except Carmel (`coarse`).
  Spot coordinates come from `backend/data/mop_spot_cells.json`. Cowell's Beach was dropped because it shares MOP point SC149
  and has the same normal as Steamer Lane.
- Downloaded: about 7.9 MB of binary subsets (`dl/npz/`) plus the 12.5 MB catalogue XML.

## Method

For each matched hour with buoy Hs ≥ 0.5 m and MOP Hs > 0: r = Hs_MOP / Hs_buoy, and
dθ = |wrap(Dp_buoy − chain_normal)| in [0, 180]. Bin dθ in 10° bins and take the median r per bin.
Normalise by the head-on reference (median r for dθ < 30°), then multiply by the chain's mean factor over those reference
hours, so A(dθ) sits on the same scale as the chain's f(dθ) with f(0) = 1.
Fit over bins centred ≥ 85° (the 80-90° bin onward) with n ≥ 30, weighted by count. Taper family: f unchanged for
dθ ≤ 90°, then 0.595·(E−dθ)/(E−90) clipped to [0, 0.595].
Scripts are in `scripts/` (`locate.py`, `fetch.py`, `analyze.py`, `losers.py`, `tables.py`). Every number is also in `binned.json`
(`variants.all` and `variants.swell_Tp>=10s` → per-spot `n`, `days`, `median_r`, `q25`, `q75`, `A`, `mse_flat`, `mse_by_E`; `pooled`; `losers`).

## Per-spot geometry and fit (all hours)

| Spot | chain normal | MOP ID (depth, km) | MOP normal | buoy | matched h | h >90° (days) | ref ratio Hs_MOP/Hs_buoy (dθ<30) | best E | MSE flat | MSE E=120 | MSE E=180 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Ocean Beach SF | 268.2 | SF029 (10 m, 0.52) | 265.0 | 029p1 | 13920 | 401 (137) | 0.82 | 180 | 0.0213 | 0.0508 | 0.0283 |
| Pacifica - Linda Mar | 283.4 | SM371 (15 m, 0.76) | 296.0 | 029p1 | 13920 | 1101 (240) | 0.51 | 180 | 0.0604 | 0.2176 | 0.0970 |
| Capitola | 149.4 | SC111 (15 m, 2.88) | 129.5 | 157p1 | 14230 | 12268 (1137) | 0.38 | 180 | 0.0453 | 0.5650 | 0.3103 |
| Pleasure Point | 177.2 | SC117 (15 m, 1.92) | 158.0 | 157p1 | 14230 | 11869 (1132) | 0.50 | 180 | 0.0154 | 0.3430 | 0.0867 |
| Steamer Lane | 154.1 | SC149 (15 m, 0.49) | 127.5 | 157p1 | 14230 | 12235 (1137) | 0.48 | 180 | 0.0183 | 0.4061 | 0.1717 |
| Carmel Beach | 246.6 | MO638 (15 m, 1.33) | 283.6 | 157p1 | 14230 | 37 (21) | 0.69 | 90 | 0.0012 | 0.0012 | 0.0012 |
| Leadbetter Beach | 189.0 | B0266 (10 m, 1.29) | 210.0 | 071p1 | 14228 | 11200 (1108) | 0.34 | 180 | 0.0454 | 0.3762 | 0.1205 |
| Sands Beach | 201.2 | B0415 (10 m, 0.09) | 173.0 | 071p1 | 14228 | 9126 (1061) | 0.14 | 180 | 0.0641 | 0.1710 | 0.0781 |
| Rincon | 201.9 | B0007 (10 m, 0.51) | 233.5 | 071p1 | 14228 | 8817 (1045) | 0.32 | 180 | 0.0519 | 0.2161 | 0.0879 |
| Mondos | 219.8 | VE572 (10 m, 0.06) | 237.0 | 071p1 | 14228 | 3370 (671) | 0.40 | 180 | 0.0096 | 0.0323 | 0.0150 |
| C Street Ventura | 203.9 | VE463 (10 m, 0.84) | 174.0 | 071p1 | 14228 | 8447 (1027) | 0.39 | 180 | 0.0155 | 0.1338 | 0.0379 |
| Malibu First Point | 179.1 | L0935 (10 m, 1.17) | 199.0 | 067p1 | 14229 | 11128 (1093) | 0.46 | 180 | 0.0072 | 0.2027 | 0.0223 |
| Zuma Beach | 215.0 | L1071 (10 m, 1.42) | 222.0 | 067p1 | 14229 | 4144 (766) | 0.55 | 180 | 0.0002 | 0.0141 | 0.0021 |
| Huntington Beach Pier | 219.7 | OC512 (10 m, 1.18) | 210.5 | 067p1 | 14229 | 2304 (595) | 0.54 | 180 | 0.0008 | 0.0106 | 0.0028 |
| Newport Point | 216.0 | OC381 (10 m, 0.32) | 196.0 | 067p1 | 14229 | 3540 (721) | 0.49 | 180 | 0.0038 | 0.0118 | 0.0045 |
| Trestles | 220.9 | D1204 (10 m, 0.87) | 214.3 | 067p1 | 14229 | 1781 (541) | 0.56 | 180 | 0.0002 | 0.0063 | 0.0013 |
| Blacks Beach | 266.9 | D0542 (10 m, 0.59) | 270.0 | 067p1 | 14229 | 587 (178) | 0.45 | 180 | 0.0970 | 0.1628 | 0.1133 |
| La Jolla Shores | 301.5 | D0499 (10 m, 0.37) | 300.5 | 067p1 | 14229 | 2334 (394) | 0.21 | 180 | 0.3389 | 0.9928 | 0.5436 |
| Windansea | 266.7 | D0457 (10 m, 0.62) | 267.5 | 067p1 | 14229 | 587 (178) | 0.51 | 180 | 0.0809 | 0.1467 | 0.0976 |

## Attenuation curve A(dθ) per spot (all hours; n in brackets; italics mean n < 30, not used in the fit)

| Spot | 40-50° | 50-60° | 60-70° | 70-80° | 80-90° | 90-100° | 100-110° | 110-120° | 120-130° | 130-140° | 140-150° | 150-160° | 160-170° | 170-180° |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ocean Beach SF | 0.69 (2466) | 0.59 (2509) | 0.63 (884) | 0.80 (397) | 0.77 (464) | 0.76 (277) | 0.69 (90) | _0.57 (23)_ | _0.52 (9)_ | _0.76 (2)_ |  |  |  |  |
| Pacifica - Linda Mar | 0.92 (1756) | 0.94 (238) | 0.91 (100) | 0.91 (209) | 0.89 (305) | 0.87 (440) | 0.83 (423) | 0.80 (179) | 0.58 (45) | _0.50 (11)_ | _0.63 (2)_ | _0.66 (1)_ |  |  |
| Capitola | 1.07 (402) | 1.20 (281) | 1.22 (202) | 1.22 (96) | 1.03 (60) | 1.10 (91) | 1.17 (138) | 1.06 (256) | 1.02 (650) | 0.90 (1700) | 0.81 (2478) | 0.69 (3115) | 0.61 (3133) | 0.59 (707) |
| Pleasure Point | 1.04 (102) | 0.96 (63) | 0.94 (79) | 1.02 (123) | 0.96 (208) | 0.91 (497) | 0.81 (1410) | 0.72 (2547) | 0.65 (2958) | 0.58 (3366) | 0.55 (1036) | 0.53 (52) | _0.52 (3)_ |  |
| Steamer Lane | 0.93 (352) | 0.92 (266) | 0.90 (129) | 0.92 (73) | 0.86 (58) | 0.94 (121) | 0.97 (165) | 0.91 (367) | 0.84 (1066) | 0.74 (2146) | 0.65 (2996) | 0.54 (3437) | 0.50 (1784) | 0.50 (153) |
| Carmel Beach | 0.96 (2707) | 0.83 (3286) | 0.75 (3888) | 0.71 (1519) | 0.60 (130) | _0.50 (29)_ | _0.56 (8)_ |  |  |  |  |  |  |  |
| Leadbetter Beach | 0.97 (78) | 1.09 (95) | 1.07 (123) | 1.07 (274) | 1.02 (587) | 0.92 (1463) | 0.82 (2865) | 0.75 (3520) | 0.73 (2919) | 0.73 (424) | _1.01 (8)_ | _1.33 (1)_ |  |  |
| Sands Beach | 0.93 (116) | 1.07 (147) | 1.18 (336) | 1.30 (777) | 1.15 (1788) | 0.87 (2688) | 0.64 (3583) | 0.55 (2601) | 0.54 (248) | _0.62 (6)_ |  |  |  |  |
| Rincon | 1.07 (107) | 1.07 (148) | 1.14 (335) | 1.09 (776) | 0.96 (2099) | 0.85 (2809) | 0.76 (3708) | 0.74 (2137) | 0.77 (158) | _1.20 (5)_ |  |  |  |  |
| Mondos | 0.96 (534) | 0.90 (719) | 0.83 (1608) | 0.75 (2582) | 0.72 (3531) | 0.70 (2930) | 0.70 (431) | _1.09 (9)_ |  |  |  |  |  |  |
| C Street Ventura | 0.92 (137) | 0.91 (182) | 0.92 (423) | 0.89 (1016) | 0.81 (2071) | 0.73 (2915) | 0.69 (3723) | 0.68 (1712) | 0.68 (93) | _1.01 (4)_ |  |  |  |  |
| Malibu First Point | 0.89 (94) | 0.89 (53) | 0.87 (89) | 0.87 (134) | 0.79 (242) | 0.71 (522) | 0.63 (1521) | 0.54 (2756) | 0.49 (4027) | 0.50 (2132) | 0.56 (166) | _0.52 (2)_ | _0.67 (2)_ |  |
| Zuma Beach | 0.95 (481) | 0.84 (523) | 0.74 (1058) | 0.67 (2122) | 0.62 (3551) | 0.60 (3471) | 0.63 (650) | _0.66 (13)_ |  |  |  | _0.77 (1)_ | _0.31 (6)_ | _0.59 (3)_ |
| Huntington Beach Pier | 1.01 (718) | 0.83 (805) | 0.72 (1464) | 0.66 (2773) | 0.63 (4030) | 0.63 (2128) | 0.70 (165) | _0.72 (1)_ |  |  |  | _0.75 (2)_ | _0.41 (1)_ | _0.36 (7)_ |
| Newport Point | 0.95 (543) | 0.74 (492) | 0.60 (1068) | 0.55 (2121) | 0.55 (4156) | 0.57 (3098) | 0.62 (428) | _0.62 (4)_ |  |  |  | _1.08 (1)_ | _0.32 (5)_ | _0.51 (4)_ |
| Trestles | 0.95 (848) | 0.81 (893) | 0.71 (1632) | 0.66 (2988) | 0.62 (4041) | 0.62 (1671) | 0.63 (100) |  |  |  | _0.97 (1)_ | _0.52 (1)_ | _0.66 (2)_ | _0.37 (6)_ |
| Blacks Beach | 0.79 (3208) | 0.85 (660) | 0.97 (407) | 0.97 (609) | 0.97 (631) | 0.90 (373) | 0.81 (138) | 0.76 (58) | _0.91 (7)_ | _0.68 (5)_ | _0.54 (6)_ |  |  |  |
| La Jolla Shores | 1.02 (159) | 1.03 (102) | 1.11 (58) | 1.15 (86) | 1.17 (186) | 1.20 (314) | 1.22 (534) | 1.20 (644) | 1.15 (511) | 1.09 (220) | 0.99 (84) | _1.03 (21)_ | _0.63 (4)_ | _0.41 (2)_ |
| Windansea | 0.76 (3208) | 0.83 (660) | 0.96 (407) | 0.95 (609) | 0.93 (631) | 0.88 (373) | 0.82 (147) | 0.78 (49) | _0.91 (7)_ | _0.67 (5)_ | _0.55 (6)_ |  |  |  |
| **chain f(dθ) now** | 0.88 | 0.83 | 0.77 | 0.70 | 0.63 | 0.60 | 0.60 | 0.60 | 0.60 | 0.60 | 0.60 | 0.60 | 0.60 | 0.60 |

### Pooled A per bin (count-weighted across spots; all hours, then swell-only Tp ≥ 10 s)


**all**

| bin | hours | spots | pooled A |
|---|---|---|---|
| 80-90° | 28769 | 19 | 0.732 |
| 90-100° | 26181 | 18 | 0.731 |
| 100-110° | 20219 | 18 | 0.736 |
| 110-120° | 16826 | 12 | 0.698 |
| 120-130° | 12675 | 10 | 0.673 |
| 130-140° | 9988 | 6 | 0.670 |
| 140-150° | 6760 | 5 | 0.696 |
| 150-160° | 6604 | 3 | 0.608 |
| 160-170° | 4917 | 2 | 0.566 |
| 170-180° | 860 | 2 | 0.578 |

**swell_Tp>=10s**

| bin | hours | spots | pooled A |
|---|---|---|---|
| 80-90° | 20430 | 19 | 0.745 |
| 90-100° | 16247 | 18 | 0.761 |
| 100-110° | 12926 | 18 | 0.755 |
| 110-120° | 10592 | 12 | 0.712 |
| 120-130° | 7818 | 9 | 0.696 |
| 130-140° | 6176 | 6 | 0.734 |
| 140-150° | 4989 | 5 | 0.738 |
| 150-160° | 3773 | 2 | 0.651 |
| 160-170° | 1726 | 2 | 0.595 |
| 170-180° | 226 | 2 | 0.590 |

## Spots whose served height would DROP under JAC-1

Every spot that ever sees swell beyond 90° of its chain normal would lose height. These numbers apply the taper to the
median beyond-90° dθ and compare with today's 0.595. The last column is what MOP says the factor should be at that angle.

| Spot | share of hours dθ>90 (chain normal / MOP normal) | median dθ when >90 | drop vs today at that dθ, E=120 | E=150 | E=180 | MOP A at that dθ (today 0.595) |
|---|---|---|---|---|---|---|
| Capitola | 86% / 87% | 153° | -100% | -100% | -70% | 0.69 (n=3115) |
| Steamer Lane | 86% / 87% | 148° | -100% | -97% | -65% | 0.65 (n=2996) |
| Pleasure Point | 83% / 86% | 125° | -100% | -59% | -39% | 0.65 (n=2958) |
| Leadbetter Beach | 79% / 48% | 114° | -80% | -40% | -27% | 0.75 (n=3520) |
| Malibu First Point | 78% / 66% | 123° | -100% | -54% | -36% | 0.49 (n=4027) |
| Sands Beach | 64% / 84% | 105° | -49% | -25% | -16% | 0.64 (n=3583) |
| Rincon | 62% / 1% | 105° | -51% | -26% | -17% | 0.76 (n=3708) |
| C Street Ventura | 59% / 84% | 103° | -45% | -22% | -15% | 0.69 (n=3723) |
| Zuma Beach | 29% / 9% | 95° | -17% | -9% | -6% | 0.60 (n=3471) |
| Newport Point | 25% / 69% | 96° | -18% | -9% | -6% | 0.57 (n=3098) |
| Mondos | 24% / 0% | 95° | -15% | -8% | -5% | 0.70 (n=2930) |
| La Jolla Shores | 16% / 16% | 115° | -84% | -42% | -28% | 1.20 (n=644) |
| Huntington Beach Pier | 16% / 41% | 93° | -11% | -5% | -4% | 0.63 (n=2128) |
| Trestles | 13% / 33% | 93° | -11% | -6% | -4% | 0.62 (n=1671) |
| Pacifica - Linda Mar | 8% / 11% | 102° | -39% | -19% | -13% | 0.83 (n=423) |
| Blacks Beach | 4% / 5% | 97° | -25% | -12% | -8% | 0.90 (n=373) |
| Windansea | 4% / 4% | 97° | -24% | -12% | -8% | 0.88 (n=373) |
| Ocean Beach SF | 3% / 2% | 95° | -16% | -8% | -5% | 0.76 (n=277) |
| Carmel Beach | 0% / 8% | 94° | -15% | -7% | -5% | 0.50 (n=29) |

The big losers are the wrapped-swell points and bays, which are exactly where the taper is wrong:
- **Capitola, Steamer Lane, Pleasure Point (Santa Cruz).** 83-86% of all hours sit beyond 90° of the chain normal: NW swell
  wrapping into a south-facing coast. At E=120 their typical day would serve **zero**; at E=180 it drops 39-70%.
  MOP keeps 0.65-0.69 there, which is above today's 0.595.
- **Malibu First Point.** 78% of hours, median dθ 123°. At E=120 it goes to zero. MOP gives 0.49, the one big spot below
  today's floor, but nowhere near zero.
- **Leadbetter, Rincon, Sands, C Street.** 59-79% of hours beyond 90°, median 103-114°. Drops of 45-80% at E=120.
  MOP gives 0.64-0.76.
- **La Jolla Shores.** 16% of hours. MOP AMPLIFIES there (A of about 1.2, Scripps/La Jolla canyon focusing), so any cut is in the
  wrong direction.
- Minor (median dθ of about 93-97°, so a 4-18% cut at the edge): Zuma, Newport Point, Mondos, Huntington, Trestles, Ocean Beach SF,
  Blacks, Windansea, Linda Mar, Carmel.

## Side findings worth acting on

1. **The chain's shore normals disagree with MOP's own `metaShoreNormal` by up to 37°** (Carmel 247 vs 284, Rincon 202 vs 233,
   Steamer Lane 154 vs 128, Sands 201 vs 173, C Street 204 vs 174, Leadbetter 189 vs 210, Newport 216 vs 196, Capitola 149 vs 130).
   That alone changes Rincon's share of hours beyond 90° from 62% to 1% and Newport's from 25% to 69%.
   Any angle-dependent change, JAC-1 included, is hostage to the normal. Fix or verify normals before tuning the tail.
2. **The chain is also too steep at 60-90° at many points and bays.** At 80-90° the chain gives 0.63; MOP pooled gives 0.73.
   Linda Mar, Rincon, Leadbetter, Steamer Lane and Pleasure Point stay at 0.9-1.0 there. The open, straight beaches
   (Huntington, Trestles, Newport, Zuma) track the chain closely (0.55-0.66), so the cosine shape is roughly right for straight
   coasts and wrong for points and bays. That is the refraction-versus-exposure distinction the `surf_transform.py` docstring warns about.
3. Even a constant floor is a poor description. The tail ranges from 0.49 (Malibu, 120-130°) to 1.2 (La Jolla Shores) by site.
   A per-spot or MOP-derived correction would beat any single global curve.

## Caveats (read before acting)

- **MOP is a model.** It is a linear spectral refraction/diffraction/island-shadowing model driven by these same CDIP buoys, not an
  observation. It is the best public physics reference for California, but it is not ground truth. It can miss nonlinear and
  sub-grid effects, and it can mis-place energy at very high obliquity.
- **Point depth, not breaking height.** MOP points sit at 10 m (15 m for the SC, MO and SM points used here), 0.1-2.9 km from
  the spot (Capitola 2.9 km, Pleasure Point 1.9 km). The ratio includes shoaling to that depth, but not breaking or the final
  wrap into the bay. Normalising by the head-on bin removes a constant shoaling factor, not a period-dependent one. The
  Tp ≥ 10 s variant is the check on that, and it gives the same answer.
- **Offshore direction is a buoy peak direction (Dp).** It is a single number for possibly bimodal seas, so a NW wind-sea peak
  can stand in for a coexisting S swell. That would make far-off-normal bins look less attenuated than a pure NW swell is.
  The Tp ≥ 10 s variant reduces but does not remove this. The buoy is also not at the chain's offshore grid point: 067p1 is
  inside the outer Bight and 157p1 is 70 km south of Santa Cruz. The chain's model offshore Hs/Dp would differ, especially
  for SoCal island shadowing, which MOP includes and the chain represents only through its exposure factor.
- **dθ uses the CHAIN normal**, because that is what the served factor sees. With MOP's normals the beyond-90° shares move a
  lot (side finding 1). The tail level does not depend on which normal you trust: no bin beyond 90° shows a collapse
  toward 0 at any spot with n ≥ 30.
- **Effective sample size is far below the hour count.** Samples are every 2 h and autocorrelated over days, so the
  "days" column is the honest unit (Santa Cruz spots have about 1,130 distinct days beyond 90°; Ocean Beach SF, Blacks and
  Windansea have fewer than 180). Three-plus years cover several winters and summers, but from only one hindcast product.
- Head-on reference sets (dθ < 30°) are well populated (n ≥ 425 at every spot, up to about 13,000 at La Jolla Shores). Capitola's is
  noisier (A > 1 at 50-80° suggests in-bay focusing, or a reference distorted by the 2.9 km offset).
