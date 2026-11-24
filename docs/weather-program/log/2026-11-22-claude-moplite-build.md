# 2026-11-22 claude-moplite-build: the MOP-lite offline package (DARK)

Session: Sonnet 5.5, branch `claude/nearshore-moplite-build`, cut from the gate branch `docs/gate-nearshore-moplite-v1`
(PR #1148, gated PASS at `9bddff0c2`; the branch carries the later seam-check commit `f3ab417a0`). Task from the
director session: build the offline "MOP-lite" transform exactly as registered, all DARK, no dispatch (David away).

## What was built (backend/services/weather_pipeline/nearshore_lite/)
| Module | What | Gate section |
|---|---|---|
| `dispersion.py` | linear dispersion, vectorised | 2 |
| `ray_trace.py` | backward ray tracing, 0.04-0.25 Hz x 0.01, 2 deg, step <= lambda/10, land = zero energy; E ratio `R = c_b Cg_b / (c_t Cg_t)` by Liouville | 2 |
| `spectrum.py` | JONSWAP gamma 3.3 / 1.0, cos^2s s = 20 / 4, variants S10 S40 G1 | 2 |
| `coefficients.py` | canonical-JSON per-target table, SHA256SUMS, `load_verified` (mismatch raises), partition apply, serving factor | 2 |
| `datum.py` | per-source conversion to MSL, records method and version, `DATUM_1M` when unresolved | 1a |
| `seam.py` | seam stats per join (overlap or across the join), `SEAM` tag, byte-stable table + sha256 | 1a |
| `bathy_compose.py` | finest-source composition, `FINE` / `COARSE` (GEBCO within 5 km) | 1, 4 |
| `freeze.py` | refuses to freeze without datum records and the committed seam table (its sha is written into every coefficient) | 1a |
| `scorer.py` | CHAIN/LITE/MOP/OFFSHORE rows, 7-day moving-block paired bootstrap (B 10,000, seed 20261122), Holm, F1/F2, pass rule, halves, California TOST, floors, null / height / direction plants, leak, hash refusal | 6, 7 |
| `archive.py` | immutable per-init archive + SHA256SUMS, missing-run rule | 5 |

Chain hook: `surf_transform.estimate_surf(..., lite_kr=None)` and `estimate_surf_partitioned(..., lite_table=None)`.
With the new flag `SURF_NEARSHORE_LITE` (GUARDED, default `"0"`, in `_RATING_FLAGS`, guardrail COVERAGE = BLIND) AND a
verified table, the per-partition factor replaces exactly `REFRACTION_KR` and the cosine exposure factor. Nothing else
in `estimate_surf` changes. Flag OFF is byte-identical (pinned). Offline: `scripts/nearshore_lite_fetch.py` and the
dispatch-only `nearshore-lite-bathymetry.yml` (dry run by default, stated size cap, allow-listed https hosts).

## Evidence
- Plane beach vs Snell's law (tests/test_nearshore_lite_ray_trace.py): boundary direction within 0.6 deg and energy
  ratio within 2% at 0.095-0.105 Hz, directions 250-292 deg; unidirectional Hs ratio equals Ks x Kr within 6% (the s = 20
  spread smears it); a land block shelters its bearing and no other; waves from the shore carry zero energy.
- Local run of the five new test files: 51 passed. No coefficient, archive or TEST row exists. No served number moves.

## Not built (honest list)
- The offline DRIVER from downloaded tiles to frozen coefficients: GeoTIFF/NetCDF read, resampling to the common local
  grid, running NOAA VDatum (needs the VDatum tool and its grids), the per-target tile list (gate section 9 open).
- Truth side: the NDBC / Copernicus / CDIP buoy list and fetch, the MOP forecast point lookup, the California `LITE_EC` arm
  input, `LITE_ETA`, the bathymetry-swap recomputation, the shelter-window (sheltered subset) geometry.
- The scheduled forward-archive workflow (module exists; a workflow needs David's word to dispatch).

## Amendment questions (for the advisor; none was resolved by me)
- **A1 seam trigger.** The registered gate triggers `SEAM` on p95 > 1.0 m only. The brief also names median > 0.3 m. I
  tag on p95 only and REPORT the median column with a flag at 0.3 m. Which is registered?
- **A2 serving form.** Gate section 2 says LITE gives Hs at the transfer point and the chain then shoals from the transfer
  depth. The brief says replace ONLY Kr and exposure inside `estimate_surf`. Built the latter: factor = table ratio /
  Ks(Tp, transfer depth), and the chain keeps shoaling to its own `depth_m` (the shelf median). These differ. Which?
- **A3 lateral exits.** A ray leaving the domain sideways in shallow water is not an offshore boundary. Rule used: it
  carries energy only if it left at h >= 0.25 x deep wavelength; otherwise zero ("truncated", reported). Gate silent.
- **A4 boundary.** Rays stop at deep water (h >= 0.5 x deep wavelength, local c and Cg) or the domain edge, not at "the
  wave-model grid point the chain already reads". A 0.25 deg grid point can be on land or at a different depth. Which?
- **A5 band edges.** Partitions with Tp < 4 s (f > 0.25 Hz) lose their tail. Ratio is taken on the in-band energy.
- **A6 shapes for swell under 10 s.** The gate gives s = 20 for swell with Tp >= 10 s and s = 4 for wind sea. A `swell`
  partition with Tp < 10 s is given the wind-sea shape (gamma 1, s 4). Confirm.
- **A7 integrator.** Forward Euler at <= lambda/10 and half a cell; direction error 0.03 deg on the plane beach. Is a
  higher-order step required before freeze?
- **A8 floors.** `FLOORS` in the scorer (75 inits, 10 blocks, 25 buoys, 4 per region, 6 sheltered, 3 California) copy
  section 6. A below-floor result is returned as `ok = False`, not as an automatic VOID exit code.
