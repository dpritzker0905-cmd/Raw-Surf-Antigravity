# START HERE — 2026-08-01 · THE ONE QUEUE

**This is the single entry point. It MERGES and SUPERSEDES three overlapping queues:**
`START-HERE-2026-08-01-the-direction-arc.md` (the direction arc + items 1-6) ·
`HANDOFF-2026-07-31-the-coverage-class.md` (items 7-11 + ERA5) ·
`HANDOFF-2026-07-31-NIGHT-the-sim-gained-space-and-found-the-gate.md` (the sim arc).
Those three stay as the FORENSIC RECORD — open them for the measurements behind an item. Nothing
was renumbered: **#1-#11 keep the IDs every memory file and handoff already cites**; #12-#15 are new.

**Read first:** `memory/standing-work-rules-user-mandate.md` (rules 9-15) →
`memory/THE-SURF-FORECAST-SCIENCE-canonical-chain.md` (the spine) →
`memory/THE-COVERAGE-CLASS-a-resource-smaller-than-the-view-2026-07-31.md` (the one structural
shape behind four defects).

Branch `dev` == `origin/dev` == `9b0339ca` (2026-07-31 late). Closed this arc: **#12** `7da00ca8` · **#18** `4246c56d` · **#13+#14** `79e1001a`.
⚠️ A parallel session is live in this tree (marine multi-bbox) — **stage BY PATH**, never `git add -A` (standing rule 18; I pushed its mutation test to `origin/dev` once).

---

## ⛔ P0 — OPS, TIME-CRITICAL TODAY

### #15 THE ERA5 CAMPAIGN IS STUCK, AND A SECOND ONE FIRES AT 21:30
Measured 2026-07-31 ~13:57:

    pid 71096  ALIVE, 15.1 h wall, CPU 610 s, write 1,105 MB
    two samples 60 s apart: write / readops / CPU BYTE-IDENTICAL
    the handoff recorded 607 s / 1,105 MB HOURS earlier — it has moved ~3 s of CPU since

⇒ **it is not queueing, it is not progressing.** Two independent problems:

1. **ALL-OR-NOTHING BY DESIGN.** `era5_deepen_climatology.py` uploads ONE inbox batch at line ~241,
   *after* all 150 spots (`--limit 150`). Nothing is banked until it exits, so 92 % complete is
   worth exactly 0 %. ⇒ **fix: checkpoint the inbox every N spots.** The inbox is append-only by
   design (invariant 6, one writer), so batching is safe.
2. **A CONCURRENT RUN IS SCHEDULED.** `RawSurf ERA5 Climatology Campaign` last ran 2026-07-30 21:30
   with `LastTaskResult=3221225786` (**Ctrl-C — a KILLED run reads as a missed one**) and
   `NextRunTime = 2026-07-31 21:30`. With 71096 still holding its 150 spots un-uploaded, the resume
   filter cannot see them, so the scheduled run will **redo the same 150 spots concurrently** and
   both will race the same inbox prefix.

**Do, in order:** decide whether to kill 71096 (it has banked nothing, so killing costs only the
CDS time already spent) → land the checkpointing change → re-run with `cmd >> <log> 2>&1`, NEVER a
PowerShell pipe (`Out-File` buffers until exit and made progress invisible for 15 h).
⚠️ CDS queueing makes this **~7× slower than the 32 s/spot the research predicted** — a planning
input for #3: the 4,000-spot catalogue is *weeks* at this rate.

### #12 ✅ ROOT FOUND AND FIXED — AND HAWAII WAS THE SMALL END OF IT (`7da00ca8`, on `dev`)
Swept run age per (model, domain, layer, region) across the live manifest, 2026-07-31 19:34Z, 12,147
products. Hawaii had already rotated back to 5.0 h — which is what proved this is **starvation, not
an outage**. What the sweep actually found:

| lane | run age |
|---|---|
| **GFS marine waves/swell_1/swell_2/wind_waves · east_australia** | **447.6 h = 18.7 DAYS** (3 products) |
| **GFS marine · uk_ireland** | **447.6 h** (**1** product) |
| GFS/ICON/EURO wind · uk_ireland, east_australia | 27.4–28.0 h |
| GFS marine · south_africa, mexico_centralamerica_pac | 21.9 h |

