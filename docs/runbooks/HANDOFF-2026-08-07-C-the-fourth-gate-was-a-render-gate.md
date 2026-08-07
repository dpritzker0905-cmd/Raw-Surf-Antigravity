# HANDOFF — 2026-08-07 (C) · THE FOURTH GATE WAS A RENDER GATE

**4 commits, `f85fdeda` → `15a22720`, all pushed.** Predecessor:
`HANDOFF-2026-08-07-B-audit-10-and-the-queue-it-cleared.md`. That handoff's §6 queue is the
spine of this session: items **0, 1** and audit row **F** are closed, and item **2**'s
premise turned out to be wrong in a way that mattered.

---

## §0 THE HEADLINE

**AUDIT 10.0 found three gates between the ensemble and a screen and fixed all three. There was a
fourth, and it was the one every document pointed at.** The spot hub receives
`forecast_confidence` in its payload and renders nothing, because the only frontend file that
mentions the field is mounted exclusively by the *map's spot drawer*.

★ **The method that produced all three findings, stated once:** ask *what fraction of the real
input distribution did this check actually see* — and then answer it with a **denominator**, not a
count. Every finding below is a ratio that a count had rounded to "fine".

---

## §1 WHAT SHIPPED

| # | commit | what | evidence |
|---|---|---|---|
| 1 | `fabd5319` | **1 of 3 `nearest_*` spread branches was guarded — and it was the RAREST one** | mutation: 362 SURVIVED, 387 SURVIVED, 421 KILLED. Live reach: guarded site **1.4%**, unguarded **13.6%**, **90.5% of delivered spread untested** |
| 2 | `d42c635c` | **The frontend confidence suite tested a COPY** (audit row F, the matrix's last open row) | old suite vs component with the block **deleted** → **14 passed, rc=0** |
| 3 | `7a002e8b` | **The spot hub had the field and no consumer** | payload PRESENT on both endpoints, rendered page contains "confidence" **zero times** |
| 4 | `15a22720` | **E2E gated on the backend being current**, not just the frontend (queue item 1) | both gate paths executed live; redeploy measured at ~2 min |

---

## §2 THE THREE MEASUREMENTS THAT SHOULD OUTLIVE THE COMMITS

### 1. A count of branches is not a measure of coverage

`57c657f9` carried `speed_spread` onto three `nearest_*` branches and tested one. "1 of 3" reads
like 33% coverage. Probed against live production — 140 systematically-sampled `shore_normals`
coordinates, +6 h, EURO:

| branch | share of spots | spreads carried |
|---|---|---|
| `bilinear_ocean_masked` | 40.0% | 0 |
| `direct_point_api` | 29.3% | 0 |
| `bilinear` | 15.7% | 0 |
| `nearest_ocean_fallback` (**line 387, UNGUARDED**) | **13.6%** | **19** |
| `nearest_ocean_coarse_masked` (**the one site guarded**) | 1.4% | 2 |

**19 of the 21 spreads actually delivered — 90.5% — flowed through code with no test.** The guard
had landed on the rarest of the three paths. Line 362 served 0 of 280 probes: contract-only,
guarded anyway.

⇒ ★★★ **WEIGHT EACH BRANCH BY ITS SERVED TRAFFIC BEFORE CALLING COVERAGE ADEQUATE.**

### 2. Two sites, one label — so `interpolation_method` cannot discriminate them

`sampler.py:362` (≥2 corners, `sum_w == 0`) and `:387` (exactly 1 corner) **both** publish
`interpolation_method="nearest_ocean_fallback"`. A test aimed at either passes while only the other
runs. What discriminates them is the **warning** each appends — only 362 says "sum of ocean weights
is zero". Reaching 362 at all requires a point sitting **exactly on an interior grid latitude**
(`w21=(1-t)·u`, `w22=t·u`, so `u=0` zeroes both northern weights) with the two southern corners
masked.

⇒ ★★ **Prove discrimination with a mutation MATRIX, not a single kill.** After the fix each of the
four sites kills exactly one distinct test.

### 3. A capability reaches a screen only where something RENDERS it

`forecast_confidence` occurs in **exactly one** frontend file, `SpotConditions.js`, mounted by
`spot-drawer/SpotReportContent` ← `UnifiedSpotDrawer` ← `MapPage`. It lived only in the map's spot
drawer. Measured live at ANCÃO (`5db54ca6…`), model=EURO:

```
/conditions/{id}            -> forecast_confidence PRESENT
/explore/spot-details/{id}  -> forecast_confidence PRESENT
rendered /spot-hub/{id}     -> the word "confidence" appears ZERO times
```

⚠️ `Explore.js` matches a grep for "SpotConditions" — but that is a **state variable of the same
name**, the kind of hit that makes a consumer census read as covered when it is not.

⛔ **HANDOFF-2026-08-07 §10, AUDIT 10.0 §0b and HANDOFF-B §7 all prescribed "load a EURO spot hub
in a browser and look".** That check could never have succeeded, for a reason unrelated to the
sampler all three were investigating.

---

## §3 SEEN IN A BROWSER — the item §7 recorded as never done

Local dev server against the live backend, real production payload, after adding the block:

| theme | dot class | level |
|---|---|---|
| dark | `bg-emerald-400` | High |
| light | `bg-emerald-600` | High |
| beach | `bg-emerald-700` | High |

Three **distinct** classes; mobile 375 px width 317 px with `body.scrollWidth == 375` (no
horizontal overflow); no console errors; aria-label carries the full sentence including "not surf
quality" and "does not change the rating".

⚠️⚠️ **AND THE FIRST LOOK WAS A FALSE NEGATIVE.** With no `?model` the hub requests **GFS**
(`useSpotHubActions.js:15`), and GFS carries no spread at all — `wave_height_spread` has exactly
**one** producer, `ecmwf_opendata_fetcher.py:552`. The block correctly did not render, and "it
didn't show up" would have read as a broken change. **Use `/spot-hub/<id>?model=EURO`.**

⭐ `SpotHub` destructured only `t.isLight`. Any three-way class pair added there would have
rendered **beach as dark**, silently — so `isBeach` is now read and the guard asserts three
*distinct* classes rather than three truthy ones.

---

## §4 WHAT I GOT WRONG

1. **I let a script rewrite `sampler.py`'s line endings.** `read_text`/`write_text` on Windows
   turns LF into CRLF; the file showed as modified with a zero-line diff. Caught by checking
   `git diff --stat` against the status, verified byte-identical modulo line endings, restored.
   ⇒ **Mutation scripts must do byte-exact I/O.** Every later script does.
2. **I guessed `shore_normals.json`'s shape instead of inspecting it** and the probe died on a
   `KeyError` — the exact rule (§29: inspect one instance before parsing the set) I had just read.
   The real shape is `entries[i] = [lat, lng, normal_deg, spread_deg, break_depth_m]`.
3. **I read a browser probe before the fetch settled** and briefly recorded the confidence block as
   absent in light theme when it was present. The re-read with a proper wait corrected it. A race
   in the instrument looks exactly like a defect in the subject.
4. **Two `eslint-disable` directives I added were unnecessary** and lint flagged them as unused.

---

## §5 WHAT A SUCCESSOR SHOULD DISTRUST

* ⚠️ **The reach numbers are a 140-coordinate systematic sample at ONE valid_time (+6 h), EURO.**
  Quote them as that. `direct_point_api` at 29.3% is large and is the third category the audit
  warned must not be folded into "interpolated".
* ⚠️ **GFS reach is 0% and that is CORRECT** — there is no GFS spread to carry. Any "GFS reach"
  figure is about branch *reachability*, and reachability × a zero-spread source = zero delivery.
* ⚠️ **The spot hub block is a VISIBLE change.** It renders only under `?model=EURO` or a stored
  active model of EURO, so most users will not see it yet.
* ✅ **THE E2E SUITE IS GREEN — `31208159146`: 46 passed, 1 flaky, 0 failed (6.7 m).** First success
  after 15 of 26 runs failing since 08-06. The backend gate cost **0 s**
  (`started_at == completed_at == 18:45:35Z`): placing it after the installs meant the Render deploy
  had already finished. That is the design working, not the gate being skipped — the same step exits
  1 when the SHA does not match, verified directly against production.
  ⚠️ **ONE FLAKY REMAINS** — `weather-simulation … toggle and timeline scrubbing`, Desktop Chrome.
  **The gate removed the deploy race; it did not make the suite deterministic.** Do not read one
  green run as proof the whole class is closed — n=1, and this session already recorded a
  predecessor over-reading exactly that.
* ⚠️ **`concurrency: cancel-in-progress: true` means ANY push cancels the E2E run in flight.**
  Several "cancelled" runs in the history are just rapid pushes, not failures. If you want the
  result, wait for it before pushing again.
* ⚠️ **`timeout-minutes` went 25 → 50.** If the frontend and backend waits ever both run long, the
  job now burns up to ~45 min before failing. That is deliberate — at 25 it would have died on a
  generic timeout instead of printing which deploy failed — but it is a real cost.

---

## §6 THE QUEUE AFTER THIS SESSION

0. **Bilinear spread** (owner decision) — unchanged and still the highest-leverage item on this
   capability. The majority sampler path refuses by design; carrying a max-over-corners bound under
   its own field name would take reach from ~15% toward complete.
1. **The confidence thresholds are still `"calibrated": false`.** 15%/35% is legibility, not skill.
   `forecast_skill.py` accruing paired leads is what would make them defensible.
2. **The ICON/weather instrument** — log the manifest's per-lane `run_time` immediately before and
   after each publish, in BOTH workflows, for one cycle. Nothing else discriminates the two shapes.
   ⚠️ The lane is currently healthy (recovered; Data Health Monitor green again after 4 consecutive
   red runs) — **it will recur on the next overlapping cycle**, so the instrument must land before
   then or the evidence is lost again.
3. **Row Q, `ecmwf_opendata` half** (~53.5 s/run) — the GWAM half is done and its guard is the
   template.
4. **Tide wiring** (row H) — feed `tide_state_at`'s `height_m` from `rate_one_spot` /
   `spot_conditions`, then run the served delta census before flipping `SURF_TIDE_DEPTH`.
5. **Row P** — `rating_transform_grid` is 18.3 s at 80,089 cells cold, 100% cold bathymetry lookup.
6. **The drawer's own confidence block has browser evidence only through the hub's twin.** The
   drawer path (map → click spot → REPORT mode) was never opened in a browser this session; the map
   is canvas-based with no DOM markers, so it needs a pixel click after panning.

⛔ **Still owner-gated, untouched:** production frontend frozen at `3bd38a83` (2026-05-20), Vercel
failing 8/8, `RATING_LOCAL_SIZE`, and the seeded `dev-mock-user-id` admin row in the production DB.

---

## §7 WHAT THIS SESSION DID NOT COVER

- **No physics changed.** γ, `REFRACTION_KR`, `SURF_HEIGHT_H110` and `SURF_TIDE_DEPTH` are all
  untouched; the Pipeline anchor was not re-run because nothing in the height chain was edited.
- **The `nearest_ocean_fallback` zero-weight-sum site (362) has a guard but no observed traffic.**
  It served 0 of 280 live probes. The guard is a contract guard, not a traffic guard.
- **`multi_dir_conf`'s 80 MB transient** is still unmeasured (carried from §7 of the predecessor).
- **The GWAM guard still only runs `half=2`**; other halves, multi-region `bboxes` mode and the
  `DWD_GWAM_*_BLOCKMEAN=0` lanes remain unexercised by it.
