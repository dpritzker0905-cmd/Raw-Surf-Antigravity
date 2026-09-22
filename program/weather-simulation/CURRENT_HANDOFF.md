# CURRENT HANDOFF — Program 13.0

**Written so a fresh session can continue WITHOUT rereading the 12+ audits.**

## 2026-09-22 — The blank map was SILENT, not frozen (PR #63)

Owner report: "logged into the app, the map is frozen with blank map area" on
`dev--rawsurf.netlify.app`. **Reproduced and root-caused.** Not frozen — silent.

**Ruled out by evidence, not assumption:** deployed build (map renders correctly in a clean
session at the same commit, screenshot captured) · backend (healthy, HEAD `2ac7ec6f`,
0.26-0.53 s) · service worker (`skipWaiting()` + `clients.claim()`, cache key matches HEAD
exactly, so it cannot sit on an old version) · lazy-chunk hang (`/map` is properly wrapped in
`ErrorBoundary` + `Suspense`, and a hang shows a loader, not a blank) · the 1.47 MB
`rawsurf_cached_feed` localStorage blob, which **I suspected for "frozen" and measured at
2.1 ms** — not the cause.

**Cause:** `@vis.gl/react-maplibre` 8.1.1 `dist/components/map.js:42-55` calls `props.onError`
IF PRESENT, else a bare `console.error`. `MapWebGL` passed none, so `setMapInstance` never ran,
children never mounted, NOTHING threw, no ErrorBoundary fired. Reproduced on demand by
disabling WebGL in a working session: shell intact, map area empty, zero errors surfaced.

⭐ **The `GL_VENDOR/GL_RENDERER Disabled` reading from 2026-09-18 was a REAL observation, not
a stale artifact** — it is the trigger, and this is the defect it exposed. The in-app browser
now reports working WebGL (ANGLE/Intel D3D11), so that browser is no longer a blocker.

⚠️ **`onError` alone would have been WORSE than the bug.** `@vis.gl` maps the map's ONGOING
`error` event onto the same prop (`dist/maplibre/maplibre.js:60`), so a naive wiring blanks a
healthy map on one tile 404. `isMapStartupFailure()` discriminates on two independent signals
(`target: null` from the init catch, plus `innerMapRef.current`) and is extracted so it is
testable. Runtime errors return early — the existing `mapInstance.on('error')` effect already
calls `trackMapError`, and claiming them twice would corrupt the counts.

PR #63 targets `dev`. 25 new tests; map 169 suites/1802 tests; full frontend 275/2688; lint
ratchet passes (debt -2); production build clean. **NOT verified: the rendered panel in a real
browser at a real viewport** — jsdom proves roles/themes/copy, not pixels. Check the deploy
preview signed in, across all three themes and on mobile, before merge.

### Open threads, in priority order

1. **Six 3.12-ONLY backend failures** — `test_dynamic_viewport.py` (1 to 5) and
   `test_dynamic_viewport_extended.py` (0 to 1) fail on Python 3.12 but not 3.11. Same tree,
   same pins. This is the map's own data path, so it may or may not relate to the above; the
   relationship is UNESTABLISHED and must not be assumed either way.
2. **Backend latency peaks** — over 14 h: `/api/weather/grid_series` max **26.3 s**,
   `/api/photographers/featured` **62.6 s**, 81 requests over 10 s. ~79% of all 18,955
   requests are background polls (unread-counts, notifications, dispatch, friends/map).
   Not the blank-map cause; a real problem sitting next to one.
3. **PR #59** (per-cell geometry dump, Queue E#1) — green, CLEAN, awaiting merge. Its live
   candidate is `shore_normal_deg`: 68.2 deg ETOPO at the spot vs 77.47 deg coarse at the
   cell. Still NOT tuned.

### Machine note (Windows secondary, 2026-09-22)

