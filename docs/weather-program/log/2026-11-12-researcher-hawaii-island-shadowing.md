# Researcher: Hawaii and island-group swell direction (research design, docs only), 2026-11-12

Owner: researcher session (`local_d6b521eb` task "Weather simulation system audit", question set from the director).
Scope: literature, open-data and licence check, and a pre-registered test design. No code, no backend calls,
no served change, no flag. Ownership, per the director: move5 owns partition truth, move4 owns the height gap,
move3 owns instant frames, the Fable repair lead owns Safari flakes, the Opus lead owns account access.

## 0. The premise, checked

- PR #794 (`skill(S8/S7 v2)`, [dpritzker0905-cmd/Raw-Surf-Antigravity#794](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/794))
  is **merged** into `dev`, not a draft. Its log is `docs/weather-program/log/2026-11-11-claude-swell-direction-lane.md`.
- The Hawaii figure is in that log at line 66: hawaii (n = 994 key-hours, **6 buoys**): GFS 41.9 deg, EURO 42.1,
  ICON 62.5, equal consensus 43.8, **persistence 24.6**, climatology 32.2 (direction MAE, 24 h lead, 2026-10-19..11-09
  archive, offline, public data only).
- The log's own caveat (line 94): "hawaii is n = 6 buoys". Treat it as a hypothesis, not a finding.
- The six Hawaii buoys are not named in the log. NDBC stations within 400 km of Oahu (queried today,
  `ndbc_find_nearest_stations`): 51211 Pearl Harbor Entrance, 51210 Kaneohe Bay WETS, 51207 Kaneohe Bay,
  51212 Barbers Point, 51202 Mokapu Point, 51201 Waimea Bay, 51213 Kaumalapau (Lanai), 51205 Pauwela (Maui),
  51208 Hanalei (Kauai), 51WH0 WHOTS (open ocean, 121 km). Which six entered the S8 hawaii set is **unverified**;
  the list must be read from the S8 evidence file before the test is run.
- Several of these sit inside bays or harbours (51211, 51210, 51207). A buoy inside a bay is sheltered by design,
  so the bay buoys and the open-coast buoys are different populations. Any test must split them in advance.

## 1. What the literature says about Hawaii and islands

Sources were found with Consensus (3 results per query; the free plan cap) and latest-science. The latest-science
OpenAlex query timed out, so no arXiv or OpenAlex survey was completed; the list below is partial.