Design intent: 12 h.

⚠️ **THE SEVERITY IS ABSENCE, NOT STALE VALUES** (measured after first claiming otherwise). Every
uk_ireland / east_australia GFS-marine product has `valid_time` pinned to **2026-07-20T18:00** —
**0 of 4 and 0 of 12 cover the present** (`horizon_h` −266 h / −260 h). Last real ingest ≈ 07-13,
8-day horizon expired 07-21 ⇒ **a ~10-day ONGOING hole with no GFS regional 0.25° marine tile at
all**; the resolver falls through to the coarser global tier. ★★ The contrast that pins it:
south_africa 22.3 h / **340** products / covering = degraded; uk_ireland 447.9 h / **4** products /
covering nothing = absent. **Product COUNT is the tell.**

**ROOT:** `get_pilot_regions()` indexed `timestamp // (3*3600)` — a **3-hour**
wall-clock bucket — but its ONLY consumer is `forecast-ingest-pilots.yml` at `cron '45 3,11,19'`
(**8 h**); `forecast-ingest.yml` runs `INGEST_PILOTS=skip`. 24 h is a common multiple, so
`cycle_index % 4` takes only **3 of its 4 values daily** and one adjacent PAIR is never selected.
Simulated over 30 days of the real cron: **exactly 2 of 8 regions get ZERO hits**, and which two
depends only on **how many minutes into the job the lane runs** (+0 → hawaii+iberia; +180 →
uk_ireland+east_australia, the live 447.6 h pair). Job duration drifts ⇒ the starved pair moves.
⚠️⚠️ **The rotation test passed the whole time** — it feeds CONSECUTIVE cycle indices, which
production never delivers. A correct round-robin over a counter it does not receive.
⚠️⚠️ **Both freshness instruments were blind by construction:** `data_health._is_global()` and
`timeline_slot_census.py:54` each skip regional products — and the slot census asks a *different
question* (`valid_time` = COVERAGE). **An 18-day-old run covers every lattice slot perfectly.**
That is exactly how Hawaii's 75-hour run hid behind a current `valid_time`.
**Shipped:** stale-first selection (oldest-run region wins; **lane-scoped** — the whole-manifest
aggregate reads 5 h fresh everywhere and would hide it), kill switch `PILOT_REGION_STALE_FIRST=0`,
manifest-read failure falls back to the old rotation, + `scripts/product_run_age_census.py`
(per-tier thresholds, `--fail-on-stale`, refuses to report on empty input) wired into
`data-health-monitor.yml`.
⛔ **NOT YET TRUE IN PRODUCTION** — this is on `dev`; scheduled workflows run from `main`. The 8
CRITICAL lanes stay red until `main` has it and one pilots cycle runs. **Merging is the fix.**

<details><summary>Original report (superseded — kept as the forensic record)</summary>

### #12 HAWAII'S WIND PRODUCT IS BUILT FROM A 75-HOUR-OLD MODEL RUN
Measured 2026-07-31 17:00Z at the current top-of-hour:

    Pipeline  gfs_wind_wind_hawaii             run 2026-07-28T14:40Z   age 75.0 h
    Mavericks gfs_wind_wind_us_west_coast_socal run 2026-07-31T08:10Z   age  9.5 h
    Cocoa     gfs_wind_wind_florida_east_coast  run 2026-07-31T08:10Z   age  9.5 h
    Bells     gfs_wind_wind_global_coarse       run 2026-07-31T14:44Z   age  3.0 h

The product's `valid_time` is CURRENT, so nothing flags it. **Every North Shore rating has been
scoring wind from a 3-day-old forecast** — wind is 0.60 of the quality blend *and* a multiplicative
veto. Marine at the same coordinate is current ⇒ wind-specific, not a region outage.
★ `timeline_slot_census.py --fail-on-dead` cannot see it: it checks `valid_time` **COVERAGE**, not
**RUN AGE**. ⇒ sweep run-age per (domain, region) first — there may be more than Hawaii — then fix
the ingest rotation and give the census a run-age check.
*(A task chip was spawned for this: `task_98ed9f35`.)*
</details>

---

