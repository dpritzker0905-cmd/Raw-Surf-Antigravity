# HANDOFF — 2026-08-06 · the finer model lost, and the ensemble is affordable

**For a fresh session. Everything here was measured. Read §0 and §1 before acting.**
Evidence: `docs/research/MASTER-AUDIT-8.0-2026-08-06-two-hypotheses-killed-by-their-own-measurements.md`

---

## §0 THE FIVE THINGS THAT WILL BITE YOU FIRST

1. ⛔⛔ **EVERY PUSH TO `dev` IS A PRODUCTION BACKEND DEPLOY**, 5 to 30+ min, unbounded. **Batch
   pushes.** A local E2E run against a redeploying backend fails at the LOAD GATE and looks like a
   code bug — it is not. `/api/health` embeds the deployed SHA; use it.
2. ⛔⛔ **A MERGE IS NOT A DEPLOY AND A DEPLOY IS NOT AN ARTIFACT.** Date the frontend with
   `curl -s https://<site>/service-worker.js | grep BUILD_VERSION`.
3. ⛔ **Do not `gh workflow run` E2E while a push-triggered run is in flight** — `e2e-tests.yml` has
   `concurrency.cancel-in-progress: true` and the dispatch **cancels** the push run. I did this.
4. ⛔ **`main` is protected** (10 required checks, `enforce_admins: true`). `ci.yml` has **no**
   concurrency block, so pushing during a CI run does *not* cancel it.
5. ⚠️ **A LOCAL PASS IS NOT A CI PASS.** Three separate bites this arc: an undeclared
   `pytest-timeout`; two test files that pass on Windows and fail on the runner; a `MIN_PASSED`
   floor set from a local count that was **above** CI's achievable number.

---

## §1 THE TWO RESULTS THAT SHOULD CHANGE WHAT YOU DO NEXT

### ⛔ EWAM (5 km) LOST TO GFS (25 km). Item 5 is CLOSED, NO-GO.

Paired vs NDBC buoys in the EWAM domain — same coordinate, same ISO hour matched off each model's
own `time` array, a cell counted only if all four models **and** the buoy had a value.
**n = 324 cells · 13 buoys · ~48 h · 0 partial:**

```
GFS   25 km   MAE 0.210   bias +0.179   best at 8 of 13 buoys   <- incumbent, coarsest, WINS
MFWAM  8 km   MAE 0.249   bias +0.204   best at 3
GWAM  25 km   MAE 0.294   bias +0.260   best at 0               <- our ICON-marine lane
EWAM   5 km   MAE 0.306   bias +0.272   best at 2               <- 46% WORSE than GFS
```

★★★ **"HIGHER RESOLUTION" IS A HYPOTHESIS, NEVER A REASON.** Second time here: row 6 already had
`ecmwf` losing to GFS at 36% of coverage. **Price with a paired run before writing a fetcher** —
this cost one script and ten minutes.
⭐⭐ **Follow-up worth having: GWAM is best at ZERO of 13, and it is a lane we ship.** Wider census.
⚠️ **LIMITS — do not over-quote:** one region, one 48 h window (324 cells ≠ 324 independent
samples); all four share a +0.18–0.27 m high bias, which four independent models agreeing makes
likelier an observation-side property; and it is a **nowcast** census, **not** a forecast skill
score. Scripts: `scratchpad/ewam_skill.py`, `ewam_skill_multi.py`.

### ✅ THE 50-MEMBER ENSEMBLE IS AFFORDABLE, AND THE DECODER ALREADY EXISTS. Item 3 is READY.

`data.ecmwf.int/forecasts/<date>/00z/ifs/0p25/waef/` ships a `.index` with `_offset`/`_length` per
(member, param) ⇒ **HTTP range requests**.

```
whole step (13 params x 50 members) = 501 MB   <- NEVER fetch whole (serve box OOM at 1,579 MB)
swh, all 50 members, range-requested = 40.7 MB/step
swh, 10 members                      =  8.1 MB/step   <- the viable build
```

⭐⭐⭐ Params include **`h1012 h1214 h1417 h1721 h2125 h2530`** — SWH in six period bands, the same
decomposition AIFS Waves offers. ✅ **`services/weather_pipeline/period_bands.py` already turns those
into `{h, tp, dir, kind}` partitions and `point_surf_augment.py:147` already calls it.** The work is
50 members through an existing decoder.
⛔ **NEXT STEP IS NOT A BUILD — it is a decode against a known field.** v4's decoded metre figures
were RETRACTED. Pricing is archaeology; magnitudes are unverified.

---

## §2 STATE AT HANDOFF

