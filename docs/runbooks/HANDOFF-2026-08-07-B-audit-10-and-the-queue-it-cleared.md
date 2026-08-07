# HANDOFF — 2026-08-07 (B) · AUDIT 10.0, and the queue it cleared

**16 commits, `c0c61bda` → `707271ed`, all pushed, CI green.** Predecessor:
`HANDOFF-2026-08-07-audit-of-this-session.md`. The audit document itself is
`docs/research/MASTER-AUDIT-10.0-2026-08-07-sota-architecture-and-safe-upgrade-assessment.md`
(917 lines) — **that is the reference; this is the narrative and the open list.**

⚠️ **READ §4 FIRST IF SHORT ON TIME.** It is what I got wrong, and one of them I got wrong twice.

---

## §0 THE HEADLINE

**AUDIT 10.0 found that the capability shipped the previous night reached nobody, and the physics
thread the last three audits were organised around binds on 0.145% of served hours.** Both are now
measured, and rows G, E, H, O and Q of the resulting matrix are closed on evidence rather than
opinion.

★ **The method, stated once:** every proposal was priced before it was built. Two died to their own
measurement (row Q halved, then its GWAM half reverted mid-flight). Three separate times a *passing*
test or a *surviving* mutation turned out to be a **reachability** problem, not a correctness one —
and catching that distinction is what produced the three most useful findings of the session.

---

## §1 WHAT SHIPPED

| # | commit | what | evidence |
|---|---|---|---|
| 1 | `57c657f9` | **The ensemble reached 0 of 1,103 spots.** Three gates in series; root = `speed_spread` written only on `exact_match`, reachable only at a grid's 4 CORNERS | 0 of 1,103 served spot_ids, 0 of 35 live probes; reach after fix **0% → 20.0%** (EURO frame) / **4.8%** (GFS) |
| 2 | `ebc2b5b4` | A **235 MB `json.load` on the serving event loop**, at 3 GRIB-product sites | 7.089 s measured on the real payload vs `/spot-ratings` 264 ms warm; AST scan 54 → 52 |
| 3 | `8790194a` | **18 spots served the OFFSHORE height as surf height** — a 0.25° mask cannot see a small island | 18 promoted, 0 demotions, **1,368 coords bit-identical**, Pipeline anchor 29.50 ft |
| 4 | `5032a31f` | The coverage floor **could not fire** on the failure it was written for | a 99.1%-null product shipped claiming 336 h; `d(covered_h)/d(steps_failed) = +0.000` |
| 5 | `bda6c477` | **Tide → the depth cap**, physics only, `SURF_TIDE_DEPTH` default OFF | 5,544 cells byte-identical; `dFt/dη` +1.4→+2.7 ft/m on a 3.5 m reef, **0.000 inert** at 11.1 m |
| 6 | `e45efd53` | The loop guard for a **production-ON** flag entered its branch **0.06%** of the time | coverage 0.06% → **92.11%**; zero production lines changed |
| 7 | `ca83f5e0` | The all-NaN block: **production is clean, the fixture was blind** | 41,472 oracle comparisons, 0 differences; fixture reached 0 of 3,456 all-NaN windows |
| 8 | `d15f1ce2` | **GWAM regrid vectorized** — 10.10×, ~90.1 s/run | 234 tests passed; the bug that blocked it was mine (§3) |
| 9 | `707271ed` | E2E: the binding timeout was **per-assertion**, not per-test | trace forensics; corrects my own `35cd504d` |

Live at handoff: SHA `d15f1ce2`+, **all 9 lanes 2.3–3.3 h, pipeline `ok`**, memory 938/2048 MB (46%).

---

## §2 THE FOUR MEASUREMENTS THAT SHOULD OUTLIVE THE COMMITS

**1. The ensemble's three gates, and why the ORDER mattered.** An adversarial pass corrected me:
gates 2 and 3 (a pydantic drop, an 8-key route whitelist) are **latent**, because *pydantic cannot
strip a key that was never emitted*. Ranking them HIGH would have inverted the fix order and produced
a change that read as a no-op. ⇒ **When gates sit in series, find which one BINDS before ranking them.**

