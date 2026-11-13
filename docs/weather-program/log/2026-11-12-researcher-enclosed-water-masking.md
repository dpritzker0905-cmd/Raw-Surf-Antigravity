# Researcher note: points in enclosed waters and straits (2026-11-12)

Session: researcher (`sota-researcher-d837a9`), requested by the weather-simulation audit director
(`local_d6b521eb`), supporting the Fable lead (`local_ff1641e7`).
Scope: docs only. No code, no backend calls, no served numbers changed. Read-only science and data MCPs.

## 0. Limits and corrections (read first)

- **Station correction.** The request says 44090 is in the Long Island Sound set. NDBC lists 44090 as
  **Cape Cod Bay, MA** (41.84 N, 70.33 W; owner Woods Hole Group / NERACOOS). It is not in Long Island Sound.
  The Long Island Sound buoys nearest the basin are **44039** (Central LIS, 29 km from 40.95 N 72.90 W),
  **44040** (Western LIS, 57 km) and **44069** (Great South Bay, outside LIS). Checked with the NDBC MCP.
- **46267 confirmed as a strait buoy.** NDBC: Angeles Point, WA, 48.171 N 123.600 W, owner SCRIPPS, IOOS
  partners, met and currents. Nearest other stations: PTAW1 (Port Angeles, 13 km), 46088 New Dungeness (36 km).
- **Not verified: the wet-mask claim.** The request says GFS-Wave 0.25 degree has no wet cell at 46267. I did
  **not** confirm this. A `ww3_get_forecast_at_point` call on `wcoast.0p16` and on `global.0p25` at 48.171 N,
  123.600 W hung and was aborted by the MCP after about 30 minutes each. Verify the wet mask offline from the
  grid file, not by live calls.
- **No licence text fetched for the wave data at NDBC or CO-OPS.** The NDBC and CO-OPS policy pages were not
  retrieved. The USGS landing page returned HTTP 403 to WebFetch.
- **Consensus free tier returned 3 results per query.** Full-text reads of all papers were not done.
  Several claims below rest on abstracts only.
- **Reflection not consulted.** The request asked for Reflection. The Reflection tool is used only when David
  asks; the request came from a peer session, so I did not send anything there. Ask David if wanted.

## 1. What state-of-the-art systems do outside a global model's wet mask

Ranked by how directly each answers "point in a basin or strait that the global grid does not resolve".

**a. Subgrid obstacle parameterisation (the standard fix for "land in the cell").**
- Obstruction grids (Chawla et al. 2008) build per-cell transparency from a coastline dataset (GSHHS), include
  islands overlapping a cell and their orientation, and were validated on WAVEWATCH III swell through French
  Polynesia. [4]
- UOST (Mentaschi et al. 2018, 2020) separates dissipation of unresolved obstacles from energy advection, can be
  applied to any mesh, and modulates dissipation by direction. It is in the official WAVEWATCH III release, with
  alphaBetaLab estimating the transparency coefficients from bathymetry. [1][2][3]
- Gaffet et al. (2025) report that obstruction grids in tropical global WW3 cause **large negative biases** near
  volcanic islands, and move to an unstructured mesh down to 100 m. [5]
- Mody (2026, AtlanticWave, a single preprint-stage paper with no citations yet) uses a **satellite-calibrated
  direction-dependent correction** for unresolved sub-grid bathymetry, nested grids (28 km, 5 km, 500 m) and
  reports lower bias than NOAA WW3 at 12 NDBC buoys over four hindcast periods. Treat as a single-group claim. [6]

**b. Regional nests (the most common operational answer for straits).**
- A research SWAN model of the Salish Sea (unstructured, about 300 m within 30 km of shore), nested from a
  three-level WW3, found the Strait of Juan de Fuca has the largest waves and is dominated by Pacific swell.
  Mean absolute percent error in Hs was 8.6 % over 18 buoys. It is a hindcast, not a forecast. [11]
- NOAA's Salish Sea forecast (SSCOFS, Strait of Juan de Fuca subdomain) covers water levels, currents,
  temperature and salinity, **not waves**. [13]
- I found no operational nearshore wave forecast for the Strait run by NOAA, NANOOS or PSU. [11][13]
- Long Island Sound: no wave model or wave forecast product found. The NWS coastal waters zone ANZ335 gives
  text wave forecasts only. A circulation hindcast (NYHOPS-based, NOAA repository) exists but its licence was not
  read. [17][18]