Now on declared **Python 3.12.10** (parity 44/46; only `pygrib`/`uvloop` absent, both
Windows-impossible — verified by attempting them, not assumed). The 3.11 venv is retained and
untouched at `backend/.venv`; the 3.12 venv is OUTSIDE the repo at
`C:/Users/13218/venvs/raw-surf-py312`.
⚠️ `C:/Users/13218/AppData/Local/Temp/pytest-of-13218` is ACL-locked (even `icacls` is denied)
and was silently erroring **289 backend tests** at fixture setup. Set `PYTEST_DEBUG_TEMPROOT`
to a writable path, or clear that directory from an elevated prompt.
⚠️ CI runs pytest in **exactly two scoped lanes** — per `ci.yml:727`, 309 of 411 test files are
CI-orphans. A full `pytest tests/` run is NOT a CI-equivalent check.

---

## 2026-09-20 — Codex second check continuation

The active weather lane is `codex/weather-handoff-second-check` in the isolated
`raw-surf-weather-audit` checkout. Last pushed head is `d82032f5`; overnight CI
`35487375744` passed 11/11 jobs on an identical tree. The day-two continuation is local.
Use [the summary audit](../../audit/weather-handoff-day2-2026-09-20/SUMMARY_AUDIT.md)
and its linked receipts for current work; the August records below remain historical.

- Direction cancellation/missingness is repaired through backend point/grid/lattice and the
  separate frontend ICON mirrors. Healthy calm/north/wrap controls remain. Numerical refusal
  is not a calibrated uncertainty score or field validation.
- Raster fallback now uses completed provider manifests and refuses bootstrap time axes after
  a cold metadata failure. Decoder and mounted-hook tests reproduce and prevent wrong-cycle
  and wrong-hour selection. Live pixels/performance are not certified by these tests.
- Fixed private September scored-archive replay passes the unchanged persistence rule at all
  three leads, with zero observation-pairing exclusions. Public references still outperform
  the served lane. C4-SC-12 retains its first corrected scheduled-verdict requirement.
- A real-code fault-injection probe reproduces archive/pending replacement after a failed read.
  Strict reads, acknowledged writes and create-only missing-object handling now protect the
  skill ledger, hot residual archive and monthly rollup. Pending is consumed only after scored
  archives acknowledge. Concurrent successful updates remain unprotected; do not infer complete
  monthly retention or a confirmed historical production-loss cause from the snapshot's date span.

Final local verification: forecast chain **1,148 passed / 101 files**, frontend **2,542 passed /
259 suites**, frontend production build passed with warnings, governance **51 passed**. Storage
affected suites reran **213 passed** after a test-clock fix; an isolated ordering mutation failed
the preservation guard while its healthy control passed. Source hashes and environment limits
are recorded in the linked audit's `final-validation.json`; new hosted CI remains outstanding.

Separate approval is required for this new continuation push, any merge, or deployment.
No changes to bucket permissions, forecast thresholds, scientific flags or frontend release
status are authorized by the local verification. Raw archive bytes are outside the Git checkout.


---

## ⬆ 2026-08-15 LATEST — the halo's prime suspect is MEASURED and the verdict rewrites the plan (independent lane; committed on `claude/halo-audit31-lane`, NOT pushed)

External **Master Codex Audit 3.1** (land-mask second pass) commissioned an independent lane on the
reopened halo. Outcome, all runtime-measured (`frontend/scripts/shaderlab-gate.js` — a new Playwright
harness that compiles the EXACT working-tree shaders and reads pixels):

- ✅✅ **`u_dataMaskGate` is PIXEL-INERT** — compiled, linked, location ACTIVE, value set, and
  **0/262,144 px change in every geometry** incl. the live z8.03 delivered-short strip. The quad
  rasterizes exactly over the DATA bounds ⇒ `_outData` is unsatisfiable ⇒ the AND never fires.
  **The planned `__RAW_DISABLE_HEATMAP_BOUNDS_GATE__` zoomlab A/B must be null; "the gate stopped
  binding" is refuted; do NOT re-run that A/B as a discriminator.**
- **The real heatmap face:** delivered mask SHORT of the view while the data quad covers it (the
  gate excludes exactly this case BY DESIGN — Istria), plus the world regime where only overlay
  CONTENT defends (`_drawCoarseBasePass` hard-REPLACEs with PADDED overlay bounds —
  `WebGLMarineEngine.js:3096` — open follow-up).
