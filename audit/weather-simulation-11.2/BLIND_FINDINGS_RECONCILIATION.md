# BLIND FINDINGS RECONCILIATION — 11.2

Written **after** the blind file was locked (SHA-256 `69DCAF8D…073715`). The blind file was not
edited. All corrections live here.

## A. Corrections to my own blind findings

| ID | Blind claim | Post-reconciliation status | What changed it |
|---|---|---|---|
| **BF-03** | "GFS and ICON have **no** regional tile for any marine layer; the whole planet is served at 10°" | ❌ **REFUTED for production.** Production carries **19,995** products with a three-tier ladder: `global_coarse` 10°, `global_mid` 2°, and **0.25°** across 16 regional tiles (azores, brazil_east, east_australia, florida_east_coast, france_biscay, hawaii, iberia_west, indonesia, mexico_centralamerica_pac, south_africa, uk_ireland, us_northeast, us_southeast_midatlantic, us_west_coast_socal). | One read-only GET to the production `/api/weather/products`. My local backend held 1,294 products — a partial ingest. |
| **BF-03b** | `upstream_provider: "open-meteo"` is a mislabel | ❌ **REFUTED for production.** Production reports `noaa` (GFS), `dwd` (ICON), `ecmwf` (EURO) correctly. The mislabel is a local-ingest artifact. | same |
| **BF-01 / BF-02** | Magnitudes: 10° vs 0.5°, 2.4× period difference | ⚠️ **MECHANISM STANDS, MAGNITUDE IS LOCAL.** Multi-tier product selection and value-changing swaps are real and were re-confirmed by the layer-cycle battery, but the specific 10°-vs-0.5° gap is a local artifact. Production magnitude is **unmeasured**. | same |
| **BF-04** | "The HUD fabricates NOAA" | ⚠️ **DOWNGRADED then RE-CONFIRMED on a different basis.** NOAA is legitimate (`source_dataset: ncep_gfswave025`). The confirmed defect is narrower and worse: the **Class** row is a one-bit function of `isEstimated` and stays green during fallback and total load failure. | `TruthOverlay.js:418`; failure injection |
| **BF-05** | "EURO selection never rendered" | ⚠️ **PARTIALLY LOCAL.** Local had no EURO product covering the Bahamas test centre. The *silent cross-model substitution* (`gfs_estimated_fallback` with no disclosure) remains confirmed. | production matrix |
| **BF-10** | Marine Anim Tuner occludes the weather controls | ⬇️ **DOWNGRADED to dev-only.** `MarineAnimTuner.js:51-60` gates rendering to `localhost`/`127.0.0.1`/`0.0.0.0` or explicit opt-in. Not shipped to production hostnames. | source |
| **BF-11** | Unbounded 401 polling on the map route | ⬇️ **Test-rig artifact.** Caused by the dev-mock token. Not a weather defect. | — |
| **BF-12** (new) | Leaving `/map` triggered logout + hard redirect | ⬇️ **Test-rig artifact**, but it **BLOCKED** the route-level remount test. | runtime |

**Findings that survived reconciliation unchanged:** BF-04 (Class logic), BF-06 (vacuous parity),
BF-07 (client drops `resolution`), BF-08 (global-extent fetch), BF-09 (cold-start timings and the
`Provider: UNKNOWN` + `AUTHORITATIVE NATIVE` window). These are **client-side logic**, independent
of which backend served them.

**Method lesson, recorded plainly:** I measured a data-coverage claim against a local backend and
was wrong. A local backend is a valid rig for *client logic* and an invalid rig for *data
coverage*. Any future audit must name the backend it measured on every data claim.

## B. Reconciliation with Report 11.1

| 11.1 claim | Status | Note |
|---|---|---|
| Verdict **ON TRACK WITH CORRECTIONS** | **Independently consistent** | My verdict differs because I tested a dimension 11.1 did not: runtime truth-reporting under failure. |
| "103 commits moved not one served forecast number" | **Confirmed but incomplete** | True of the physics chain. It cannot detect product-selection changes, which I measured moving the displayed value 0.64→0.44→0.64. A bit-identical physics A/B is blind to *which grid answered*. |
| Architecture convergence "Flat" | **Confirmed** | 10 commits since baseline, 2 code, neither touching composition authority. |
| Capacity is the weakest axis | **Not contradicted; not measured here** | Deliberately not tested — §4 forbids production load tests. |
| `run_census` caught mixed model runs in production | **Not re-tested** | Complements RC-01/RC-02: that instrument works; the parity/class instruments do not. |
| Deployed frontend `/map` → `/auth`, could not be driven | **Independently reproduced** | Resolved locally with a synthetic session; no credentials were entered. |
| 11.1 measured against **production** backend | **Material divergence from this audit** | See §A. |

## C. Where prior audits were incomplete (not wrong)

1. **No prior report injected a network failure and then read the truth overlay.** That single
   test produced the audit's decisive result.
2. **No prior report tested layer-round-trip value stability.** The physics A/B could not have
   caught it.
3. **The parity gate was treated as a passing guard.** It passes vacuously; its PASS carries no
   information when either side is unsampled.
