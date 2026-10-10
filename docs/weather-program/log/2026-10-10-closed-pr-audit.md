# 2026-10-10: did the closed, unmerged PRs lose anything? (branch `claude/closed-pr-recovery`)

Owner (chat): "make sure #292 isn't lost here", then "Make sure any of the other closed CL's were properly incorporated,
if still needed". #292 had been closed unmerged and folded into #294. This log is written only by this session. dev
was `9e11676c` throughout. Nothing here changes a served number.

Marks: **[run]** = this session executed it; **[read]** = this session read the dev code; **[audit]** = a read-only
audit agent of this session read it, and this session did not re-check it.

## 1. #292 (wind palettes vs the colour-blind floor): nothing lost

- [run] #294 (`1cdcd8d3`) carried #292's `WindColorRamp.js`, `windPaletteCvd.test.js`, session log and checker README
  byte-identical (0 differing lines each, `git diff 94a7cee2 1cdcd8d3`).
- [run] On dev now: of the 36 ramp rows #292 changed, 31 are identical and 5 light field rows (10, 21, 27, 33, 40 kn)
  were moved again by #297 (`af0fa421`); none reverted. All `PRE_CVD` restore rows are identical and the three kill
  switches are registered.
- [run] `windPaletteCvd.test.js` on dev: 14 tests pass (11 from #292, 3 added since). The 10 mutations from #292's
  log were re-run on dev (one retargeted at #297's 27 kn row, one at the kill-switch line as it now reads): 10 of 10
  turn the suite red.
- [run] Checker on dev: 0 normal-vision red lines; colour-blind lines pass for dark and beach and for light's legend;
  light's tint over water is the one red line (2.6 on the muted ground, 2.7 with `--no-mute`).
- [read] The lesson is on dev as **L-V15** (#294 added its own L-V14). The two ledger lines are dev's seq 971-972.

## 2. The closed, unmerged PRs

`gh pr list --state closed`: 299 closed, 288 merged, **11 closed unmerged**.

| PR | Closed | What this audit found |
|---|---|---|
| #11 | 2026-08-16 | A dev -> main promotion. Its head `f2ab8e41` is an ancestor of dev, so no content can be lost. It is not on main. |
| #15 | 2026-10-01 | 14 behavioural changes: 5 on dev, 1 obsolete, 3 an experiment dev never took, 4 optional tooling, **1 still needed (ported here, section 3)**. |
| #22, #23 | 2026-10-01 | 19 changes (#23 contains #22). 8 on dev or equivalent, 2 obsolete, **bounds mislabel and stale base still live (section 4)**, the rest dormant behind opt-in flags or uncertain. |
| #27 | 2026-10-01 | 16 changes. The mask/probe fixes and the guardrail reset are on dev; **the core node-bounds fix is not (section 4)**; 4 diagnostics features were never adopted. |
| #43, #44 | 2026-10-01 | 23 changes (#44 contains #43). Nothing lost that matters: see below. |
| #222, #224, #225 | 2026-10-08 | Source is on dev. **Their records were dropped (section 5).** |
| #292 | 2026-10-09 | Section 1. |

Instrument for the six September PRs: of the significant lines each added (>= 24 characters, containing a letter),
the share that exists anywhere on dev was 9% (#15), 28% (#22), 16% (#23), 22% (#27), 18% (#43), 17% (#44). That is a
first pass only: most of their fixes are on dev in another form. Each behaviour was then classified by reading dev.

**#43 / #44, the items that could have mattered:**
- [read] Wave height when corner directions cancel (#44): on dev, dark. `SAMPLER_SCALAR_HEIGHT` defaults to '0'
  (`sampler.py:76`), declared at default in the ingest and precompute workflows with "flip ONLY on the owner's word",
  and STATE lists it as BUILT, DARK. A tracked owner decision, not a lost fix.
- [read] Radar legend (dBZ label over rain-rate stops, #44): dev pins it as a known open mismatch in
  `radarLegendUnits.proof.test.js` ("this test is the record, not the fix").
- [read] HUD "Provider" from the fetcher's supplier (#43): the audit agent called it missing. dev's comment at
  `TruthOverlay.js:316` says the HUD shows where the data actually came from, "not the 'open-meteo' channel key", one
  definition shared with the spot hub. Read here as decided the other way, not dropped.
- [audit] Stored-coverage-first series routing (#43): on dev as `series_source_policy.py` ("Carried over from unmerged
  PR #43"). Async map-startup errors (#44): surfaced on dev through `useMapErrorSurface.js`.
- [audit] Latent, no first-party caller: the viewport gate still refuses weather/pressure grids
  (`viewport_helper.py:646`) while capabilities advertise the layer. Low: a containing-viewport series fallback has
  no anchor check across the xx:30 flip (`marineGridSeries.js:613`).

## 3. Ported here: an API timeout was graded as a renderer crash (#15)

- [read] `frontend/scripts/zoomlab-verdict.js`: `TRANSPORT_RE` had no timeout shape, so a caught Axios timeout was
  classed `RENDER`, and any `RENDER` console error makes the verdict `FAIL`.
- [run] dev's `analyzeTrace` on `[ERROR] Error fetching featured photographers: AxiosError: timeout of 15000ms
  exceeded`: `FAIL`. Controls: the `[apiClient] Network error` shape gives `REFUSE`; a TypeError gives `FAIL`.
- [run] It cost a run: Marine Nightly 37938226484 (2026-10-09T13:37Z) failed with `Independent renderer errors: 1`,
  and the one error was that line.
- The fix is #15's four lines and its test (`src/tests/zoomlab-verdict-timeout.test.js`, 6 cases). [run] 3 verdict
  suites, 20 tests green; two mutations red (the rule removed: 3 fail; the rule loosened to any "timeout of": 1 fails).
  It changes the nightly's label for that one error shape, from a false renderer FAIL to REFUSE. Nothing user-facing.

## 4. Still live, NOT fixed here (proposed as their own work)

**Thinned world frames carry bounds that are not their nodes' (#27, #23).**
- [read] `series_vector_budget._decimate_frame` rewrites `vectors`, `cols`, `rows` and stamps `decimated_stride`; it
  never touches `bounds`. `decimate_vectors` keeps `range(0, rows, stride)` and does not force the last row.
  `apply_vector_budget` does not touch bounds either. The client takes `frame.bounds` as is
  (`marineSeriesFrame.js:52`) and `gridPointRegistration.js` maps row i to `south + i * span / (rows - 1)`.
- [run] dev's function on a 181 x 83 world frame (2 deg, lat -80..84), default budget 80,000:

  | page | stride | lattice | node latitude extent | bounds say | data at 0N / 24N / 40N drawn at |
  |---|---|---|---|---|---|
  | 48 frames | 4 | 46 x 21 | -80 .. 80 | -80 .. 84 | 2.0N / 26.6N / 43.0N |
  | 17 frames | 2 | 91 x 42 | -80 .. 84 | -80 .. 84 | exact |

- The client treats a thinned world frame as a placeholder and fetches the exact frame once the hour settles
  (`marineExactUpgrade.js`), so this shows while scrubbing or playing at far zoom. Not rendered here: the shift is
  computed from the two code paths, and production's stored row count was not read.
- [audit] Same family: `normalizer.py:150-155` stamps the requested bbox as bounds. The 10-deg world product is
  ingested with north 85 and ends at 80N. The serving clip (`route_helpers.filter_grid_to_bbox`) rebuilds bounds from
  cells for clipped marine grids, which is why regional views are right.

**The retained coarse world base is reused on shape, not content (#23).**
- [read] `coarseBaseKey` (`marineEngineDecisions.js:734`) is model, layer, cols, rows, bounds, hour offset, rating
  flavour. `WebGLMarineEngine.js:414` re-captures only when that key changes. No run time, valid time or content.
- Not reproduced on screen. [audit] `marineStaleHour.js` covers a different-hour base on the seed and bridge paths.

**Dormant or uncertain, listed for completeness** [audit]: a surf-mode race in the zoom-out prewarm (#23), frame
provenance dropped in the wind/engine conform (#23/#44), arbiter parity while the arbiter is off (#23), zero-opacity
draw skipping and GPU-probe batching (#15, performance only, no measured gain recorded).

**Never adopted, by design or by default** [audit]: #15's handoff-blend experiment and its lab tools
(`marine-handoff-lab`, `marine-coastal-replay`, `marine-render-profiler`, `marine-cadence`), the accuracy monitor's
`--evidence-dir` replay capture, #23's eight evidence modules, #27's `MarineProbePanel` and HUD layout.

## 5. Recovered here: what #222, #224 and #225 carried besides code

Their source landed on dev on 2026-10-03 through `7cd898f4`, `f9cd9404` and `f395a503`; the PRs were closed on
2026-10-08 after "a hunk-by-hunk comparison ... found the source fully integrated". [run] That holds: 86-100% of each
code file's added lines are on dev and the rest is later hardening (a timeout argument, a clipped lattice index).
None of the following was on dev:

- Two session logs and 99 lines of a third: restored, text unchanged, each under a provenance note.
- A lesson ("an equivalence check that never ran the new path proves nothing"): restored as **L-S21**.
- A finding, **still true**: `public.surf_reports` grants nothing to `service_role`. [run] 2026-10-10, read-only SQL:
  the only grantee is `postgres` (the sibling `surf_spots` grants SELECT to `service_role`); 4 rows, newest
  2026-03-19, 0 in the last 12 h, RLS on. [read] `rating_confirmation.py:316` and `report_calibration.py:230` still
  read it over REST. The remedy is a GRANT in a migration, on the owner's word. Not applied. Now in STATE "Owner-only".
- A read-back commitment (the month-seam fix): **satisfied**. [run] The first scheduled Forecast Accuracy Monitor run
  after the fix, 37183785589 (2026-10-04T06:46Z): paired persistence n = 2770 / 2153 / 2543 at +24/+48/+72 h (floor
  200), no `SKILL FLOOR UNMEASURED`, `verdict: OK`. All 16 scheduled runs from 2026-10-04 to 2026-10-09 succeeded.
- A read-back commitment (the strided world read on the deployed box): **never done**. [read] SCOREBOARD's last S11
  rows are 2026-10-02, before the code landed. It needs S11 par2 and seq against the 1-CPU box, so it is re-entered as
  a commitment that waits for the owner's go-ahead.

## 6. Verification of this branch

[run] Frontend, local, Node 24.21.0: the three zoomlab-verdict suites pass (20 tests); the full suite is 400 suites /
4602 tests, 0 failed; the ESLint ratchet is green. No backend code changed. Ledger: the finding, the satisfied
read-back, the re-entered commitment and this audit's findings are appended, with `--reconstructed` on the lines that
record what another session's closed PR had carried.