**c. Fetch-limited and look-up-table estimates (use for local wind sea, not remote swell).**
- Crosby et al. (2023) combined fetch-limited, look-up-table and linear propagation in a large estuary. Errors
  were 10 to 20 % above full SWAN where local wind dominates; combining with linear propagation for remote swell
  stayed within 0 to 20 %. They conclude the boundary conditions (winds, offshore waves) are the dominant error
  source. [7]
- Bujak et al. (2023) show a calibrated ERA5-forced SWAN in fetch-limited basins matched buoys, but with an
  "alarming overprediction" of high Hs. [8]
- Pascolo et al. (2023) give fetch- and depth-limited growth curves depending on bed roughness. [9]
- Ricondo et al. (2023) downscale each spectral partition with linear propagation, valid only from offshore to
  intermediate depth. This is the relevant limit for a strait: linear propagation through a gap is valid only if
  the depth stays intermediate. [10]

**d. "No forecast" policies.** I found none written as a formal standard in these sources. NOAA and NWS give text
zone forecasts where no gridded product exists. [13][17] This is an inference, not a documented policy.

## 2. Open data for the Salish Sea and Long Island Sound, and licences

| Source | What | Licence / terms found | Status |
|---|---|---|---|
| NDBC 46267 (Angeles Point) | met + currents buoy, in strait | NOAA general: US government works are public domain (17 USC 105); attribution expected. NWS page: third-party content used under licence from the provider. NDBC's own data policy **not read**. | Verified station; licence partly verified |
| NDBC 46088 (New Dungeness) | buoy, 36 km from 46267 | as above | station verified |
| NOAA CO-OPS PTAW1 (Port Angeles) | fixed station | as above | station verified |
| NDBC 44039, 44040 (LIS) | buoys in Long Island Sound | as above | stations verified |
| USGS Regional Salish Sea modeled wave data (`10.5066/P14VOPEY`) | reanalysis-period and projected wave data at nearshore points, Salish Sea and Puget Sound, for CoSMoS; updated 2026-07-24 | catalog says `accessLevel: public`; **no licence or disclaimer stated** on the catalog page. Landing page 403. | Found; licence unresolved |
| NOAA SSCOFS (Strait of Juan de Fuca) | hydrodynamics only | NOAA general | no waves |
| NYHOPS-based LIS hindcast (NOAA repository) | circulation | not read | licence unresolved |
| NOAA Coast Survey data | hydrographic data | **CC0 1.0**, explicit | different office; not wave data |

Working licence reading for our use: NOAA buoy and CO-OPS data can be used internally and redistributed with
attribution, subject to any partner-supplied exceptions. This is inference from the NOAA library and NWS
disclaimer, not NDBC's own policy. The USGS wave dataset has no stated licence, so treat it as "public access,
terms unknown" until the USGS release page is read.

## 3. The smallest rule that stops open-swell leakage into an enclosed basin

**Important finding (my inference, check numerically before relying on it).** A single great-circle line test
from the open-ocean fallback cell to the point **refuses paths that are actually open**. For 46267, a straight
line from open water west of Cape Flattery to the buoy passes south of the strait mouth, over the Olympic
coast. The real route enters through the mouth between Cape Flattery and Port Renfrew. So "refuse if land is
crossed" alone would block the very swell the strait receives (the Salish SWAN study says it is dominated by
Pacific swell). [11]

So the rule should be an **exposure sweep**, not a line test:

1. Cast 72 bearings (5-degree steps) from the point against a land mask at about 1 km (GSHHS or the grid's own
   coastline).
2. A bearing is **open** if it reaches deep water (assumed depth 200 m or more) within 300 km without crossing
   land.
3. Serve `nearest_ocean_fallback` **only** for swell directions whose sector contains open bearings. If the
   swell-direction sector has none, return "no open-ocean estimate" and exclude the point from the accuracy
   monitor.
4. Thresholds (300 km, 200 m, sector width) are **my assumptions**, not literature values. Tune them on the
   nine buoys in the bad state, before default-on, and keep open-coast control buoys to show nothing else moves.

Why not a fetch cap alone: fetch is a proxy for wind sea. Swell arrives through a gap with long fetch in the
gap direction, which a single fetch number averages away. [7][8]

Why not a flat "no forecast" for every strait point: the Strait does receive real swell. A flat refusal would
hide a reduced but real signal. "No forecast" is the honest default for the monitor until a regional nest or a
reduced-transparency estimate is validated. [11]

**Repository rule check.** Any change to a served surf height runs through the one composition chain
(`surf_point.resolve_surf_geometry` then `estimate_surf_at`, then `compute_surf_rating`) and needs D-065
treatment: default-on, kill switch, history filter, and a `SCOREBOARD.md` row. A fallback gate is a served-number
change. It must not be a second forecast path.