## ★★★ P1 — THE ONE STRUCTURAL CLASS (highest leverage in the repo)

> **A resource is selected without a hard requirement that it CONTAIN what it must cover, and when
> coverage fails the code DEGRADES SILENTLY instead of refusing.**

Four open defects are this one shape. Fixing the shape is worth more than fixing any of them.

### #11 THE HALO — the mask shrank as the viewport grew
| zoom | viewport lng | mask bounds | engine verdict |
|---|---|---|---|
| 8.18 clean | −81.29 … −79.21 | **−94,12,−64,44** (30°×32°) | `reason:"off"`, covers **true** |
| 8.03 halo | −81.62 … **−78.79** | **−83,26,−79,31** (4°×5°) | `reason:"coverage_gap"`, covers **false** |

⭐⭐ **STRONGEST LEAD, VERIFIED 2026-07-31:** the GRID lane has `shouldRejectResolutionDowngrade`
(`marineCommitArbiter.js`). The MASK lane has **no equivalent**. Its only drop guard,
`_nonCoveringDrop` (`WebGLMarineEngine.js:1308`), is gated `z < 4.4` — **outside the user's
6.74-8.03 band entirely**. Port the no-shrink guard: *a new mask may not span less than the
incumbent while the viewport grows; if none covers, refuse rather than paint coarse.*
★ The engine ALREADY computes `_overlayCoversViewport` (:811) — **the Jacobian variable is the
ACTION ON FAILURE, not a threshold.**

### #8 STALE RESIDENT GRID ON LAYER SWITCH
Same shape: a world grid "covers" everything, so nothing forces a refetch. Client-side retention,
z7-8.74.

### #7 THE WAVES ARROW DISAGREES WITH THE INFOBOX — ⛔ STILL THE USER'S #1 REPORT
    z8.2   cellDeg 0.25 (regional)  arrow ~87°  == the marker ✓
    z7.53  cellDeg 2    (global_mid) arrow 303.1°
    z6.74  cellDeg 2    (global_mid) arrow 303.1°     ⇒ a ~216° reversal at the tier boundary

A 2° block near a coast is mostly open water; its energy-weighted mean lands on the OFFSHORE-moving
windsea while the beach cell is swell-dominated. **Correct math, wrong footprint.**
**Order of work:** (a) find the partition-availability loss — **ours 0.6449 / 0.9067 against
upstream 39/39 and 480/480 = 1.0000, so ~35 % is lost between fetch and stamped product; ⛔ FIND
THE LOSS, do not lower the `availFrac ≥ 0.95` gate** → (b) change the ranking at the
`dominant_swell_anim` hook from "biggest swell" to **onshore energy flux `P·cos(Δθ)`**, excluding
offshore trains, degrading to total-field where `shore_normal_deg is None` → (c) re-measure with
the ladder → (d) ingest cycle → (e) confirm on the user's screen before claiming anything.
⚠️ For SWELL the ARROW is right and the MARKER was wrong — **do not fix toward the marker.**
⚠️ `WAVES_ANIM_DOMINANT_SWELL` is a repo variable absent from `_RATING_FLAGS` ⇒ invisible to the
lane-parity guard. Register it.

### #16 THE INSTRUMENT THAT WOULD HAVE CAUGHT ALL OF THIS — build it FIRST
**No instrument logs mask coverage.** ~20 lines on `probe_marine_direction_ladder.js`: walk a zoom
PATH and log `overlayMask.reason` + `maskId.mb` + viewport bounds at every rung.
⚠️⚠️ **This class is PATH-DEPENDENT** — a settled screenshot or a single-rung ladder proves
NOTHING; the resource you get depends on zoom HISTORY. ⚠️⚠️ Run ladders on **port 3009**
(`frontend-verify`), NEVER 3001 — 3001 is the preview pane and a headless ladder wedged it.

---

## P2 — COMPOSITION & CORRECTNESS

### #13 ✅ CLOSED (`79e1001a`) — GATED EVERYWHERE, BUT NOT IN THE RANKING
Owner decision 2026-07-31: **the hub and the sim answer "what will the app SHOW"** ⇒ both gate now.
Measured live BEFORE the change, 999 spot-hours (4 regions x hours 0/24/72):

    confirmed = None on 97.9% of served spots
    gate BINDS 66/999 = 6.61%    +0h 2.40% -> +24h 7.51% -> +72h 9.91%
    raw >= 70  66/999 = 6.61%    <-- IDENTICAL COUNT
    largest single drop 24.0 pts, at +72h

