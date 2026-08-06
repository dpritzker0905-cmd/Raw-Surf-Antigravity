# MASTER AUDIT 7.0 — 2026-08-06 · what shipped, and where we stand against the state of the art

**Every number here was measured or fetched in this session. Anything inherited is marked so.**
Predecessors: `MASTER-AUDIT-6.0` (state of truth at handoff) · `MASTER-AUDIT-5.0` (the reach audit).

---

## §0 THE ONE-LINE STATE

Production's **frontend** is still frozen at `3bd38a83` (2026-05-20) and is owner-gated. Everything
else moved: the CI estate lane now runs the 244 test files that ran nowhere, the E2E suite went from
8 hard failures to 1 environment skip, and the sim's window scan stopped hiding the one warning that
matters. Against the external state of the art we are **not behind on physics** — we are behind on
**resolution we already pay for** and **spread we already fetch**.

---

## §1 WHAT SHIPPED THIS SESSION

| commit | what | evidence |
|---|---|---|
| `10cb61c3` | E2E: the suite was 404-ing its own backend | route allowlist held only the site origin; 8/8 `/api/weather` 200 once fixed |
| `1d8277ff` | E2E: `/map` load gate 15 s → 45 s | failed on Mobile Safari + Firefox, passed on Chrome + Safari — a marginal bound |
| `bcdcfebd` | **CI estate lane** — 244 unclaimed test files now run | partition assertion; mutation-tested |
| `95e3bb14` | `pytest-timeout` declared | it was hand-installed locally and declared nowhere |
| `1e00bbcc` | quarantine + `MAY_BE_EMPTY`, floor corrected | lane's first run found 11 things |
| `5c6d7c9f` | **floor raised to the gate's own reading** (236) | CI reported 238 passed / 0 silent |
| `d9e1ffd3` | **sim: window scan publishes why it ranked, and the height caveat** | 5 new tests + control, mutation-proven |
| `3445767b` | E2E: WebGL **capability probe**, not a browser name | runner log "Failed to create WebGL context" ×6 |
| `3f340a8c` | slope census re-measured under the shipped γ ceiling | 4.1% → 100% saturation at Tp≥14 |

**Verified green:** CI on `3445767b` including the estate lane. E2E `42 passed / 5 flaky / 1 failed`
before the WebGL probe; the 1 was Firefox-without-WebGL and the 5 flaky were all Desktop Safari
across two unrelated specs.

---

## §2 THE EXTERNAL STATE OF THE ART, AND WHERE IT PUTS US

### 2.1 AI wave models — a belief we held was wrong, the conclusion survived

We closed the GPU/AI-weather branch on 2026-08-03 with the finding **"AIFS produces no waves."**
That is **refuted**. *Representing the Surface Ocean in ECMWF's data-driven forecasting system AIFS*
(**arXiv:2604.25559v1, 2026-04-28** — three months *before* we closed on the opposite claim):

* predicts SWH, mean period, mean direction, wave drag, **plus SWH split into six period bands >10 s**;
* **~10% lower medium-range SWH error than operational ecWAM ≈ one day of lead time**;
* trained on a 1979–2025 ecWAM + altimeter-DA hindcast at ~9 km; output ~0.25°;
* **no full spectra** (ecWAM carries 1,200+ spectral components per point).

★★★ **What I had actually checked was the open-data STREAM, and I wrote it down as a fact about the
MODEL. A distribution gap is not a capability gap.**

**The conclusion still holds, re-verified today:** Open-Meteo's marine API lists MFWAM, EWAM, GWAM,
ECMWF WAM (9 km and 0.25°), GFS Wave (0.25° and 0.16°) and ERA5-Ocean — **and no AIFS**. So it stays
closed on **availability**, which is exactly the kind of fact that expires. Re-check on every
Open-Meteo model addition.

### 2.2 Where the literature is — and why it does not indict our physics

The 2026 nearshore literature is converging on hybrid physics-ML: CNN-LSTM for SWH time series,
symbolic regression for interpretable transmission formulas, ML workflows reported as beating
global- and shelf-scale models for coastal conditions, and **YOLO+RF classifying breaker type
(plunging vs spilling) from video** — the same quantity our contested Iribarren classifier estimates
analytically. ECMWF is separately applying ML to *correct* physics wave-height forecasts.