**2. The γ thread binds on 0.145% of served spot-hours; tide is 19×.** Over 227,088 real served
spot-hours: the depth-limited cap — everything γ, `GAMMA_MAX_STEEP`, the Weggel slope and the 12.96 MB
bed-slope asset serve — binds **0.145%**. Tide, absent and with its input already in `tide.py`, moves
**1.694% at a median 45.6%**. And 9.0 **censused the wrong slope**: `breaker_index` receives a live
proxy, and `bed_slope_at` reaches it at **zero call sites**.

**3. The Jacobian as a fingerprint, twice.** At the 18 open-ocean spots `dFt/dHs` was **exactly
3.28084 ft/m, constant** — the metres→feet conversion, i.e. the identity, i.e. no transform ran. For
the coverage floor, `d(covered_h)/d(steps_failed)` was **exactly 0.000** — an instrument whose
derivative w.r.t. its own subject is zero cannot detect it. ⇒ **A constant Jacobian equal to a unit
conversion is the signature of a SKIPPED TRANSFORM, and asserting on it is scale-free.**

**4. Row Q re-priced before building.** The recorded "~291 s, mid-res only, coarse loses 0.8×" did not
replicate: the incremental win is **~146 s** (the 412 s total includes NOAA, already wired), and coarse
is **1.10–1.16×**, a small win. ⇒ The prescribed "mid-res only" gate was unnecessary.

---

## §3 THE BUG I SHIPPED, FOUND, AND FIXED — worth reading in full

The GWAM wiring diverged from the scalar path, and I reverted rather than ship it. The batch forms
then proved identical to their oracles on all-NaN blocks (41,472 comparisons), which **located the bug
in my own hoisted branch**. It was:

```python
series[pi][om].append(_sanitize_om(om, _x if _x == _x else None))   # I normalised NaN -> None
```

`_sanitize_om`'s guard is `if x != x` — the NaN test — and **`None != None` is `False`**. So `None`
slipped past into `float(None)` → `TypeError`, and the enclosing `except` **nulled the entire variable
for that forecast hour**.

The forensic signature was the classification: **`num→None` 53,136, `None→num` 0, `num→num` 0.** A
purely one-directional wipe-out is an exception, not a numerical difference — and the `TypeError` had
been in the log the whole time.

⇒ ★★★ **A DEFENSIVE CONVERSION AT A BOUNDARY WHOSE CONTRACT ALREADY HANDLED THE RAW FORM.** This
repo's `None is not 0.0` discipline exists because NaN and None mean different things; I collapsed
them "helpfully". **The conversion was the defect.**

---

## §4 WHAT I GOT WRONG — the honest list

1. ⛔⛔ **I mis-attributed the E2E failures TWICE.** I said "red since `d9d01dfd`, a workflow-YAML-only
   commit", framing it as a transition. Measured: of 34 completed runs, **6 pass / 28 fail, and 18 of
   the 28 failures PREDATE it.** The one pass in between was an **island, not a boundary**. There was
   no cliff to explain, and I reasoned from one for two turns.