★★ **That identity is the safety argument:** every spot-hour that would read good-or-better is
already capped on the map, so a surface that CANNOT find confirmation caps at 69.9 — exactly what
the map shows. **A lookup miss lands on agreement**, which is why `confirmation_for` returns `None`
on a miss and never falls back to something weaker.
⭐⭐ **RANKING IS NOT DISPLAY.** `sim_compare` ranked on `-quality_rating`; gating that key would
collapse 97.9% of spots into one **69.9 tie** and order them by *which happens to carry an
observation* — in the one query where discrimination among GOOD spots IS the product. ⇒ **displays
gated, ranks raw.** Third instance of this shape ⇒ **grep for `key=`/sort whenever you add a cap.**
⚠️ **`sim_briefing.summary_line` has no hour in scope and stays UNGATED** — flagged, not faked.

<details><summary>Original report (superseded)</summary>

### #13 THE OBSERVATION GATE RUNS AT 3 SURFACES AND NOT AT THE 2 A SURFER READS — owner decision
| surface | gates? |
|---|---|
| precompute → glyph payload · live spot-ratings route · map rating band | ✅ |
| **spot hub (`spot_conditions`) · weather sim (`sim_rating`)** | ❌ |

Live: Moss Landing serves **83.9 `good`** (`raw_score` 95.9, `confirmed:'good'`); the sim says
**95.9 `epic`**, heights agreeing to 0.59 %. Shipped so far: the sim REPORTS it
(`parity.quality.observation_gate` + `matches_ungated_model_score`). **The decision is whether the
hub and sim should also gate** — i.e. whether the sim answers *"what will the app show"* or *"what
does the model say"*.

</details>

### #14 ✅ CLOSED (`79e1001a`) — POST-STEP REGISTRY + A NEGATIVE CONTROL
`test_rating_composition_parity.py` AST-extracts each surface's `rating_score(...)` call, so a step
applied AFTER that call (the obs gate) had no argument to declare — **every test in that file passed
throughout the divergence.** ★ A guard that inspects one shape cannot report a defect of another.
Added `POST_STEPS` over all four gating surfaces.
★★ **AND IT WAS MADE TO FAIL ON PURPOSE:** pinned by a NEGATIVE CONTROL (`surf_rating` /
`surf_transform` must return False), because a green guard is not evidence a guard works — without
it the parametrized test stays green even if every surface drops the gate. **Add a negative control
to any "every surface does X" test.**

### #1 GEOMETRY WIRING
`geometry_reject_reason` backfill FIRST (`backfill_geometry_reject_reasons.py`, committed, **never
run**, has `--dry-run`; 413 rows, mostly gate-REJECTED — a naive reconcile burns 413 × 22 s
reproducing rejections) → reconcile job (direct SQL; **REST PATCH is 403 by RLS**) → overlay
rehydrate from the DB at serve-box boot.

### #4 Kr + H1/10 — **TOGETHER, NEVER SEPARATELY** (they cancel at 0.988×; alone = +25.5 % too high)

---

## P3 — PRODUCT GAPS (researched 2026-07-31; the workflow is STORM → SWELL → SPOT)

* **#12 HAWAII WIND — 75-HOUR-OLD RUN — spawned task `task_98ed9f35`, see the P0 section above.**
* **#9 NO PERIOD LAYER.** First-class at the market leader, absent here, and it is the single field
  that separates a rideable groundswell from chop at the same height. Surfers filter at **≥10 s**.
* **#10 THE INFOBOX NEVER DECOMPOSES.** It shows one blended number; the individual trains
  (h / T / dir per partition) already ride the response (`response.partitions`).
* **Name WHICH train the animation shows.** With onshore ranking the arrow becomes a CHOICE; an
  unnamed choice reads as a bug.
* Keep total HEIGHT on the Waves layer (industry standard); change only the DIRECTION ranking.

---

## P4 — ACCUMULATION-GATED (autonomous; check the logs before touching)