## 4. Smallest pre-registered test

- Population: the nine buoys in the bad state, including 46267 and 44039 or 44040 as candidate strait/sound
  cases. Name the full list in the test file before running.
- Control: open-coast buoys whose nearest cell is wet. Their output must not change.
- Metric: Hs bias and Hs MAE at 24 h on NDBC observations, per buoy and pooled.
- Resampling: buoy-cluster bootstrap, 2,000 reps. Count clusters first; stop if fewer than five.
- Success: the gate removes the open-swell excess (about 1.5 m at 46267 per the director) without making any
  control buoy worse. Pass only if the 95 % interval for the change at the bad-state buoys is entirely below
  zero.
- Null: persistence and climatology, as in earlier notes.

## 5. Not verified

- GFS-Wave wet mask at 46267 (live call timed out; offline check needed).
- NDBC, CO-OPS and USGS licence wording (pages not read).
- Full text of Salish SWAN, Mody 2026, Gaffet 2025, Crosby 2023 (abstracts only).
- The 300 km, 200 m and 72-bearing values are assumptions.
- Whether any surf spots fall in this class (not counted here).

## Sources

1. Mentaschi et al. 2020, Assessment of global wave models on regular and unstructured grids using UOST, Ocean Dynamics. https://consensus.app/papers/details/w:400e8904-d4f8-4dd4-b2bf-f3d0d0362174/
2. Mentaschi et al. 2018, Parameterizing unresolved obstacles with source terms in wave modeling: a real-world application, Ocean Modelling. https://consensus.app/papers/details/w:42bd1147-9c2e-43c0-b66f-07c39105ccd4/
3. Mentaschi et al. 2018, alphaBetaLab, SoftwareX. https://consensus.app/papers/details/w:12b90cee-852e-4d70-83e4-dc0559481be8/
4. Chawla et al. 2008, Obstruction grids for spectral wave models, Ocean Modelling. https://consensus.app/papers/details/w:7a0616ff-02c6-4001-96b5-fca0ba98557a/
5. Gaffet et al. 2025, A new global high-resolution wave model for the tropical ocean using WAVEWATCH III v7.14, GMD. https://consensus.app/papers/details/w:850d5c89-8568-4547-986c-5711387b830a/
6. Mody 2026, Accelerated modelling of ocean waves (AtlanticWave), Transport Phenomena. https://consensus.app/papers/details/w:b9355b3d-3a95-4acd-8b38-15ebce6dd7ae/
7. Crosby et al. 2023, Efficient modeling of wave generation and propagation in a semi-enclosed estuary, Ocean Modelling. https://consensus.app/papers/details/w:45afe0f8-ba75-4636-92a1-76e62f059859/
8. Bujak et al. 2023, The Feasibility of the ERA5 Forced Numerical Wave Model in Fetch-Limited Basins, JMSE. https://consensus.app/papers/details/w:e5c1caef-42be-4244-b53c-0527513e9788/
9. Pascolo et al. 2023, New Fetch- and Depth-Limited Forecasting Curves Depending on Bed Roughness, Coastal Engineering Journal. https://consensus.app/papers/details/w:e3cae86e-77ce-4a96-aa4a-9586fe7ea1be/
10. Ricondo et al. 2023, HyWaves: Hybrid downscaling of multimodal wave spectra to nearshore areas, Ocean Modelling. https://consensus.app/papers/details/w:0f3a5e6c-6ddf-401a-aed2-74f7ae5d3626/
11. Salish Sea swell and wind-sea climate study (SWAN, nested WW3). https://www.sciencedirect.com/science/article/abs/pii/S0272771419301556 (full text returned 403; facts from search summary)
12. USGS, Regional Salish Sea modeled wave data. https://catalog.data.gov/dataset/regional-salish-sea-modeled-wave-data ; DOI https://doi.org/10.5066/P14VOPEY (landing 403)
13. NOAA, SSCOFS Strait of Juan de Fuca. https://tidesandcurrents.noaa.gov/ofs/sscofs/sscofs_straitjuan.html
14. NOAA Library, public domain / 17 USC 105. https://library.noaa.gov/blogs/news-research-highlights/question-of-the-quarter-noaacopyright
15. NWS disclaimer. https://www.weather.gov/disclaimer
16. NOAA Coast Survey data licensing (CC0 1.0). https://nauticalcharts.noaa.gov/data/data-licensing.html
17. NWS coastal waters zone ANZ335 (Long Island Sound West). https://marine.weather.gov/MapClick.php?zoneid=anz335
18. NOAA repository, Long Island Sound / NY-NJ hydrodynamic hindcast. https://repository.library.noaa.gov/view/noaa/24529/noaa_24529_DS1.pdf (licence not read)
19. NDBC station metadata via NDBC MCP: 46267, 44090, 44039, 44040, 44069, 46088, PTAW1 (queried 2026-11-12).
20. GFS-Wave grid list via WW3 MCP (`ww3_list_grids`): global.0p16, global.0p25, wcoast.0p16, epacif.0p16, atlocn.0p16, arctic.9km (queried 2026-11-12).

