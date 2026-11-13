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

## 8. Wet-mask item measured by the Fable repair lead (2026-11-13 note)

Item 5 in section 0 is now measured, by a peer session (Fable repair lead, PR #852), using Open-Meteo `ncep_gfswave025` on the same native grid. Source: `docs/weather-program/log/2026-11-13-fable-strait-fallback.md` on branch `fable/strait-fallback` (not read by this session; reported in the message).

- All four corners of 46267 are land. The inner strait has no wet cell.
- Nearest wet cell is (48.5 N, 124.25 W), 0.729 degrees away at the strait mouth.
- Wet cells at 48.5 N run only from 125.25 to 124.25 W in the window 47.75–48.5 N, 125.25–123 W.

Implication for this note: the premise that GFS-Wave 0.25 has no wet cell at 46267 holds. Rule 3 (no open-ocean estimate) applies to 46267.

Limit of the peer's cap (#852): a reach cap (marine grids finer than 0.5 degrees: 1.5 cells, otherwise no data) gives the same outcome for 46267. It cannot separate sheltered points within 1.5 cells of water, such as 33 surf spots at 0.251–0.373 degrees (e.g. Inch Beach, Fort Point) and the Southern California Bight buoys. The exposure sweep in section 3 is what would separate those. The sweep is not built.

Agreed: NDBC 44090 is Cape Cod Bay, not Long Island Sound.

## 9. Sweep rule tested: rejected as written (peer measurement, 2026-11-13)

The Fable repair lead tested the section 3 rule (72 bearings, ETOPO 1 arc-minute bathymetry via NOAA ERDDAP `etopo180`, open = water of at least 200 m within 300 km before land, rays starting 3 km out). Source: `docs/weather-program/log/2026-11-13-fable-strait-fallback.md` on branch `fable/strait-fallback` (reported in its message, not read here).

- **46267:** 4 of 72 bearings open (arcs 45–50 and 290–295 degrees). The nearest 200 m water is 38 km away, inside the strait. The rule keeps 46267 open, which is the case it was meant to stop.
- **Surf spots the reach cap would drop:** Boca Barranca 9, Kells 2, Silverstrand 2, Salthill 1, Rossbeigh 1, Rathmullan 0, Bishopsquarter 0 open bearings. The rule rejects most of these.
- **Controls:** Inch Beach 5, Fort Point SF 12.
- **Causes:** (a) 200 m water is not open ocean inside a deep strait; (b) the Irish shelf puts 200 m water 87–208 km offshore, so the depth threshold does not separate shelf from open sea.

**Status:** section 3's depth and visibility criterion is refuted. Do not default-on it.

**What a revised rule needs (not yet built or tested):**
1. A source-depth criterion that separates ocean basins from shelves, for example a much deeper threshold or a shelf-break distance. The value must be tested, not assumed.
2. A channel-attenuation criterion, not a visibility criterion. Candidate: the fraction of open bearings through a gap whose width is small relative to swell wavelength, or a fetch-through-gap estimate. Either needs measurement on the 46267 window and the control spots before it is trusted.
3. Keep "no open-ocean estimate" as the default for points where the rule is inconclusive.

The enclosed-water question is therefore open. The reach cap (#852) remains the only tested gate.

## 10. Proposed channel-attenuation rule (pre-registered, not fitted, 2026-11-13)

Status: proposal only. Not fitted to any case, including the 46267 and spot measurements in section 9, which this author has not read. The thresholds below are assumptions with no cited source and must be set and frozen before anyone computes them on the test cases.

### What the sources support, and what they do not

- **Diffraction coefficients do not apply to the strait mouth.** Penney-Price and Ref/Dif models are validated for gaps smaller than about five incident wavelengths in constant depth (Wibowo et al. 2025, https://consensus.app/papers/details/w:13303093-0922-494c-8bc8-1db88ffa277d/ ). The Juan de Fuca mouth is tens of kilometres wide, far more than that for swell. Diffraction tables (Johnson 1951, https://consensus.app/papers/details/w:543abc50-eb96-4d6b-8920-f05b65497b6a/ ) are for breakwater gaps and tips. So a Penney-Price-type coefficient is the wrong proxy here. This is an inference from the gap-width condition.
- **Bottom friction is strong on rough shelves, not established for deep straits.** Measured friction factors of 4 to 34 on rocky shelves, with about 32 % of energy flux lost over 130 m (Gon et al. 2020, https://consensus.app/papers/details/w:14ba5634-e754-464c-b30b-6f01180f753d/ ; Marques et al. 2025, https://consensus.app/papers/details/w:3f87c5e2-527e-473b-b952-699e1d86b631/ ). These are shallow, rough shelves. A deep strait has weaker friction, so friction alone may not explain 1.5 m served against 0.2 m observed. This is a limit on the mechanism, not a measurement.
- **Narrow channels attenuate along their length.** Surge attenuation along a narrow channel depends on basin geometry and inlet width (Kiesel et al. 2024, https://consensus.app/papers/details/w:feedec21-628d-4b66-b51f-6b3c18842e0f/ ). Swell in fjords is strongly sheltered or exposed depending on geometry, and needs a phase-resolving model to capture (Wang et al. 2023, https://consensus.app/papers/details/w:e543d568-b946-436d-ad29-80205e182def/ ). These support a geometric proxy, not a specific coefficient.

### The proposed rule (corridor ratio)

For each point P with a valid land mask at about 1 km:
1. Flood-fill the water cells connected to P, stopping at deep water (depth of at least 1000 m, the assumed open-ocean source). Measure L = the shortest water path length from P to deep water.
2. Measure W = the narrowest cross-channel width along that path, taken as the minimum distance between opposite shores at points sampled every 1 km.
3. Compute R = L / W.
4. **Rule:** serve `nearest_ocean_fallback` only if R is below 2 **or** L is below 10 km. Otherwise return "no open-ocean estimate" and exclude the point from the accuracy monitor.

The thresholds 2 and 10 km are assumptions. The depth 1000 m is also an assumption.

### Why this rule, and not the sweep in section 3

The sweep asked whether any open ray reaches deep water, which a strait can pass. The corridor ratio asks how far the energy must travel through a narrow water path, which is the attenuation the peer's data point to. It is a geometric proxy, not a validated physical model. It does not model friction, refraction or breaking.

### Pre-registration (set before computing)

- Calibration: none. The thresholds are fixed as above.
- Test set: 46267 (window 47.75–48.5 N, 125.25–123 W), plus the seven spots the peer listed (Boca Barranca, Kells, Silverstrand, Salthill, Rossbeigh, Rathmullan, Bishopsquarter), plus the controls Inch Beach and Fort Point SF. Freeze this list before computing R.
- Pass: the rule gives "no estimate" for 46267, and "serve" for the controls and for at least five of the seven spots. Held-out spots must be named before the run.
- Fail: if the rule rejects more than two of the seven spots, or serves 46267, discard the corridor ratio and do not tune the thresholds to pass. Record the failure in section 9 and the log.
- Stop rule: a second fitted threshold is not allowed. Any change to 2, 10 km or 1000 m requires a new pre-registration.

### Not verified

- No computation has been run. Whether 46267 has R of at least 2 is unknown until the peer computes it on the ETOPO grid.
- Whether seven spots and three controls are enough to decide anything. Probably not on their own.
- The friction and diffraction arguments are inferences from the cited sources, not measurements.

### Sources

- Wibowo et al. 2025, Penney-Price and Ref/Dif1 through breakwater gaps: https://consensus.app/papers/details/w:13303093-0922-494c-8bc8-1db88ffa277d/
- Johnson 1951, Generalized wave diffraction diagrams: https://consensus.app/papers/details/w:543abc50-eb96-4d6b-8920-f05b65497b6a/
- Gon et al. 2020, Wave dissipation by bottom friction on a rocky shore: https://consensus.app/papers/details/w:14ba5634-e754-464c-b30b-6f01180f753d/
- Marques et al. 2025, Observations of wave energy dissipation by bottom friction on rocky shores: https://consensus.app/papers/details/w:3f87c5e2-527e-473b-b952-699e1d86b631/
- Kiesel et al. 2024, Surge attenuation along a microtidal channel: https://consensus.app/papers/details/w:feedec21-628d-4b66-b51f-6b3c18842e0f/
- Wang et al. 2023, Phase-resolved wave modelling in Norwegian fjords: https://consensus.app/papers/details/w:e543d568-b946-436d-ad29-80205e182def/

## 11. Corridor-ratio rule computed: FAIL, discarded (peer result, 2026-11-13)

The Fable repair lead computed section 10's rule on ETOPO 1 arc-minute, with no constant changed. Source: `docs/weather-program/log/2026-11-13-fable-strait-fallback.md` on branch `fable/strait-fallback` (reported in its message, not read here).

| Point | L (km) | W (km) | R = L/W |
|---|---|---|---|
| 46267 | 184 | 3.0 | 61 |
| Salthill | 230 | 2.0 | 115 |
| Silverstrand | 229 | 2.0 | 114 |
| Boca Barranca | 62 | 6.0 | 10 |
| Rossbeigh | 159 | 3.0 | 53 |
| Rathmullan | 169 | 2.0 | 85 |
| Bishopsquarter | 231 | 2.0 | 115 |
| Kells | 148 | 3.0 | 49 |
| Inch Beach (control) | 163 | 3.0 | 54 |
| Fort Point SF (control) | 65 | 3.0 | 22 |

**Result against the frozen criteria: FAIL.** Every point is rejected, including both controls and all seven spots. 46267 is rejected, but so is everything else. Section 10 says to discard the rule on this outcome. It is discarded. No threshold was tuned.

**Cause (per the peer):** the 1000 m depth criterion is 60–230 km from every test point, because the shelf is wide. So L measures the distance to the shelf edge, not to the strait mouth. The rule's source criterion is wrong, not just its thresholds.

**Width reading:** the peer took W as the shortest land-to-land chord along the shortest path, which prefers narrow passes. Section 10 left W open. The peer did not test a widest-path reading, and that would be tuning on the result. Any other reading needs a fresh pre-registration.

**Status of the enclosed-water question:**
- Section 3's exposure sweep: rejected (section 9).
- Section 10's corridor ratio: rejected (this section).
- The only tested gate is the reach cap (#852). It is coarse and cannot separate sheltered points within 1.5 cells.
- Default for unresolved points: "no open-ocean estimate," as section 3 proposed. This is a policy choice, not a validated result.

**Next, if pursued:** a new pre-registration with a source criterion that identifies the strait mouth (for example the mouth as a gap between headlands, or a regional-model truth), and a W reading fixed before computing. Do not reuse the 1000 m depth.