* **#2 Climatology → gonogo → `RATING_LOCAL_SIZE`** — inbox batches land daily (OM 06:10, ERA5
  21:30); then `python scripts/local_size_gonogo.py` against the owner anchors. ⚠️ **the flip is
  3 lanes together** and an owner decision.
* **#3 Skill verdict (~2 weeks)** — `forecast_skill`: per-source × per-lead MAE vs Open-Meteo on
  NDBC truth. **This is the gate for the 4,000-spot expansion** — and see #15's CDS rate.
* **#5 `SURF_PARTITIONS` flip** — measured cost + A/B in hand; **enable everywhere or nowhere**.
* **#6 Per-partition `dir_confidence`** — shipped for GFS; DWD/Copernicus fetchers still export it
  only for `wave_direction`.
* **Per-site height offsets** once retention holds independent weather systems per buoy.

---

## ✅ CLOSED IN THIS ARC — do not re-open

| | |
|---|---|
| run provenance on the glyph payload | `2e81bcf5` — `run_time` + `wind_run_time`, INTERNED (raw was +30.1 % on a CDN object) |
| the sim could not say WHICH SPOT | `8ef6d8a0` — `find_best_spot`, with the geometry-blind gate |
| sim quality parity (it graded height only) | `41983709` — and it found #13 immediately |
| divergence ATTRIBUTION | `75411144` — 4 level differences in, 1 real one out |
| SEVEN copies of the knots constant | `e6d4b5b9` — the "product event" fear died to 0 flips in 30,200 cells |
| `sim_explain`'s own constant | `a63962e9` — ⚠️ the original fix was never an ancestor of `dev` |
| the Canaveral vortex, both halves | `37b4a7ca` |
| partitions → rating, all 3 surfaces | `7502cc4b` (flag OFF) |
| swell-layer fabrication + laundering | `81c7bcb5` (gated OFF) |

---

## ⚠️ TRAPS — the ones that cost whole sessions

1. **Test the hypothesis against the FAILING INSTANCE before building.** Four fix hypotheses died to
   measurement in one night, each after being partly built.
2. **A green suite is evidence about CODE, never about the SYSTEM** — and below that: **is the
   commit even on the branch that ships?** (`git merge-base --is-ancestor`). A fix recorded ✅ sat
   on a side branch while the defect was live.
3. **A divergence COUNT is not a finding; an ATTRIBUTION is.** 4 level differences, 1 real.
4. **Never run the full suite in the background while editing source** — `inspect.getsource` tests
   read files live.
