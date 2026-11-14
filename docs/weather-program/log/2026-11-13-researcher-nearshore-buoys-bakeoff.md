# 2026-11-13 · researcher · Nearshore buoys usable today, licences, and a coast-type bake-off design

**Director assignment (path step 3, "more nearshore truth beyond California").** Three parts: (1) buoys usable today with no
account, by coast type; (2) licence check for redistribution and commercial use; (3) a bake-off design with classes, minimum
buoys per class, metric and pre-registered thresholds.

**Docs only. Merge hold** until Codex lands #825 and #874. This log changes no code, no served number, no `SCOREBOARD.md` row.

**Status of each fact.** Verified = read in this session (NDBC station list, or a provider page in search). Unverified = a
gap, or only a secondary source. Water depth is **not** retrieved for any station here: the NDBC station list has only
coordinates. Depth has to come from `ndbc_get_station` (or the station page) before any station is put in a class.

## 1. Buoys usable today, no account (by coast type)

### 1.1 NDBC (NOAA). Verified station list, 438 active buoys, from `ndbc_list_stations`

Examples per coast type. Not a complete list.

| Coast type | Stations (ID, name, position) | Notes |
|---|---|---|
| Open Pacific, Pacific NW | 46005 West Washington (46.147N 131.077W), 46029 Columbia River Bar (46.148N 124.508W), 46041 Cape Elizabeth (47.351N 124.741W), 46089 Tillamook (45.928N 125.815W) | Open-coast exposure; the Washington and Oregon shelf |
| Open Pacific, Alaska | 46001 Western Gulf of Alaska (56.296N 148.027W), 46076 Cape Cleare (59.508N 148.005W), 46084 Cape Edgecumbe (56.614N 136.040W) | Storm-driven, very long swell; check data gaps |
| Sheltered / strait / inland sea (Pacific) | 46087 Neah Bay (48.493N 124.727W), 46088 New Dungeness (48.332N 123.179W), 46267 Angeles Point WA (48.171N 123.600W) | This is the strait class. 46267 is on HOLD (#852) |
| Sheltered / bay (Pacific NW inland) | 46118 Bellingham Bay (48.724N 122.576W), 46120 Pt Wells WA (47.761N 122.397W), 46123 Hood Canal Twanoh (47.375N 123.008W) | Puget Sound; inside the sampler's exposure problem |
| Open Atlantic, US NE shelf | 44008 Nantucket (40.500N 69.254W), 44011 Georges Bank (41.088N 66.546W), 44014 Virginia Beach (36.603N 74.837W) | Open shelf |
| Sheltered, US NE (LIS / Narragansett / Cape Cod Bay) | 44039 Central LIS (41.138N 72.655W), 44040 Western LIS (40.956N 73.580W), 44090 Cape Cod Bay (41.840N 70.329W), 44097 Block Island (40.966N 71.123W) | Enclosed-water class. 44090 is Cape Cod Bay, not LIS (#851 correction) |
| Gulf of Mexico, open | 42001 Mid Gulf (25.922N 89.638W), 42002 West Gulf (25.950N 93.780W), 42003 East Gulf (25.925N 85.616W) | Open-gulf exposure |
| Gulf, nearshore / bays | 42035 Galveston (29.235N 94.410W), 42019 Freeport (27.908N 95.343W), 42084 SW Pass LA (28.988N 89.649W) | Shelf and channel mouth |
| Puerto Rico / Caribbean islands | 41043 NE Puerto Rico (21.083N 64.853W), 41053 San Juan (18.474N 66.099W), 41056 Vieques (18.261N 65.464W), 41058 N St Thomas (18.476N 65.157W), 41115 Rincon (18.376N 67.280W), 41121 Arecibo (18.491N 66.701W), 42059 E Caribbean SSW Ponce (15.255N 67.621W), 42085 SE Ponce (17.870N 66.537W) | Island class. 41115 and 41121 near-real-time stale per section 12 |
| Hawaii | 51001 NW Hawaii One (24.475N 162.030W), 51002 SW Hawaii (17.070N 157.755W), 51003 W Hawaii (19.151N 160.617W), 51004 SE Hawaii (17.504N 152.197W), 51201 Waimea (21.671N 158.118W), 51202 Mokapu Point (21.414N 157.681W), 51205 Pauwela Maui (21.018N 156.421W), 51206 Hilo (19.779N 154.970W), 51207 Kaneohe Bay (21.477N 157.752W), 51211 Pearl Harbor (21.297N 157.959W), 51212 Barbers Point (21.323N 158.149W) | Island class. 51201 and 51211 and 51212 are the three in section 12 |
| Mid-Atlantic and Southeast, enclosed or sheltered | 44100 Duck FRF 26 m (36.257N 75.593W), 44056 Duck FRF (36.200N 75.714W), 44064 First Landing VA (36.998N 76.087W), 44072 York Spit VA (37.201N 76.266W) | Chesapeake and sounds; check exposure |
| Florida and Southeast nearshore | 41068 Fort Pierce FL (27.593N 80.189W), 41069 Ponce de Leon Inlet FL (29.289N 80.803W), 41113 Cape Canaveral nearshore FL (28.400N 80.533W), 41117 St Augustine FL (29.999N 81.079W) | Shelf, nearshore |
| Southern California (already in the sampler set; for reference only, not a new class) | 46025 Santa Monica Basin, 46222 San Pedro, 46254 Scripps nearshore, 46268 Topanga, 46266 Del Mar | Excluded from the bake-off per the director's "beyond California" brief |

**Licence (NDBC).** Not confirmed. The NOAA National Weather Service directive that covers redistribution and attribution is
an archived 2001 copy. It sets a framework with a non-commercial exemption. An ODI certificate assumes CC0 outside the US
but that is a publisher assumption, not NOAA's licence. Section 12.1 says "public domain (17 USC 105)" for US federal works;
that is the general rule for US government works, and it is what we rely on, but NDBC's own policy page was not found.

**Redistribution.** Unconfirmed. Attribution expected (NWS credit). Do not assume commercial redistribution.

### 1.2 CDIP outside California (via NCEI and PacIOOS)

- CDIP is the network behind PacIOOS Hawaii and the CARICOOS Puerto Rico records. NCEI archive records list CDIP
  (Coastal Data Information Program, SIO) as the source. Downloads are free, and the required citation is
  "Coastal Data Information Program, SIO (year)". Funded mainly by USACE. Accuracy warranty disclaimer. Source: NCEI
  accession records (search result, not opened).
- Hawaii via PacIOOS (Waverider, Datawell): Barbers Point 165 and 238, Pearl Harbor 233, Mokapu 098, Waimea and Kaneohe
  via PacIOOS wave buoy records. Station IDs match NDBC 51201, 51211, 51212, 51202, 51207 in section 1.1. Same buoy, two
  data paths. Pick one per buoy to avoid double counting.
- Alaska and Pacific NW: CDIP operates some buoys there, but no CDIP station ID for them was verified in this session.
- **Gap.** CDIP stations outside California and Hawaii were not enumerated. Use the CDIP station map before the bake-off.

### 1.3 PacIOOS Hawaii

- Source: PacIOOS ERDDAP at pae-paha.pacioos.hawaii.edu (search results; datasets not opened). Records on data.gov list
  PacIOOS buoys as 098, 165, 187, 202, 225, 233, 238, 239, 163 (Marshall Islands, Majuro).
- Hawaii is also covered by NDBC 51xxx (section 1.1). Use one per buoy.
- Depths: not retrieved.

### 1.4 IOOS regional associations (US)

**Not searched in this session.** The NDBC list already covers most US coastal buoys (including the OOI and some IOOS
regional sites). A separate IOOS regional enumeration is a gap for the bake-off. Do not treat its absence as "none".

### 1.5 Irish Marine Institute (Wave Buoy Network)

- **Station list not confirmed.** The ERDDAP tabledap call returned HTTP 400 earlier (section 12.3). The dataset is
  `IWaveBNetwork` on erddap.marine.ie (CC BY 4.0 per data.gov.ie).
- Galway Bay raw and Belmullet A/B (AMETS): data.gov.ie lists AMETS as CC BY 4.0 with 30-minute data from two directional
  waveriders. Galway Bay 1/4-scale raw has a conflicting clause (a Marine Institute Data Request Service agreement, not
  open access) alongside a later CC BY 4.0 entry. Use the IWaveBNetwork and AMETS records; do not use Galway raw until the
  Marine Institute confirms (datarequests@marine.ie).

### 1.6 Australian state and national networks (AODN, IMOS, researchdata.edu.au)

- **Licence:** data.gov.au wave-buoy records (near-real-time and the delayed national wave archive) say CC BY 4.0, with
  Commonwealth Coat of Arms exceptions. Contributors include Queensland DES, MHL (NSW), BOM and WA DOT.
- NSW MHL records (e.g. WAVEBYB, WAVESYD) need checking one by one; the snippets did not show an explicit CC BY licence for
  them. CSIRO Tasmanian Waverider records are CC BY 4.0 on researchdata.edu.au.
- Brisbane coastal wave data: CC BY 4.0 on researchdata.edu.au.
- **Depth and station list:** not retrieved. Enumerate from the AODN wave-buoy facility listing before any classing.

### 1.7 Other open networks (not checked in this session)

- Canada (DFO Pacific and Atlantic): the NDBC list also carries Canadian buoys, e.g. Atlantic 44137, 44139, 44150, 44258,
  44488, 44489, 44490 and Pacific 46145-46208. These are in the NDBC list, so they are already available.
  Their licence is Canada's open licence, unverified.
- Puertos del Estado (Spain), Cefas WaveNet (UK), Copernicus In Situ: section 12.3 and section 15 of the #851 log. Account
  needed for some (David's task, not this bake-off's no-account set).
- New Zealand (MetOcean/NIWA directional buoys): a researchdata.edu.au record for a directional buoy is listed as CC BY 4.0,
  but the station list was not enumerated.

## 2. Licence summary for redistribution and commercial use

| Source | Licence found | Redistribution | Commercial use | Status |
|---|---|---|---|---|
| NDBC (NOAA) | Public domain for US federal data (assumed); NWS attribution | Attribution expected; not confirmed | Not confirmed | Verify on NDBC policy page |
| CDIP via NCEI | Free download; citation required; warranty disclaimer | Citation required | Not stated | Verify CDIP terms |
| PacIOOS | Mixed: CC0 on some data.gov records, none on others, and one "not for legal use" wording on a CDIP-derived IOOS ERDDAP record | Unclear | Unclear | Contact PacIOOS |
| Irish Marine Institute IWaveBNetwork / AMETS | CC BY 4.0 (data.gov.ie) | Yes with attribution | Yes with attribution (CC BY allows) | Accept for IWaveBNetwork and AMETS only |
| Irish Galway Bay raw | Conflicting | Not until confirmed | Not until confirmed | Do not use yet |
| AODN / IMOS / researchdata.edu.au (most records) | CC BY 4.0 | Yes with attribution | Yes with attribution | Check per record; NSW MHL not confirmed |
| Puertos del Estado | 2021 manual: no third-party transfer, citation required | No | Not stated | Restrictive (section 12.5) |
| Cefas WaveNet | Tiered (OGL on fully downloadable; others restricted) | Per tier | Per tier; non-commercial not confirmed | Account question for David |
| Copernicus In Situ | CC BY (SEANOE mirror) | Yes with attribution | Free for commercial use (secondary) | Account question for David |

Rule for the repo (public): raw files stay out of git. Only derived metrics are committed, with source attribution.

## 3. Coast-type bake-off design (proposal, not run)

**Question.** Does a nearshore Hs estimate that respects the coast type (exposure sweep versus the current sampler) beat the
current sampler by class, and where does it not?

**Classes** (coast type, from the stations above):
1. Open coast, Pacific NW and Alaska (e.g. 46005, 46029, 46041, 46001, 46076).
2. Open coast, US Atlantic and Gulf shelf (e.g. 44008, 44011, 41001, 42001, 42003).
3. Enclosed or strait water (e.g. 46087, 46088, 44039, 44040, 44090). Excludes 46267 while #852 is on HOLD.
4. Sheltered bays and estuaries (e.g. 46118, 46123, 44064, 44072, 42084).
5. Island, Hawaii (e.g. 51201, 51202, 51211, 51212, 51205, 51206).
6. Island, Caribbean and Puerto Rico (e.g. 41043, 41053, 41056, 42085).
7. Atlantic, Irish and UK coast (IWaveBNetwork, AMETS; Cefas after the account question). Only if the Marine Institute list is confirmed.
8. Australia (AODN CC BY records). Only after per-station licence check.

**Minimum buoys per class: 3**, each with at least one full year of hourly Hs over the common window. Classes with fewer than 3
are reported as "not tested" and not scored.

**Metric.** Paired comparison per spot against the buoy, same time window, for each candidate (current sampler, exposure sweep).
- Hs bias and RMSE at +24, +48, +72 h. Primary: RMSE at +48 h.
- Paired difference per class: ΔRMSE = RMSE(sweep) − RMSE(current). Block bootstrap over days, 10,000 resamples, 95% CI.

**Pre-registered thresholds (set before running):**
- **Pass (per class):** ΔRMSE ≤ −0.05 m at +48 h, and the 95% CI excludes zero, with at least 3 buoys in the class.
- **Harm (any class):** ΔRMSE ≥ +0.05 m at +48 h with CI excluding zero means the sweep does not ship for that class.
- **Neutral:** anything else. No change. Reported as neutral.
- **Global:** ship only if no class is harmed and at least two classes pass.
- **Kill:** if the sweep increases the number of spots with no data by more than 1% of spots in any class, stop.

**Limits.**
- Depth is not yet recorded for any station. Classes are assigned from coast geometry in the list above, not measured depth.
- The current sampler's behaviour at a station depends on its grid (GFS 0.25° vs others). Keep the grid fixed per run.
- Two buoys share a source (CDIP vs NDBC for Hawaii). Count each physical buoy once.
- Nothing here changes a served number. Any sweep shipped later is ON with a kill switch under D-065, with its own pre-registration.

## 4. Open gaps before the bake-off can run

1. Enumerate CDIP stations outside California and Hawaii, and the AODN and Irish station lists (none confirmed here).
2. Water depth for each candidate station (`ndbc_get_station` or station pages).
3. NDBC and PacIOOS licence confirmation on their own pages.
4. IOOS regional association stations (not searched).
5. The Irish IWaveBNetwork station IDs (ERDDAP 400 earlier).
6. Merge hold: this draft waits for #825 and #874 (director's instruction).