## 6. Reflection second opinion (Beam-1.0, medium effort, 2026-11-12)

Requested by David. Reflection's points, recorded as advisory:
- Weakest step: the sweep treats "open" as geometric reach to 200 m+ water within 300 km. That is line-of-sight, not propagation. It ignores refraction, diffraction, directional spreading, sills and shelves, and whether the deep water reached is a real source region.
- Failure modes: diffraction into geometrically blocked bearings; narrow gaps missed by a 1 km mask or 5-degree spacing; one open bearing overstating exposure; long-period swell needing fetch beyond 300 km; direction convention (from vs toward) flipping sectors.
- Power: nine bad-state clusters is likely underpowered. The "no control buoy worsens" condition is stringent. Use more buoys or windows, and a pre-specified non-inferiority margin for controls.
- Unverified (as in section 0): GFS-Wave wet cell at 46267; NDBC and USGS licence wording. If a wet cell exists at 46267, the fallback may not apply at all.

Action implied: treat the sweep as a hypothesis to test, not a settled rule. Add a sensitivity run for the 300 km and 200 m values, and a non-inferiority margin for control buoys, before default-on.

## 7. Follow-up research on Reflection's gaps (2026-11-12)

- **Diffraction is absent from standard spectral models.** Phase-decoupled refraction-diffraction was added to SWAN by Holthuijsen et al. (2003), and Doorn (1997) proposed a diffraction turning rate that made the model unstable in one form. Ilic et al. (2007) found the SWAN diffraction feature improved wave heights behind detached breakwaters, with swell behind breakwaters sensitive to beach reflection and transmission. Implication: a sweep that ignores diffraction can miss lee-side energy, so the gate must not be read as a physical zero. [consensus w:0d89e592, w:7c0cc5fb, w:8452fa09]
- **Spectral models underpredict channel penetration.** Dusseljee et al. (2014) found SWAN underestimates lee-side wave conditions in a navigation channel, especially for long waves at small angles, because tunnelling and evanescent modes are missing. Groeneweg et al. (2014) found SWAN underpredicts North Sea swell penetration into tidal inlets, pointing to nonlinear triad interactions. Implication: a fallback that refuses swell may be biased **low** for strait points, not only high. The gate needs a reduced-but-nonzero path or a "no forecast" flag, not a hard zero. [consensus w:452cf9d8, w:5e3f99c8]
- **Statistics.** Willmott et al. (1985) recommend bootstrap confidence intervals for model-comparison metrics, which supports the bootstrap plan above. It does not address small cluster counts. With nine buoys, use an explicit non-inferiority margin for controls, as Reflection suggested. [consensus w:e56d545c]
- **Pending.** Full text of all these papers was not read (abstracts only).

Revised rule implication: (a) keep the exposure sweep as a hypothesis; (b) treat "refuse" as biased low for strait swell; (c) prefer "no open-ocean estimate" over a zero or a fixed value until a regional nest validates penetration.

Sources added: Holthuijsen et al. 2003 https://consensus.app/papers/details/w:0d89e592-6f99-4a50-b5b1-08f62dbbb989/ ; Doorn 1997 https://consensus.app/papers/details/w:7c0cc5fb-ce8b-4561-8b2f-a09ea34cf1c3/ ; Ilic et al. 2007 https://consensus.app/papers/details/w:8452fa09-ce8e-490a-a1c8-a711c004b3b0/ ; Dusseljee et al. 2014 https://consensus.app/papers/details/w:452cf9d8-1d33-4397-b89e-77a5165d3392/ ; Groeneweg et al. 2014 https://consensus.app/papers/details/w:5e3f99c8-8488-4227-87bf-3e8c13e13432/ ; Willmott et al. 1985 https://consensus.app/papers/details/w:e56d545c-0920-4641-966a-4985a53ae889/