**Contrast with our own audit history:** every recurring defect we have found has been **provenance
or composition, never physics** — an offshore height served as breaking, a private copy of the
transform, a config read standing in for a measurement, a disclosure dropped at one boundary. The
literature's frontier (learned nearshore transforms) is real, and our own ledger already names it —
but nothing in it says our γ, our shoaling or our refraction is the thing costing us accuracy.

### 2.3 Ensemble spread is the consensus answer, and we already fetch one

The probabilistic-wave literature is unambiguous: **ensemble spread correlates with deterministic
skill and is the standard way to express forecast uncertainty** (ECMWF's ECWAM ensemble diverges
purely through wind forcing; NOAA is extending probabilistic SWH to week 2). Our ledger row 3 says
we already fetch `ifs/waef` — **50 members, free** — and ship one number. **The external consensus
and our own biggest untapped item are the same item.**

---

## §3 THE FINDING WITH THE BEST LEVERAGE THIS SESSION

### We fetch the 25 km global model from a provider that publishes a 5 km one free

`backend/services/dwd_gwam_fetcher.py` pulls **GWAM** (global, ~0.25° ≈ 25 km) directly from
`opendata.dwd.de`, no auth. Listing that same endpoint today returns **three** models:

```
gwam/   global   ~25 km   <- the only one we use
ewam/   Europe   ~5 km
cwam/   coastal  finer still
```

**EWAM publishes exactly the layers we already consume** — `shts`/`mpts`/`mdts` (swell),
`shww`/`mpww`/`mdww` (wind wave), plus `swh`, `mwd`, `tm10`, `ppts`, `ppww`, `dd_10m`, `sp_10m`.
Neither `ewam` nor `mfwam` appears anywhere in `backend/services/`.

**Reach: 146 of 1,547 active spots = 9.4%** inside the EWAM box (30–66 N, 30 W–30 E) — Fistral,
Perranporth, Bude, Zarautz, Inch Beach, Anza, Cave. For a **nearshore** product, resolution at the
coast is the whole game, and this is a 5× step on the same code path.

⚠️⚠️ **FINER IS NOT AUTOMATICALLY BETTER, AND WE HAVE THE COUNTER-MEASUREMENT.** Ledger row 6
records `ecmwf` **losing to GFS at 36% of coverage** — "switch to the higher-resolution model" is
precisely the lever that has already failed here once. EWAM is a *different* model (DWD, not ECMWF)
and is **untested**. ⇒ **A paired buoy skill run first** — `services/weather_pipeline/forecast_skill.py`
already does exactly this against 59–60 buoys. Price it before building it.

---

## §4 CORRECTIONS THIS SESSION MADE TO OUR OWN RECORD

1. **`CLAUDE.md` said the sim is "height-blind".** Refuted by execution: at Pipeline, holding
   everything else constant, `0.5 m → 3.3 ft / 69.7` … `8 m → 30.6 ft / 57.0` … `12 m → 29.5 ft`.
   Four distinct quality values over a 24× height range. Control: 12 m reproduces **29.5 ft**, the
   exact post-fix figure for the shipped γ/refraction pair. The note outlived its falsifying commit
   (`0cae5d74`) by ~11 days, steering every session away from the sim.
2. **The v3.2 slope census was pinned to a ceiling we already changed.** Every figure in that block
   was taken at `GAMMA_MAX_STEEP = 1.25`; it has been `0.81` since the height pair shipped.
   Re-censused n=178: saturation **4.1% → 30.9 / 40.4 / 47.2 / 100.0%** at Tp 5 / 8 / 10.5 / 14 s.
   ★ **A census is pinned to the constant it was taken under.**
3. **The "+75.4% at Pipeline" blocker on wiring the real bed slope is void.** Under the current
   ceiling Pipeline moves **0.0%** at every period (proxy 0.0983 and bed 0.0301 both saturate 0.81).
   The residue is at 5–8 s wind chop (median 2.87% / 1.78%), which **inverts where it was thought
   to matter**. Queue item 7's "lower priority" verdict survives — now measured, not assumed.