2. ⛔⛔ **I fixed the wrong timeout, then over-read one green run.** I raised the *per-test* timeout
   30 s → 90 s; the binding constraint is a hard-coded **`{ timeout: 10000 }` on the assertion
   itself**, which an enclosing timeout never reaches. The next run went 47/0/0 and I called it a
   distributional shift after **explicitly flagging n=1 as a caveat**. The two runs after: 46/1/0 and
   40/1/**6 flaky**. Corrected in `707271ed`.
3. ⛔ **My first GWAM mutation was a no-op and I nearly read it as a weak test.** Reassigning `depth_m`
   at the cap block cannot leak — `shelf_dissipation` consumed it 86 lines earlier. Same trap on tide.
   ⇒ **A surviving mutation may mean your test is weak, OR that your mutation was unreachable. Check
   which.**
4. ⛔ **I added a science switch without declaring it in `_RATING_FLAGS` — the guard caught me.**
   Nothing else would have. (Second time that guard has caught this exact omission.)
5. ⛔ **I lost a 4-minute test run to a phantom failure** by editing a source file mid-run;
   `inspect.getsource` reads the file on disk against stale line numbers.
6. ⛔ **I let `surf_transform.py` hit 811/800 LOC.** Fixed by moving measured rationale to the audit
   doc — never by deleting it.

★ **Every one of these was caught by a COUNT, a CONTROL, or two of my own numbers disagreeing. None
by a suite going green.**

---

## §5 WHAT A SUCCESSOR SHOULD DISTRUST

* ⚠️ **`forecast_confidence` reaches ~5–20% of spots, not "most".** The majority sampler path is
  **bilinear, which refuses BY DESIGN**. Carrying a bound there (max-over-corners, its own field name)
  is an **owner decision**, and it is the highest-leverage remaining item on that capability.
* ⚠️ **A SEVENTH sampler path exists that no audit enumerated: `direct_point_api`.** Where no regional
  tile covers the requested valid_time the resolver bypasses the grid entirely. Any reach number must
  count it as a **third** category, not fold it into "interpolated".
* ⚠️ **`SURF_TIDE_DEPTH` is OFF and NO serving caller supplies a water level.** The physics is proven;
  the wiring is a separate, separately-priced step. A test records that by execution and **fails the
  moment someone wires it** — which is exactly when row H's served delta census must be run.
* ⚠️ **`SURF_COASTAL_FROM_SHORE_NORMAL` is ON and MOVES SERVED VALUES** at 18 spots (heights +17% to
  +92%, scores +0 to +8.4, all upward). It is a correction, but it is visible.
* ⚠️ **ICON/weather recovered on its own** when the pilots run did not overlap. §1.8a narrows it to a
  shared-manifest lost update but **does not close it** — the 01:18Z `GFS/marine` write survived the
  same clobber, which no simple race story explains. **It will recur on the next overlapping cycle.**
* ⚠️ **All local timings are Windows/py3.14**; production is Linux/py3.12. Ratios transfer, seconds do
  not. The live figures (`/api/health*`, the 485.7 s EURO lane) are production and carry no caveat.

---

## §6 THE QUEUE AFTER THIS SESSION

1. **The E2E ordering fix** — gate the job on the **backend** being up, not just the frontend.
   `on: push: [dev]` starts the run and the Render redeploy simultaneously; the backend booted **140 s
   after** the run began. `707271ed` raises the budgets to match the app's own 60 s client; the
   ordering is the actual root and is unbuilt.
2. **Bilinear spread** (owner decision) — takes `forecast_confidence` from ~17% toward complete.
3. **The ICON/weather instrument** — log the manifest's per-lane `run_time` immediately before and
   after each publish, in BOTH workflows, for one cycle. Nothing else discriminates the two shapes.
4. **Row Q, `ecmwf_opendata` half** (~53.5 s/run) — the GWAM half is done and its guard is the template.
5. **Tide wiring** (row H) — feed `tide_state_at`'s `height_m` from `rate_one_spot` / `spot_conditions`,
   then run the served delta census before flipping `SURF_TIDE_DEPTH`.
6. **Row P** — `rating_transform_grid` is 18.3 s at 80,089 cells cold, 100% cold **bathymetry lookup**,
   and 14.6% of `GRID_SERIES_DEADLINE_S` before a byte is serialised.

⛔ **Still owner-gated, untouched:** production frontend frozen at `3bd38a83` (2026-05-20), Vercel
failing 8/8, `RATING_LOCAL_SIZE`, and the seeded `dev-mock-user-id` admin row in the production DB.

---

## §7 WHAT THIS SESSION DID NOT COVER

- **The confidence UI has still never been seen in a browser.** It is now *possible* (products carry
  spread: `global_mid` 798/924, `florida_east_coast` 149/221) but it has not been done.
- **The confidence thresholds remain uncalibrated** (`"calibrated": false`). 15%/35% is legibility,
  not skill.
- **`multi_dir_conf`'s 80 MB transient** was never re-measured; the 24 MB figure covers height+scalar
  only.
- **The GWAM guard only ever runs `half=2`.** Other halves, multi-region (`bboxes`) mode, and the
  `DWD_GWAM_*_BLOCKMEAN=0` lanes are unexercised by it.
- **Memory index is 20.6 KB against a 17.1 KB compaction target** (down from 23.4 while adding two
  findings). Below the 24 KB hard limit, so nothing is lost — but the next session should retire a
  whole topic rather than shave prose.
