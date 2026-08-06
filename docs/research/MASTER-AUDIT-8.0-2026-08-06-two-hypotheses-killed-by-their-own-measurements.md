# MASTER AUDIT 8.0 — 2026-08-06 · two of my own hypotheses, killed by their own measurements

**Everything here was measured this session.** Predecessor: `MASTER-AUDIT-7.0` (state of the art
compared) · `6.0` (state of truth) · `5.0` (the reach audit).

---

## §0 THE HEADLINE

I proposed EWAM (5 km) as the best-leverage upgrade in Audit 7.0. **The skill run I wrote to justify
it killed it.** GFS at 25 km — the incumbent, the coarsest model in the test — is the most accurate,
at 8 of 13 buoys. That is the **second** time this repo has measured "switch to the finer model" and
lost. The lesson is now a rule: **"higher resolution" is a hypothesis, never a reason.**

The ensemble (item 3) went the other way: **priced, affordable, and most of the build already
exists.**

---

## §1 ITEM 5 — EWAM: **CLOSED, NO-GO**

Paired against NDBC buoys inside the EWAM domain. Same coordinate, same ISO hour matched off each
model's own `time` array (never by array index), and a cell counted **only** if all four models and
the buoy had a value — so every MAE below is over an identical set.

**n = 324 paired cells · 13 buoys · ~48 h · 0 partial**

| model | MAE | bias | p90 \|err\| | max \|err\| | wins % | buoys won |
|---|---|---|---|---|---|---|
| EWAM 5 km | 0.306 | +0.272 | 0.720 | 1.220 | 23.8% | 2 |
| MFWAM 8 km | 0.249 | +0.204 | 0.540 | 0.880 | 32.1% | 3 |
| GWAM 25 km | 0.294 | +0.260 | 0.640 | 1.140 | 7.7% | **0** |
| **GFS 25 km** | **0.210** | **+0.179** | **0.440** | **0.840** | **36.4%** | **8 of 13** |

**EWAM is 46% worse than GFS on MAE**, with a systematic **+0.27 m high bias**. The ranking is
**stable** — GFS best at 8 of 13 stations, not one lucky hour (the one-hour version ranked identically).

⭐⭐ **A finding I was not looking for: GWAM is best at ZERO of 13 buoys** — and `dwd_gwam_fetcher.py`
is our **ICON-marine lane**. That deserves a wider census before we keep trusting it.

⚠️⚠️ **THE LIMITS, STATED SO THIS IS NOT OVER-QUOTED.** 13 buoys in ONE region (North Sea / Channel /
Norwegian Sea) over ONE 48-hour window — 324 cells are **not** 324 independent samples. All four
models share a **+0.18 to +0.27 m high bias**, and four independent models agreeing makes that more
likely an **observation-side or regional-window** property than a model one. And this is a
**nowcast agreement census, not a forecast skill score**: `forecast_skill.py` ledgers +24/+48/+72 h
and needs days of accrual. Quote it as that or not at all.

**Cost of finding out: one script, ~10 minutes.** That is the whole argument for pricing first.

---

## §2 ITEM 3 — THE FREE 50-MEMBER ENSEMBLE: **PRICED, AND AFFORDABLE**

`https://data.ecmwf.int/forecasts/<YYYYMMDD>/00z/ifs/0p25/waef/<...>-<step>h-waef-ef.grib2`
carries a `.index` giving `_offset`/`_length` per (member, param) ⇒ **HTTP range requests**, so the
500 MB file is never downloaded whole.

| what | size |
|---|---|
| whole step — 13 params × 50 members | **501 MB** ⛔ never fetch whole; the serve box OOM-killed at 1,579 MB |
| `swh`, all 50 members, range-requested | **40.7 MB / step** |
| `swh`, **10 members** | **8.1 MB / step** ← the viable build |

**50 members confirmed (1–50).** A spread estimate does not need all of them.

⭐⭐⭐ **AND THE PARAMS ARE RICHER THAN WE HAD RECORDED.** The stream carries
`h1012 h1214 h1417 h1721 h2125 h2530` — **SWH decomposed into six period bands** (10–12 … 25–30 s) —
plus `swh mwp mwd pp1d mp2 cdww wmb`. That is the **same decomposition AIFS Waves offers**, free,
at 50 members. Our note "ECMWF WAM has no partitions" is true of **directional** partitions and
misses this entirely.

✅ **AND MOST OF THE BUILD EXISTS.** `services/weather_pipeline/period_bands.py` already converts
those band heights into the `{h, tp, dir, kind}` partition shape, and
`point_surf_augment.py:147` already calls `bands_to_partitions`. The ensemble work is **50 members
through an existing decoder**, not a new one.

⛔ **STILL UNVERIFIED: the decoded VALUES.** v4's decoded metre figures were retracted. Pricing is
archaeology; magnitudes need a decode against a known field before anything ships.

---

## §3 THE LIVE PRODUCT STATE, MEASURED THIS SESSION

`/api/weather/spot-ratings`, **n=200, `source: precomputed`, frame 2026-08-06T04:00:00Z, GFS**:

| measure | value | vs the ledger |
|---|---|---|
| geometry `full` / `degraded` / `blind` | 123 / **76 = 38.0%** / 1 | **identical to 2026-08-03 — three days, no movement** |
| limiter | `size_gate` 86 · **`swell_exposure` 57 (28.5%)** · `wind_period_blend` 55 · `period_gate` 2 | exposure was 21.6% |
| `directional_conflict` present | **54/200 = 27.0%** | was 17.3% (08-05, wider viewport) |
| levels | very_poor 100 · poor 46 · poor_fair 36 · fair 10 · fair_good 8 | — |
| score | min 0.0 · p50 14.0 · p90 41.3 · **max 69.9** · **≥70: 0** | **row 1 confirmed live at this frame** |
| `confirmed` (obs gate) | **1/200 = 0.5%** | — |

