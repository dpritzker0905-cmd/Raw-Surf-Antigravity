# Q3: Published skill of RTOFS vs GIOPS vs Copernicus GLO-PHY surface currents, by region; which should each picker serve? (research lead, 2026-11-22)

**Asked by:** the director, before the currents pickers are flipped on.

**What is wired today** (read from `ownRasterFrames.js` and `frame_set_raster*.py` on `dev`, 2026-11-22):
- Default for every picker: Copernicus `cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i`, uo/vo at 0.494 m, instantaneous, served as a 3 × 3 vector mean onto 0.25°, 6-hourly to 240 h.
- Per-picker overrides, all DARK:
  - ICON → ECCC GIOPS (0.2° lat-lon product, 0.5 m, 3 h mean, bilinear onto 0.25°);
  - GFS → NOAA Global RTOFS (its own lane);
  - EURO stays Copernicus.

**Second opinions (advisory, selected context only):** SubQ and Reflection, folded in below.

## Answer
**No published study ranks the three on the same drifters, by region.** The best independent evidence says the global systems are close.

So:
1. Copernicus GLO-PHY stays the default.
2. Each picker may serve its own named model, because the credit names it honestly.
3. **No picker is flipped ON as "better" until our own pre-registered drifter / HF-radar check passes.**

Choosing a source by its picker is a labelling decision, not a skill claim. Say so in the status line.

## The evidence
**1. The multi-system drifter intercomparison** [1] (Aijaz et al. 2023):
- Eulerian near-surface currents from several global operational systems, including Mercator (= Copernicus GLO-PHY), UK FOAM, BoM OceanMAPS and ECCC GIOPS, verified against drifters.
- Findings:
  - The systems are **statistically similar**.
  - Mercator, FOAM and OceanMAPS are marginally better.
  - **Adding Stokes drift significantly improves** agreement with drifters.
  - Adding tides had no global effect.
- RTOFS was not in the comparison we could read (abstract only; the full text returned 403).

**2. Copernicus' own quality report** (QUID 001-024, issue 1.3, May 2025, table 6, p. 10, VERIFIED from the PDF this session) [2].
- Metric: Lagrangian separation after 3 days against undrogued NOAA GDP hourly drifters (PARCELS), in km.

| Product | Global | Pacific south | Mid-latitudes | Pacific tropics | Equator | Gulf Stream | Shelf seas |
|---|---|---|---|---|---|---|---|
| GLO-PHY `uo/vo` (what we serve) | 42.7 | 40.5 | 42.3 | 44.3 | 60.2 | 61.6 | 36.4 |
| SMOC merged `utotal` (+ tides + Stokes) | 39.9 | 32.8 | 38.1 | 40.8 | **63.7** | 59.7 | **38.5** |

- **Key for a surf app:** SMOC is better in the open ocean but **WORSE on shelf seas** (38.5 vs 36.4 km/3 d) and at the equator. The QUID greys these cells as degradations.
- Our users look at coasts, so **keep plain `uo/vo` as the served field.** Do not switch to SMOC for the map.
- Caveat (Reflection): separation distance on undrogued drifters is a drift-skill proxy. It is not a direct Eulerian error.

**3. RTOFS (NOAA Global RTOFS, HYCOM 1/12°).**
- We found **no published global drifter intercomparison** against GIOPS or GLO-PHY.
- EMC verifies RTOFS through its EVS/METplus system [3]. NOAA's 2023 OceanPredict presentation lists ADCP, drifters and QC'd HF radar as its velocity truth, and names a Rutgers group verifying RTOFS with HFR and drifters in the Gulf of Mexico and Caribbean [4].
- One regional comparison (TOPVOYS 2021, Agulhas) found RTOFS the most reliable of the models it compared there [5].
- **Missing evidence is not evidence of worse skill (Reflection).** RTOFS stays a live regional candidate, especially on US coasts where HFR truth is dense.

**4. GIOPS.**
- It is in [1] and statistically similar to the others.
- It has no published regional advantage we could find.
- Its served product is coarser (0.2°) than GLO-PHY's native 1/12°.

## Red flags we found in passing
1. **We down-sample GLO-PHY.**
   - The 3 × 3 vector mean onto 0.25° throws away the 1/12° resolution that is GLO-PHY's main coastal advantage.
   - For a coastal product this probably matters more than the choice of model.
   - **Proposal:** a native 1/12° coastal tile set. That is a size and CPU question for the builder, not a research one.
2. **Nobody resolves the surf zone.**
   - None of these models resolves rip or longshore currents. Their 0.5 m currents are shelf-scale.
   - The legend should say "offshore surface current", so nobody reads them as surf-zone currents.

## Recommendation per picker (when flipped)
- **EURO picker → GLO-PHY `uo/vo`** (as today).
- **ICON picker → GIOPS** (credited "Canada GIOPS"). It is acceptable to flip because the label is honest and the published skill is similar [1]. It must not be presented as better.
- **GFS picker → RTOFS** (credited "NOAA RTOFS"). Same terms. On US coasts it is the candidate most likely to beat GLO-PHY regionally. Measure it there first.
- **The default across pickers stays GLO-PHY** until the check below says otherwise.

## The check before any skill claim (pre-registration outline; to write before data is read)
**Truth:**
- NOAA GDP hourly drifters (both drogued at 15 m and undrogued, reported separately);
- NOAA HFRNet US coastal HF-radar totals (public domain), 6 km product.

**Arms:**
- the three sources as served at 0.25°;
- plus GLO-PHY at native 1/12°, a reported arm that tests red flag 1.

**Metrics:**
- vector RMSE and speed ME at the valid time;
- 24 h Lagrangian separation;
- by region (US West, US East + Gulf, Hawaii, open ocean, equatorial band) and lead (day 1, 3, 5, 7).

**Statistics:**
- paired moving-block bootstrap, Holm;
- null control (an arm vs itself);
- planted controls: a +0.1 kn speed bias, and a +30° / +60° direction rotation;
- one scored look.

**Licences:** all clean.
- Copernicus Marine: free with attribution.
- RTOFS, GDP and HFRNet: US public domain.
- GIOPS: ECCC open data licence, with attribution.

## References
1. Aijaz et al. (2023). Verification and intercomparison of global ocean Eulerian near-surface currents. *Ocean Modelling* (abstract via Consensus, earlier in this programme; the ScienceDirect full text returned 403).
2. Copernicus Marine (2025). QUID for Global Sea Physical Analysis and Forecasting Product GLOBAL_ANALYSISFORECAST_PHY_001_024, CMEMS-GLO-QUID-001-024, issue 1.3, May 2025, table 6 p. 10. VERIFIED from a local copy of the PDF, 2026-11-22. System description in Lellouche et al. (2018), *Ocean Science* 14, 1093-1126, doi:10.5194/os-14-1093-2018.
3. NOAA EMC, RTOFS verification (EVS / METplus): https://emc.ncep.noaa.gov/users/verification/ocean_lake/rtofs/prod/main.php
4. Dukhovskoy (2023). Global RTOFS, OceanPredict OPST-8 presentation: https://oceanpredict.org/docs/Documents/OPST/Meetings/OPST-8-Nov-2023/Presentations/6.14-OPOS-RTOFS-DmitryDukhovskoy.pdf
5. TOPVOYS Progress Report 2021 (Agulhas model intercomparison): https://topvoys.nersc.no/sites/default/files/2022-05/topvoys_annual_progress_report_2021b.pdf