* `origin/dev` = `origin/main` region — dev tip is this session's work; **CI green on `fec58f67`.**
* Backend deployed and healthy; `/api/weather/spot-ratings` serving `precomputed`.
* **Live product state, n=200, frame 2026-08-06T04:00Z, GFS:** geometry full 123 / **degraded 76 =
  38.0%** / blind 1 — **identical to 2026-08-03, three days no movement**. Limiter `size_gate` 86 ·
  **`swell_exposure` 57 (28.5%)** · `wind_period_blend` 55. `directional_conflict` **54/200 = 27.0%**.
  Levels very_poor 100 / poor 46 / poor_fair 36 / fair 10 / fair_good 8. **Score max exactly 69.9,
  zero ≥70.** `confirmed` 1/200 = 0.5%.
  ⚠️ **One frame, one capped viewport sample — quote the n and the frame or do not quote it.**
* **CI estate lane green**, `MIN_PASSED=236` set from the gate's own reading (238 passed, 0 silent).
* **E2E:** 8 hard failures → 1, and that 1 is headless Firefox without WebGL, now a **capability
  probe** (not a browser-name skip). 5 flaky, all Desktop Safari, across two unrelated specs.
* ERA5 campaign advancing (was at [12/150] mid-session; check the log).
* Memory index compacted **20,449 → 17,680 B** by retiring four whole topics; every file kept on
  disk, routing moved to the uncapped domain indexes.

---

## §3 THE QUEUE, IN JACOBIAN ORDER

1. ⛔⛔⛔ **Unfreeze the production frontend. [OWNER]** `main--rawsurf.netlify.app` builds fine and
   its `/api/health` is **200**; production serves `3bd38a83` (2026-05-20) with 6/6 `/api/*` 404.
   `3bd38a83` is the tip of **no branch**. ⇒ a **locked/pinned deploy or auto-publish off**, or a
   production-branch naming a dead branch. Netlify → **Deploys** (Locked / Stop-auto-publishing
   banner) and **Site configuration → Build & deploy → Branches**. ⛔ Do not "fix" it with another
   promotion; that has been disproved three times.
2. **Exposure cliff / dual floor** — binds 28.5% of served spots, 27.0% carry the conflict.
   ⛔ Don't tune the floor (already 7.7× too generous). Replacement is empirical per-spot exposure
   from ERA5 ⇒ **accumulation-gated**.
3. **Ensemble — READY.** Decode-against-known-field first, then 10 members at 8.1 MB/step.
4. **38% degraded geometry** — unchanged over three days. Shore normal dominates (7.4 / 28.1).
   ⛔ Never size this off `dev.db`; use `sim_forecast.fetch_catalog()`.
5. ✅ ~~EWAM~~ closed NO-GO.
6. **Disconnect Vercel [OWNER]** — 8/8 prod + 6/6 preview fail; sole source of GitHub
   `deployment_status`, and nothing gates on it.
7. **`RATING_LOCAL_SIZE` [OWNER]** — GO on climatology sanity, but 9.4:1 downward and a **category
   error as a score multiplier**; use it as a separate rarity axis.
8. **Bed slope** — measured negligible: **0.0%** of spots move at Tp≥14; residue at 5–8 s chop.
9. **Unauthorized WS connects hang** — 5 tests time out at 120 s on the runner, pass locally.
   ⛔ **Measure first:** re-run `tests/test_websocket_endpoints_auth.py` alone on a Linux runner with
   `-v` to see whether the sibling `_authorized` cases pass. `-q` names only failures, so the
   existing log cannot answer it. Quarantined by name in `scripts/ci_test_lanes.py`.

---

## §4 ⛔ WHAT NOT TO REDO — claims already killed, with the evidence

* **"AIFS produces no waves."** Refuted — arXiv:2604.25559v1, ~10% better SWH than ecWAM. What was
  checked was the open-data **stream**, not the model. Still unreachable on Open-Meteo, so the
  branch stays closed **on availability** — re-check on every model addition.
* **"EWAM 5 km will beat GFS."** My own proposal; refuted by my own skill run, 46% worse.
* **"The γ ceiling makes the slope term inert."** True at Tp≥14 (0.0% move), false at 5–8 s.
* **"The sim is height-blind."** Refuted by execution; `CLAUDE.md` corrected.
* **"The E2E backend is failing."** The suite's own `page.route` allowlist manufactured the 404.
* **"One fast-forward ships the frontend."** Disproved three times.

---

## §5 THE RULES THIS ARC EARNED

* ★★★ **"Higher resolution" is a hypothesis, never a reason.** Price it with a paired run.
* ★★★ **A census is pinned to the constant it was taken under.** Changing the constant invalidates
  the measurement, not just the conclusion.
* ★★★ **A distribution gap is not a capability gap.** Say which one you measured.
* ★★★ **A local pass is not a CI pass, and a local count is not a gate's count.** Ship floors
  provisional; set them from the gate's own first green run.
* ★★★ **A memory's `description` decays faster than its body — and routing reads the description.**
  When you supersede something in a body, rewrite the description in the same edit.
* ★★ **Inspect one instance of a format before parsing the set.** junit `classname` is dotted;
  `limiter` is a string not a dict; NDBC columns are positional. Each cost a turn.
* ★★ **Assert coverage PER FILE, not as a count** — a total can be met by coincidence.