4. ⚠️ **AND THE CONSEQUENCE NOBODY MEASURED:** at Tp ≥ 14 s, γ is pinned at 0.81 for **100%** of
   spots, so the slope term **no longer distinguishes anything at groundswell periods**. The point
   of v3.2 — "Pipeline breaks taller than a beach break in the same depth" — does not apply to the
   swell that matters most. That may be correct (0.81 is Carini's field-observed individual-wave
   maximum) but it is a **calibration decision** needing the primary source and a size A/B.
5. **A memory's `description` decays faster than its body, and it is what routing reads.** The
   precip zoom-bug's description still said "PROBE-BLOCKED — need `__RASTER_PROBE__.maxZ`"; its own
   body had superseded that weeks earlier (the probe parses `/z/x/y` tiles while precip `.om` URLs
   are single-file-per-valid-time, so `maxZ` is always 0). I acted on the description and was wrong.

---

## §5 THE QUEUE, IN JACOBIAN ORDER (leverage = sensitivity × uncertainty × reach)

| # | item | state |
|---|---|---|
| 1 | ⛔⛔⛔ **Unfreeze the production frontend.** `main--rawsurf` builds fine with a working `/api` proxy, and `3bd38a83` is the tip of **no branch** ⇒ a locked/pinned deploy or auto-publish off. One dashboard screen. | **OWNER** |
| 2 | **The exposure cliff / dual floor** — one swell angle producing two exposures (0.100 vs 0.595, 3.54×). Binds 21.6% of served spots. | ERA5-gated |
| 3 | **The free 50-member ensemble** — spread is what turns a forecast into a confidence, and it is the external consensus answer. Magnitudes retracted; **price before building**. | open, best untapped |
| 4 | **38% degraded geometry** — shore normal dominates (7.4 / 28.1). Better physics on degraded geometry will not land. | open |
| 5 | **EWAM 5 km for 9.4% of spots** — free, same endpoint, same layers. **Paired buoy skill run first.** | **new, cheap to price** |
| 6 | Disconnect Vercel — 8/8 prod + 6/6 preview fail; sole source of GitHub `deployment_status`. | OWNER |
| 7 | `RATING_LOCAL_SIZE` — GO on sanity, but 9.4:1 downward and a category error as a score multiplier. | OWNER decision |
| 8 | `RATING_BREAKER_TYPE` / bed slope — **measured negligible** at groundswell; residue at 5–8 s. | low, now for a reason |
| 9 | Unauthorized WebSocket connects hang instead of closing — 5 tests time out at 120 s on the runner. | spawned task |
| — | ✅ **CI orphan estate** — 244 files, partition-asserted, floor set from the gate. | **DONE** |
| — | ✅ **E2E** — 8 hard failures → 1 environment skip. | **DONE** |

---

## §6 WHAT "STATE OF THE ART" MEANS HERE, UNCHANGED AND NOW CORROBORATED

The 2026 literature does not say our physics is wrong. It says the frontier is **learned nearshore
transforms** and **probabilistic spread** — and our own ledger already names both. So the definition
stands:

1. **A number that says what it is** — breaking vs offshore, measured vs borrowed, hit vs miss.
2. **A quality with real dynamic range**, so a groomed 6 ft and a blown-out 6 ft differ.
3. **A spread, not a point** — which the free ensemble already offers and the literature endorses.
4. **Verified against instruments** — `forecast_skill.py` exists and says a free competitor is ~52%
   more accurate at the same buoys.
5. **Fast enough to explore.**

★ Every gap above is reach, provenance or composition. None of them is a missing equation.

---

## Sources (external, fetched 2026-08-06)

* Representing the Surface Ocean in ECMWF's data-driven forecasting system AIFS — arXiv:2604.25559v1
* AIFS — ECMWF's data-driven forecasting system — arXiv:2406.01465
* Improving the accuracy of global ECMWF wave height forecasts with machine learning — ScienceDirect
* Predicting coastal wave conditions: a simple machine learning approach — ScienceDirect
* Autonomous classification of wave breaker type in a large wave flume — ScienceDirect
* Probabilistic Wave Forecast for Week 2 and beyond, NOAA GEFS — WAF-D-24-0154.1
* ECMWF Forecast User Guide §8.1.5 Waves and wave meteograms; ECWAM model documentation
* Open-Meteo Marine Weather API model list; `opendata.dwd.de/weather/maritime/wave_models/`