1. **Hindcast with island resolution, WW3 + SWAN nested.** Li et al. 2016, *Ocean Modelling*, 34-year Hawaii hindcast
   (WW3 basin, SWAN nearshore, CFSR and WRF winds), validated at 16 offshore and nearshore buoys. The authors report
   the hindcast "captures heightened seas in interisland channels and around prominent headlands, but tends to
   overestimate the heights of approaching northwest swells and give lower estimates in sheltered areas." This is
   the closest published match to our Hawaii result (a sheltering-driven error, in the same direction family).
   [Thirty-four years of Hawaii wave hindcast from downscaling of climate forecast system reanalysis](https://consensus.app/papers/details/w:0691cd23-a10f-4984-ae07-586d1a9627da/?utm_source=claude_code)
   (Li et al., 2016, 68 citations).
2. **Refraction of long-period swell into bays.** Hoeke et al. 2011, *JGR*, Hanalei Bay (Kauai). Long-period distant
   swell is "preferentially refracted into the bay"; the phase-averaged model did worse for episodic swell than for
   modal trade-wind waves. Relevant to the open-coast-versus-bay split above.
   [Hydrodynamics of a bathymetrically complex fringing coral reef embayment](https://consensus.app/papers/details/w:11a2aabf-a191-47e1-87fd-720bbae2218d/?utm_source=claude_code)
   (Hoeke et al., 2011, 67 citations).
3. **Phase-resolving models at Haleiwa (north shore Oahu).** Azouri et al. 2024, *Coastal Engineering*: three weakly
   dispersive models agree with reef-transect and harbour observations for energetic swell. Relevant only as a
   research-grade nearshore reference; not an operational transfer.
   [Computations of energetic nearshore waves](https://consensus.app/papers/details/w:7defc089-cee9-4db2-b33d-8fc409e7ae9e/?utm_source=claude_code)
   (Azouri et al., 2024, 5 citations).
4. **Subgrid islands: Tolman 2003.** Unresolved islands are the main local error source in global WW3; the method
   borrows the SWAN treatment and gives "a local but dramatic impact on model errors" in a one-year global hindcast.
   [Treatment of unresolved islands and ice in wind wave models](https://consensus.app/papers/details/w:f112bd71-d75a-4ff6-87d6-d128068c169c/?utm_source=claude_code)
   (Tolman, 2003, 209 citations).
5. **Obstruction grids.** Chawla et al. 2008 build obstruction grids from GSHHS coastlines and validate them on a
   swell crossing French Polynesia at 2' to 30' resolution: the lower-resolution grids reproduce the attenuation
   pattern behind the islands.
   [Obstruction grids for spectral wave models](https://consensus.app/papers/details/w:7a0616ff-02c6-4001-96b5-fca0ba98557a/?utm_source=claude_code)
   (Chawla et al., 2008, 89 citations).
6. **Directional unresolved-obstacle dissipation (UOST).** Mentaschi et al. 2020, *Ocean Dynamics*. UOST modulates
   dissipation by wave direction and cell geometry, is in the official WW3 release, and comes with the alphaBetaLab
   package for estimating parameters. Reported gains are largest "in wide areas characterized by the presence of
   islands, like the whole central-western Pacific Basin." This is the most direct answer to our question: a
   direction-dependent sheltering term, not a flat obstruction.
   [Assessment of global wave models on regular and unstructured grids using UOST](https://consensus.app/papers/details/w:400e8904-d4f8-4dd4-b2bf-f3d0d0362174/?utm_source=claude_code)
   (Mentaschi et al., 2020, 22 citations).
7. **Tropical unstructured global WW3 with islands explicit.** Gaffet et al. 2025, *GMD*: WW3 on a global
   unstructured grid from 50 km to 100 m, ERA5 winds with a quantile correction, islands represented explicitly, and
   direct comparison with in-situ data at 10 to 30 m depth on volcanic islands. Argues obstruction grids give
   "large negative biases" in the tropics.
   [A new global high-resolution wave model for the tropical ocean using WAVEWATCH III v7.14](https://consensus.app/papers/details/w:850d5c89-8568-4547-986c-5711387b830a/?utm_source=claude_code)
   (Gaffet et al., 2025, 17 citations).
8. **UOST on a reef-bounded coast.** Dong et al. 2025, *GMD*: UOST on the Great Barrier Reef cut the wave-height bias
   from above 100% to below 20%, showing that a subgrid obstacle term can be transferred to a new coast.
   [Numerical simulations of ocean surface waves along the Australian coast](https://consensus.app/papers/details/w:7142cb0e-9a2b-4d61-9af7-5c4a5e38f137/?utm_source=claude_code)
   (Dong et al., 2025, 6 citations).

**Answer to question (1), state of the art for islands:** the operational route is subgrid obstruction or sheltering
inside WW3 (Tolman 2003, Chawla 2008, now the directional UOST of Mentaschi 2020), with unstructured meshes for
the tropics (Gaffet 2025). Nested SWAN nearshore runs exist for Hawaii (Li 2016). The published Hawaii evidence
matches our observation: the 0.25-degree global grid cannot represent island shadowing, and the error sign is
sheltering-dependent. Nothing found says the PacIOOS Hawaii runs use UOST; that is **unverified** and needs the
PacIOOS model documentation.

## 2. Open data and licences (question 2)

| Source | What it is | Licence / terms found | Status |
|---|---|---|---|
| PacIOOS WW3 Hawaii Regional (`ww3_hawaii`) | Regional WW3 run, served on PacIOOS ERDDAP | Catalog gives ERDDAP/OPeNDAP access, publisher PacIOOS, distributor UH Manoa; a warranty disclaimer; no clear use licence found. The sister Mariana record says free use and redistribution but "not intended for legal use". | **Licence unresolved.** Check the PacIOOS terms before any ingest beyond internal research. Attribution: PacIOOS asks to be contacted for publications. |
| PacIOOS ERDDAP (`pae-paha.pacioos.hawaii.edu/erddap`) | Hawaii WW3, SWAN-style NEOWAVE inundation runs, Mariana, Samoa | Dataset list checked today: `ww3_hawaii`, `ww3_hawaii_lon180`, `ww3_global`, and NEOWAVE tsunami and inundation sets (not wave direction at buoys). | Available. Open question whether any is an unstructured or UOST run. |
| CDIP / Scripps MOP nearshore | Buoy and model output, California-centric; Hawaii buoys exist | No official CDIP licence statement found. Buoy data is listed as publicly available through NCEI. MOP model files ask for attribution to CDIP, USACE support, and O'Reilly et al. 2016. One THREDDS hindcast file carries a permissive attribute; not generalised. | **Licence unresolved** for MOP output. Check cdip.ucsd.edu data policy. Hawaii MOP coverage **not checked**. |
| NDBC buoys (`ndbc_*` MCP) | Offshore and bay buoys, spectra | NOAA public domain (standard; not re-verified in this session). | Usable as truth. |

Latest-science searched no licence source. The licence findings above come from catalogue text and search
snippets, not from the full terms pages. Verify before any redistribution.

**Answer to question (2):** an open, ingestable nearshore transfer for Hawaii equivalent to MOP was **not found**.
The usable open inputs are the PacIOOS WW3 Hawaii ERDDAP series (a model, so a second model to compare against,
not a truth) and NDBC buoys (truth). MOP is the California analogue; a Hawaii MOP-style transfer was not located.

## 3. Pre-registered test (question 3), the smallest useful one

**Question.** Does the island-shadowing explanation predict a sign pattern in direction error that the 0.25-degree
global models cannot produce, and does that pattern hold across exposure classes?

**Population (fixed before any new read).** Hawaii NDBC buoys with MWD and spectra in the S8 window (2026-10-19 to
2026-11-09, to be confirmed from the S8 evidence file), split **in advance** into two classes:
- *exposed*: open-coast or offshore buoys (candidates: 51201 Waimea, 51213 Lanai, 51205 Maui, 51208 Hanalei, 51WH0);
- *sheltered*: bay or harbour buoys (51211 Pearl Harbor, 51210 and 51207 Kaneohe Bay; 51202 Mokapu and 51212 Barbers
  Point to be classed when the geometry is read).
Class assignment is by geography, written here, and not revised after seeing errors.

**Primary hypothesis (H1), stated before the test.** At 24 h, for the exposed class, the equal consensus has a larger
circular direction MAE than persistence (repeating the last buoy reading). This is the S8 result; H1 asks whether
it holds on an exposed-only set, which is the population the shadowing story predicts it should hold for.
Null (H0): consensus MAE equals or beats persistence on the exposed class.

**Secondary (exploratory, not a decision):** signed circular bias by class; sheltered-class MAE.

**Statistic and rule.** Paired per (buoy, valid hour, lead). Per-buoy mean difference (consensus minus persistence),
then the buoy-cluster bootstrap (resample buoys, 2,000 reps, as in the S8 log). Decision: H1 is supported if the 95%
interval lies entirely above zero. With five exposed buoys the interval will be wide; that is reported, not hidden.

**Power, stated honestly.** Six buoys (or five exposed) is far too few for any reliable interval. The test is
therefore a **minimum-viable check**: it can refute H1 cheaply, and it cannot confirm it. A confirmed result needs
more buoys (the Hawaii NDBC set within 400 km is about ten; the S8 window has to be extended, not just re-cut).

**Truth caveat.** Truth is the offshore or bay buoy. The test measures model error at the buoy, not nearshore spot
error. It says nothing about spots until a transfer is in place (out of scope here).

**Kill or stop rules.** If the exposed-class interval includes zero, record H1 as not supported at n = 5; do not
add buoys to rescue it. If the sheltered class shows the same sign, the explanation is not shadowing specifically and
the test is stopped.

## 4. Next steps (not done here; each needs its owner's word)

- Read the six-buoy list from the S8 evidence file (`docs/weather-program/evidence/2026-11-11-s8-direction-period/`).
- Check the PacIOOS and CDIP terms directly before any ingest.
- If the test is run, run it offline on public archives, as S8 was, and log it in the append-only ledger.
- A directional sheltering term (UOST-style) would be a dark flag with a kill switch, under the D-065 rule; that is
  code and is out of scope for this session.

## 5. Not verified

- The six S8 Hawaii buoys (names not in the log).
- PacIOOS UOST or unstructured mesh use (no documentation read).
- Licence terms for PacIOOS ww3_hawaii and CDIP MOP (catalogue and snippet text only).
- Hawaii MOP coverage (not searched).
- Full literature survey (latest-science OpenAlex timed out; arXiv returned nothing for the MOP query; Consensus
  returned 3 results per query).

## Sources

- [Li et al. 2016, Hawaii hindcast](https://consensus.app/papers/details/w:0691cd23-a10f-4984-ae07-586d1a9627da/?utm_source=claude_code)
- [Hoeke et al. 2011, Hanalei Bay](https://consensus.app/papers/details/w:11a2aabf-a191-47e1-87fd-720bbae2218d/?utm_source=claude_code)
- [Azouri et al. 2024, Haleiwa](https://consensus.app/papers/details/w:7defc089-cee9-4db2-b33d-8fc409e7ae9e/?utm_source=claude_code)
- [Tolman 2003, unresolved islands](https://consensus.app/papers/details/w:f112bd71-d75a-4ff6-87d6-d128068c169c/?utm_source=claude_code)
- [Chawla et al. 2008, obstruction grids](https://consensus.app/papers/details/w:7a0616ff-02c6-4001-96b5-fca0ba98557a/?utm_source=claude_code)
- [Mentaschi et al. 2020, UOST](https://consensus.app/papers/details/w:400e8904-d4f8-4dd4-b2bf-f3d0d0362174/?utm_source=claude_code)
- [Gaffet et al. 2025, tropical unstructured WW3](https://consensus.app/papers/details/w:850d5c89-8568-4547-986c-5711387b830a/?utm_source=claude_code)
- [Dong et al. 2025, GBR UOST](https://consensus.app/papers/details/w:7142cb0e-9a2b-4d61-9af7-5c4a5e38f137/?utm_source=claude_code)
- [PacIOOS ERDDAP](https://pae-paha.pacioos.hawaii.edu/erddap) (datasets listed via erddap MCP)
- [WW3 Hawaii Regional, IOOS catalog](https://data.ioos.us/dataset/wavewatch-iii-ww3-hawaii-regional-wave-model) (search snippet)
- [WW3 Mariana, IOOS catalog](https://data.ioos.us/dataset/wavewatch-iii-ww3-mariana-regional-wave-model) (search snippet)
- [PacIOOS NWHI wave forecast page](https://www.pacioos.hawaii.edu/waves/model-nwhi/) (search snippet)
- [CDIP THREDDS, MOP-related files](https://thredds.cdip.ucsd.edu/thredds/ncml/cdip/model/misc/GFS/BP101_gfs.nc) (search snippet; licence attribute on one file only)
- S8 lane log in repo: `docs/weather-program/log/2026-11-11-claude-swell-direction-lane.md` (line 66, the Hawaii row)
- NDBC stations: `ndbc_find_nearest_stations` MCP, queried 2026-11-12