5. **Path-dependence defeats the harness** — record the zoom PATH (#16).
6. **Products carry `run_time` but no builder SHA** ⇒ "is my fix live?" is still unanswerable from
   the artifact for CODE (data provenance is now answerable — see #12's method).
7. **A flag has a value PER LANE.** Read the served payload, not this process's env.
8. **A scheduler test driven by `range(n)` proves nothing.** The pilot rotation test fed CONSECUTIVE
   cycle indices for months while production fed it a counter that skips — 2 of 8 regions got zero
   data and the test stayed green. **Drive schedulers from the REAL cron times.**
9. **COVERAGE ≠ FRESHNESS.** `timeline_slot_census` reads `valid_time` and an 18-day-old model run
   covers every lattice slot perfectly. Ask which question an instrument answers before trusting its
   green. (Both freshness instruments also skip regional products *by construction* — see #12.)

---

## ➕ ADDED 2026-07-31 LATE (forensics in `HANDOFF-2026-07-31-LATE-the-infobox-quantity-and-five-false-positives.md`)

* **#17 ✅ CLOSED (`5ae2d267`) — AND THE FRAMING BELOW WAS WRONG.** The box ALREADY pushed BOTH a
  `Height` card (offshore) and a `Surf` card (breaking, "(est.)"), and the Surf row renders at
  **12 of 12 real breaks** measured live. The actual defect was narrower: the offshore card was
  labelled **`Height`** — unqualified — and rendered **FIRST**, so it read as *the* answer.
  ⇒ renamed to **`Swell`**, and **`Surf` now leads** (domain standard; it is what the badge grades).
  **No numeric change.** ★★ When two quantities share units, **the LABEL is the entire correctness
  surface.** Measured offshore→breaking: `shoaling` **1.33–2.25× LARGER** (Sebastian 2.25, Cocoa
  1.64) · `shelf` **0.83–0.86× SMALLER** (Pipeline 0.83) ⇒ ⭐**`surf_regime` PREDICTS THE SIGN.**
  ⚠️ A code comment claimed FL reads *smaller*; it reads 1.42–2.25× **larger** — inverted on both
  counts, now replaced with measurements. ✅ a11y: `role=list`/`listitem` + per-row `aria-label`.
  ⚠️ **Not browser-verified** — port 3009 is held by a parallel session's dev server.
  ⛔ **#10's train-level decomposition is NOT delivered** — `partitions` is None at every site
  (SURF_PARTITIONS flag-off); it lands with the **#5 flip**.

<details><summary>Original report (superseded)</summary>

* **#17 THE INFOBOX DISPLAYS A DIFFERENT QUANTITY THAN ITS OWN BADGE.**
  `MapForecastOverlay.js:253` shows `useExactPoint.wave_height` (**OFFSHORE** Hs); `:405` grades the
  badge from `useExactPoint.surf_height_m` (**BREAKING**). Measured at Cocoa: 1.28 ft displayed vs
  2.05 ft breaking. It agrees with Windy because Windy shows offshore too. ⇒ label it as swell, or
  show `surf_height_m`. **And** the same expression falls back to the RENDERED GRID sample when
  `isExactPointAuthority` is false — the grid is coarse until `series_sharpen` lands, which is why a
  layer toggle "fixes" it. ★ `isExactPointAuthority` is the Jacobian variable.
</details>

* **#18 ✅ FIXED (`4246c56d`) — AND THE REPORTED RATE WAS A BOOLEAN OVER NEAR-TIES.**
  The original claim ("`T_total` exceeds every partition at 5 of 6 FL sites") **did not reproduce**.
  Measured live 2026-07-31 20:00Z, GFS point lane, 36 samples (6 FL sites × hours 0/6/12/24/48/72):

      ratio = T_total / max(partition T):  min 0.466  p25 0.672  MEDIAN 0.999  p75 1.000  max 1.330
      exceedances 7/36 = 19.4%   (not 5 of 6)

  ★★ **The median pinned at ~1.000 IS the healthy case** — the total's peak period is normally
  INHERITED from the dominant train — so a boolean `>` reads ordinary ties as defects. The seven
  exceedances split at a **natural gap near 1.08**: `1.0021 / 1.0476 / 1.0502` = noise;
  `1.1161 / 1.1308 / 1.1711 / 1.3298` = physically real (a peak up to **33% longer than ANY**
  partition). `PARTITION_MAX_TP_RATIO = 1.10` lands in the gap and splits them cleanly; a test pins
  it inside `[1.0502, 1.1161]`. ⇒ honest rate **~19% of sample-hours, ~11% material** — a
  correctness improvement to the decomposition, **NOT the blocker this was recorded as.**
  ⚠️ **It surfaced the recorded landmine:** adding the parameter broke a test double's arity, which
  revealed `point_surf_augment`'s broad `except Exception` would have turned that TypeError into a
  **silently disabled surf transform** (`resolve_partitions` is an INJECTED CALLABLE — arity is
  unchecked until call time). The partition call now has its own narrow try; `surf_height_m` is
  unaffected by any partition failure.
  ⛔ **DARK until the #5 `SURF_PARTITIONS` flip.**
* **#19 SEBASTIAN INLET OVER-AMPLIFICATION (lead, unverified).** Largest breaking height from the
  smallest offshore Hs, shortest Tp, deepest bar — ×2.19 vs Cocoa's ×1.60. Probe `magnet_factor`.
* **#7 UPDATE:** partly a RATING-MODE artifact — rating-OFF commits a degenerate 5×5/1.6° grid
  reading a uniform 27.9°; rating-ON pulls the 0.235° tile and reads ~89° (matches the point lane).
  **Re-run every direction ladder in BOTH rating states.**
* ✅ **Marine is NOT painting land** (0.000-0.030%, runs 0-2 px, real GPU) — after five false
  positives. `probe_land_bleed.js` encodes all five.