- **Repair shipped on the lane (A3.1-02):** `marineCoverageContract.js` — COVERED→RETRY→
  **SAFE_DEGRADED** terminal state over `resolveDeliveredCoverage` + shader `u_maskClipEnabled`
  (blanks OUTSIDE the delivered mask where the overlay has no say; runs AFTER the overlay block;
  kill `__RAW_DISABLE_MASK_SHORT_CLIP__`). Pixel-proven S2c/S2d; **71/71** focused tests; ratchet
  green (engine 3205/3207, net +1); uniform locations cached + `__RAW_GPU__.heatmapGate` telemetry.
- **Particles (A3.1-06), runtime-proven:** mask-only shortfall SURVIVES via edge-clamp water and its
  fate flips with the edge texel content (`isOob` keys on DATA bounds only). Untouched — own design
  needed (LOC cap 978/978).
- Full report + hypothesis table: `evidence/AUDIT-3.1-INDEPENDENT-LANE-2026-08-15.md` · deployed
  optical gate still auth-blocked → `docs/runbooks/RUNBOOK-2026-08-15-halo-optical-promotion-gate.md`.
- Lane: worktree `.claude/worktrees/halo-lane`, branch `claude/halo-audit31-lane`, commit `aa026f7f`.
  **Nothing pushed; owner review before any merge — the clip changes live pixels in the halo band
  (it blanks pixels currently painted with no data).**

---

## ⬆ 2026-08-15 LATER — Master Codex remediation batch (SECOND session; committed, NOT pushed)