⚠️ **The max is EXACTLY 69.9** — the cap value, not a coincidence. And this is **one frame of a
viewport sample capped at 200**; memory records P(good) ≈ 0.2% globally, so a zero here is
consistent with that, not a stronger claim. **Quote the n and the frame or do not quote it.**

---

## §4 WHAT THIS SESSION CORRECTED IN OUR OWN RECORD

1. **"AIFS produces no waves"** — refuted. arXiv:2604.25559v1 (2026-04-28, three months before we
   closed the branch on it): AIFS predicts SWH, mean period, direction, drag, plus six period bands
   >10 s, at **~10% lower medium-range SWH error than operational ecWAM ≈ one day of lead**.
   ★★★ I had checked the open-data **stream** and written it down as a fact about the **model**.
   **A distribution gap is not a capability gap.** The closure survives — Open-Meteo still serves no
   AIFS — but it now rests on **availability, which expires**.
2. **`CLAUDE.md` said the sim is "height-blind"** — refuted by execution; ~11 days stale.
3. **The v3.2 slope census was pinned to a ceiling we already changed** — saturation 4.1% → 100% at
   Tp ≥ 14 s. **A census is pinned to the constant it was taken under.**
4. **EWAM, my own Audit-7.0 proposal** — killed by its own skill run (§1).
5. **A memory's `description` decays faster than its body**, and routing reads the description.

---

## §5 THE QUEUE AFTER THIS SESSION

| # | item | state |
|---|---|---|
| 1 | ⛔⛔⛔ **Unfreeze the production frontend** — `main--rawsurf` builds fine with a working `/api` proxy; `3bd38a83` is the tip of **no branch** ⇒ locked/pinned deploy or auto-publish off. One dashboard screen. | **OWNER** |
| 2 | **Exposure cliff / dual floor** — `swell_exposure` limits **28.5%** of served spots; `directional_conflict` on **27.0%**. Replacement is empirical per-spot exposure from ERA5. | **ERA5-gated** |
| 3 | **50-member ensemble** — **priced: 8.1 MB/step for 10 members**, decoder already exists. Next: decode-against-known-field to verify magnitudes. | **READY TO BUILD** |
| 4 | **38% degraded geometry** — measured unchanged over three days. Shore normal dominates (7.4 / 28.1). | open, prerequisite |
| 5 | ~~EWAM 5 km~~ | ✅ **CLOSED — NO-GO by measurement** |
| 6 | Disconnect Vercel — 8/8 prod + 6/6 preview fail. | OWNER |
| 7 | `RATING_LOCAL_SIZE` — GO on sanity, 9.4:1 downward, category error as a score multiplier. | OWNER decision |
| 8 | Bed slope — **measured negligible** at groundswell (0.0% of spots move at Tp≥14). | low, now for a reason |
| 9 | Unauthorized WebSocket connects hang (5 tests, 120 s timeouts) — needs one `-v` run on a Linux runner. | spawned task |
| — | ✅ CI orphan estate (244 files, partition-asserted) · ✅ E2E (8 hard failures → 1 environment skip) · ✅ sim window discloses its ranking and the height caveat | **DONE** |

---

## §6 THE RULE THIS SESSION EARNED

★★★ **"HIGHER RESOLUTION" IS A HYPOTHESIS, NEVER A REASON.** Twice now: `ecmwf` losing to GFS at 36%
of coverage, and now EWAM 5 km losing to GFS 25 km by 46%. Both times the finer model *looked*
obviously better. **Price it with a paired run before writing a fetcher** — it cost one script and
ten minutes to avoid a whole ingestion lane.

Its sibling, also earned twice this session: **a census is pinned to the constant it was taken
under**, and **a distribution gap is not a capability gap**. All three are the same shape — a number
or a claim that was true about *something*, quoted about something else.

---

## Sources

**External (fetched 2026-08-05/06)**
* Representing the Surface Ocean in ECMWF's data-driven forecasting system AIFS — arXiv:2604.25559v1
* AIFS — ECMWF's data-driven forecasting system — arXiv:2406.01465
* An update to ECMWF's machine-learned weather forecast model AIFS — arXiv:2509.18994
* Improving the accuracy of global ECMWF wave height forecasts with machine learning — ScienceDirect
* Predicting coastal wave conditions: a simple machine learning approach — ScienceDirect
* Autonomous classification of wave breaker type in a large wave flume — ScienceDirect
* Ocean Wave Forecasting with Deep Learning as Alternative to Conventional Models — arXiv:2406.03848
* Probabilistic Wave Forecast for Week 2 and beyond, NOAA GEFS — WAF-D-24-0154.1
* ECMWF Forecast User Guide §8.1.5 Waves and wave meteograms; ECWAM model documentation
* ECMWF "From wind to waves: how ECMWF forecasts ocean waves" (2026)
* Open-Meteo Marine Weather API + Ensemble API model lists
* `opendata.dwd.de/weather/maritime/wave_models/` (gwam · ewam · cwam)
* `data.ecmwf.int/forecasts/.../ifs/0p25/waef/` GRIB + `.index`
* NDBC `latest_obs.txt` and `realtime2/<station>.txt`

**Internal**
* `THE-SOTA-LEDGER-what-actually-stands-in-the-way` (rows 1–7, 6b)
* `MASTER-AUDIT-7.0` · `6.0` · `5.0` · `2.0`
* `scratchpad/ewam_skill.py` · `ewam_skill_multi.py` (the paired census)