The external **Master Codex Audit 1.0** (`C:\Users\dprit\OneDrive\Documents\New project\`) was
revalidated at `c1566c8b` — all ten findings reproduce (MC-03 live on production) — and four
repairs landed as local commits on top of the other session's pushed work:

- **WS-CAN-0072** — the cap seam (MC-01 = the 11.0 §3.8 seam, WS-CAN-0052's blocker) repaired
  **DARK**: `publish_surf_height` converts-then-compares behind `SURF_CAP_SEAM_MONOTONE`
  (default OFF, registry-declared). Audit probe 38/48 negative-jump traces → **0/48** armed;
  47 tests, M1–M4 mutations; `surf_transform.py` 800→795. ⛔ **The flip is the owner's, three
  lanes together — read D-4.** Evidence: `evidence/scientific-validation/MC01-capseam-evidence.md`.
- **WS-CAN-0017** — `GRIB_RANGE_STRICT=0` now **extracts-or-refuses** (provable ignore-Range 200 →
  exact slice, GRIB magic checked; anything else raises). 36 tests in the file.
- **WS-CAN-0073** — `/report-calibration` refuses at `n_matched=0` with a reason (was
  `available:true` at 60000/0/0, reproduced live).
- **WS-CAN-0074** — `/client-diagnostics` bounded (422 at the door, 5 MB rotation, no `str(e)`).
- Registry truth: `SURF_HEIGHT_H110` default in `_RATING_FLAGS` corrected `"0"`→`"1"` (stale since
  08-05; the admin panel misreported the live statistic), test-pinned.

⛔ **Floors deliberately NOT raised** — D-5: they are set from CI's origin/dev reading, which
cannot exist before an authorized push. After that push: pair-edit per lane from the CI numbers.
⛔ **Nothing pushed by this session** (rule 7). The owner-decision queue gained one item:
flip `SURF_CAP_SEAM_MONOTONE` (with the census) — see the addendum in
`CURRENT_RELEASE_GATE_STATUS.md`.

---

| | |
|---|---|
| **Date** | 2026-08-15 |
| **Branch** | `dev` — **all work PUSHED, CI green (11/11 jobs)** |
| **Baseline / rollback point** | `1f4e5149` |
| **End** | `b292e243` |
| **Scope** | 7 missions + a self-audit + a Gate 1 truth pass + SOTA research |

⚠️ **A CONCURRENT SESSION SHARES THIS WORKING TREE.** At handoff it had **uncommitted** edits to
`surf_transform.py`, `surf_height_convention.py`, `test_surf_height_convention.py`,
`routes/admin/surf_forecast.py`, plus an untracked `test_surf_cap_seam_monotone.py`. **Not mine — do
not stage, commit or revert them.** Always `git commit -o <paths>`; nothing isolates a push, and my
HEAD moved twice today without my running a command.

---

## 0. If you read one thing

> **Do NOT build the instrument inventory. I recommended it, then measured, and the measurement
> retired my own recommendation.**

`STATE_OF_THE_ART_PATH.md` names *"an instrument's output has a NAMED READER"* as the #1 gap, with
means *"a generated instrument inventory; a digest that fails when an instrument is red or empty."*
Before building it I ran the census it prescribes. **All 27 workflows, statuses and cron flags, in
ONE command** (`gh run list` per workflow + a `schedule:` grep). Seconds.

| finding | |
|---|---|
| **Nothing is red** — every completed run reads `success` | the digest would fire **zero** times today |
| `marine-nightly`, the lane that stood RED 18 of 37 runs | **green**, 2026-08-14 |
| **`python-upgrade-readiness` has NEVER RUN** (`— null`) | ⚠️ and carries **6 × `continue-on-error: true`** |
| `build-bathymetry` 06-29 · `l2-orphan-sweep` 07-08 · `build-shore-normals` 07-28 | stale **by design** — `workflow_dispatch` only |

**Two measured conclusions:**

1. **A checked-in inventory artifact is unnecessary and would rot.** The data is already generated
   and queryable on demand. A static list is precisely the hand-maintained census this program keeps
   getting bitten by (`WS-CAN-0066`'s alert guard, my own fixture census, `_RATING_SURFACES`). If a
   digest is ever built it must **generate** its subject list, never carry one.
2. **The digest is not urgent.** Building a detector for a condition that is not occurring is the
   "novelty is not authorization" trap (§33). Its value is catching the *next* red; the estate is
   green today.

⇒ **The one actionable item the census produced: `python-upgrade-readiness` — a workflow that has
never executed, whose 6 `continue-on-error: true` flags mean it could not fail if it did.** That is
the "a refusal you cannot read is a pass" class. Small and real — not a platform programme.

---

## 1. What shipped — 15 commits, pushed, CI green

| commit | what | reaches |
|---|---|---|
| `d8c866bd` | **WS-OBJ-207 / WS-CAN-0062** — a verified pin on BLIND geometry read "high conf" and said nothing | backend, live |
| `3afaf8b1` | **WS-OBJ-401** — split `spot_ratings.py` 800→351 at the LOC ceiling; lane → `spot_ratings_precompute.py` | enabler |
| `d1fb5369` | **WS-OBJ-103 / WS-CAN-0009** — 9 sites answered 200 with an error body, 4 leaking `str(e)` | backend, live |
| `a6e4339a` `9e9b8646` `c1566c8b` | **WS-OBJ-304 / WS-CAN-0017** — a Range request answered with the WHOLE FILE was accepted, then mapped positionally; + kill switch | backend, live |
| `6df51b03` | **Gate 1 truth pass** — 13 objectives measured against their own criteria; 3 mis-stated | governance |
| `4950ac45` `e5c68c1a` `cd995e40` `1cf2c49c` | latency forensics + a retraction; WS-CAN-0033 closed on evidence | no code, by design |
| `4b281e11` | state-of-the-art research | governance |
| `5fcdd817` `b292e243` | estate floor 396→386; L-2 answered | CI fix |

**Objectives:** WS-OBJ-207 **certified** · WS-OBJ-201 **re-certified** with the consumer list 12.2
required · WS-OBJ-203 / 205 / 506 blockers corrected — all **stale**, i.e. further along than recorded.

---

## 2. Five things that will cost you an hour each

1. **⚠️ SET THE ESTATE FLOOR FROM THE CI READING, NEVER A LOCAL ONE.** A local run of that lane is
   structurally **~10 higher**: `test_trevec_index_gc.py` does a module-level `importorskip` on
   `pyarrow`+`lance`, which a dev box has and CI installs from **neither** requirements file, so its
   10 cases never collect and 1 skip stands in. I set two raises from local runs and reddened CI.
   guards and chain carry no such bias. **2 of the 12-case gap remain unexplained.**
2. **Local browser verification of a backend change is a TRAP** — `useSpotRatings.js:299` hits the
   Supabase CDN (production precompute) first, and `BACKEND_URL` points at production. Both
   overrides: `BLOCKERS_AND_DECISIONS.md` D-3.
3. **A new `os.environ.get` in a rating surface is a REGISTRY EDIT** (`_RATING_FLAGS`). 155 targeted
   tests stayed green; only the full guards lane caught it.
4. **The lane that owns your NEW file is not the lane that owns the files you EDITED.** I re-ran only
   estate after editing 5 guards-lane files, and committed a red lane.
5. **Use the Editor, not string templating, on source.** Two self-inflicted breaks: a helper inserted
   at column 0 inside a function (valid Python, silently truncated a fixture), and an f-string
   mangled into a SyntaxError across all three fetchers.

---

## 3. Best path forward, in order

1. **`python-upgrade-readiness`** — never executed, 6 × `continue-on-error: true`. Make it run or
   retire it. The only item today's census produced.
2. **The other half of L-2 (not mine)** — the Calibration Census raises `SystemExit` with a *string*
   (exit 1 = NO-GO) when its spot fetch 503s, so a fetch failure pages as a calibration verdict. The
   workflow already has the right branch; the one-line fix (`exit 2`) is named in that entry.
3. **`WS-CAN-0017`'s remaining links** — end-to-end checksum, re-validation on restore. Backend,
   Gate 1, forensics already done.
4. **`WS-CAN-0029`** (freshness_sec) — the only other Gate 1 backend item that is a defined *Repair*.

**⛔ Do not build the instrument digest** (§0). **⛔ Do not start** Tier-3 research
(`WS-CAN-0046`–`0051`), `WS-CAN-0058` (audit-deferred), or any flag flip.

**The bottleneck is not engineering.** Gate 1 has 14 objectives: 2 certified, **4 owner-gated**
(`WS-CAN-0005`'s staged plan; the accuracy gate arms 08-22), 2 audit-deferred, the rest frontend-frozen
behind **`WS-CAN-0039`** — which multiplies 17 of 44 open task-rows by ~0.15. **Unfreezing the
production frontend is the largest single derivative on the board and only the owner can pull it.**
`dev → main` PR **#8** is open and now contains this work.

---

## 4. Work that must remain untouched

- ⛔ **The concurrent session's uncommitted files** (top of this document).
- ⛔ `backend/uploads/forecast_cache/marine_global.json` / `wind_global.json` — dirty since baseline,
  **not mine**, never staged. Verify they stay unstaged after any commit.
- ⛔ Do not weaken `test_flag_lane_parity`'s `>= 27` coverage floor — shrink-only by contract.
- ⛔ Do not couple `confidence` to `geometry_readiness` (D-1); a named CONTROL test enforces it.
- ⛔ Do not raise `SPOT_RATINGS_CONCURRENCY` — one var, two route semaphores, 1 CPU. And raising it
  is **refuted**: a warm A/B showed the concurrency shape does not move throughput.
- ⛔ `git commit -o <paths>` only. **Every push to `dev` is a production backend deploy.**
- ⚠️ `GRIB_RANGE_STRICT=0` disables the new range-integrity check without a deploy, if ingest ever
  breaks on it. Verified against live NOAA, but production egresses through Render.

---

## 5. Honest accounting

- **63% of this session's output was documentation**; ~198 lines of genuinely new production code.
- **Nine instrument errors of my own**, all caught — five by pairing a scan with a control or a second
  method, **none** by re-reading my own code. Full list: `SESSION_AUDIT_2026-08-14.md`.
- **Three conclusions retracted before they became actions**: raising `SPOT_RATINGS_CONCURRENCY`
  (refuted by a warm A/B), the WS-CAN-0064 "blocked on an admin read" claim, and the batch-omission
  design (caught by a pre-existing guard).
- **The recurring lesson, now measured four separate times:** an instrument that exists and is unread
  is this system's dominant defect shape — `/api/health`'s 41-route telemetry, `geometryReadiness`,
  `resolution`, and today's workflow census. ★ And the fourth one retired a build I had recommended.
