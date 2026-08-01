# HANDOFF 2026-08-01-F — the sim asked its own env which curve production was on

**Read first:** `memory/standing-work-rules-user-mandate.md` →
`memory/THE-SURF-FORECAST-SCIENCE-canonical-chain.md` →
`docs/runbooks/START-HERE-2026-08-01-THE-ONE-QUEUE.md`.
**Predecessors:** `-D` (the sim reference audit) and `-E` (the cloud routines + the flip). This
continues **D §4a**, which had filed the symptom as *"CONFIG, not code"*.
**Topic memory:** `memory/sim-reads-the-served-curve-not-its-own-env-2026-08-01.md`.

Branch `dev` = `origin/dev` = **`0f7e0118`**. Two commits, both pushed and ancestor-verified. The
working tree still holds **the concurrent session's 12 files** — untouched, staged by path throughout.

---

## 1. THE DEFECT, AND WHY CONFIG COULD NEVER HAVE FIXED THE CLASS

Measured live on the owner's own machine before a line was written:

    get_weather_forecast("Mavericks")  ->  reference_size_m: null
    sim 54.6 `fair`   vs   served 31.9 `poor_fair`   delta +22.7   level_differs: true

D §4a diagnosed this correctly as far as it went — the `WeatherSimulation` entry carries `env:
undefined` in `.claude.json` and `env: {}` in `claude_desktop_config.json`, so `RATING_LOCAL_SIZE`
was unset and `reference_size_for` returned None on its **first line**. The prescribed fix was to add
the env var to both files.

**That would have fixed one machine and left the class open.** `RATING_LOCAL_SIZE` is *production's*
rollout lever; its authority lives in `precompute.yml`, `forecast-ingest.yml` and Render. A sim
process reading **its own process env** is not consulting that lever — it is guessing at it, and the
guess is wrong by default on every machine, CI job, or MCP client nobody hand-configured.

⭐⭐ **And nothing could detect it: a lookup miss lands on the global curve, WHICH IS THE BUG.** The
failure mode points toward looking correct — the recurring shape in this repo.

⇒ **The queue's own trap #7, verbatim: *a flag has a value PER LANE — read the SERVED PAYLOAD, not
this process's env.*** The principle was already written down; it had simply never been applied to
the size reference.

★★ **The app was already sending the answer.** `/api/weather/point` has served `reference_size_m`
since the flip (measured live: Mavericks 1.931, Kommetjie 2.069, Pipeline 2.195) — **on the very
response the sim already fetches for the sea.** Same run, same coordinate, same hour. Reading it
there makes the sim MIRROR the composition rather than re-derive it, and needs **no env var, no
Supabase credentials, and no config anywhere.**
★ The precedent was verbatim in the same function: `partitions` are carried so *"the sim grades the
SAME sea state the app served — the sim itself adds no fetches and no flag of its own."*

---

## 2. WHAT SHIPPED

| sha | what |
|---|---|
| **`5f19ac7d`** | the sim reads the served size curve; trust boundary; 22-test guard; closes E open #2 |
| **`0f7e0118`** | guard floor 40/555 → 42/580 from the gate's own run (D §4f), + a correction |

**Threaded at ALL FOUR rating call sites** — `get_weather_forecast`, both sides of the what-if delta
bound to **one** `_served_ref` variable, and `sim_window` per hour — **and at BOTH resolutions inside
`calculate_surf_rating`**, so one payload cannot report a quality and a `size_verdict` graded on
different curves (the `f504d52b` defect, folded inside a single answer).

**Precedence: served > hand-tuned spot constant > flag+blob.** The middle rung is `f504d52b`'s
principle — *a constant measured for a NAME has no claim over a live row's own measurement* — and a
served value is the strongest such measurement, being the number the app actually graded with.

**I/O is strictly better.** A served reference answers *before* the blob is considered, so it removes
the blocking 10 s climatology dial from the opt-in what-if path that previously had to make it. The
zero-network invariant is untouched.

### Live A/B — 12 catalogued spots, 6 coasts, through the REAL fetch against production

    |delta| vs served   BEFORE median  9.9  max 47.2      LEVEL differs  BEFORE 9/12
                        AFTER  median  5.1  max 18.8                     AFTER  6/12
    Trestles +47.2 -> -8.3    Malibu +45.1 -> -13.4    Kommetjie +37.3 -> +3.6

⚠️ **v1 of this probe was confounded and I threw it away.** It used HARDCODED coordinates and let
`fetch_served_rating` pick the nearest catalogued spot **unbounded** — comparing a forecast at *my*
coordinate against a rating at *theirs* (the recorded *parity is blind to a wrong coordinate*). v2
drives production's OWN catalogue and **REFUSES** any row whose served `spot_id` differs.

---

## 3. ⛔ NOT CLOSURE — THE RESIDUAL IS ATTRIBUTED, NOT COUNTED

Fitting the reference that *would* reproduce each served score puts the app's **CELL** reference a
**median 21.3% (max 52.5%, 4/10 over 25%)** away from it. That independently reproduces the
**25.8% / 53.0%** measured for the cell-vs-spot blob gap in **`-E` §3**.
★★ **Two independent measurements of the same gap agreeing is what makes this an attribution.**
★ The method validates itself: **Mavericks fits 1.86 — which IS the independently recorded spot p50.**

⇒ **The dominant remaining term is queue item E#1**: `point_surf_augment` serves the per-**CELL**
reference (`grid_size_climatology.reference_for(lat,lng)`) where the glyph uses the per-**SPOT** one.

⚠️ **Two Florida spots move AWAY** — Cocoa +18.0, Sebastian +18.8 — and both have small cell
references (0.432, 0.531). **The sign tracks reference size**: the same crossover signature that
identified the parity monitor's manufactured divergence in `-E`.

### E#1 is NOT a small edit — size it before starting
`/api/weather/point` has **no spot identifier** (`model/domain/layer/lat/lng/valid_time/
grid_product_id/grid_bbox` only). So either:
* **(a) a `spot_id` query param threaded from the frontend** — the infobox already knows which spot
  it is rendering; cost is one dict lookup. Cross-stack change.
* **(b) a coordinate→spot proximity match in the backend** — the `confirmation_for` pattern (2 km
  haversine over the precomputed L2 frames). ⚠️ Costs a **second blocking L2 read on the hottest
  endpoint**; it already makes one for the cell blob, on a 1-CPU box with a three-incident melt
  history.
⚠️ And engage with the existing comment at `point_surf_augment.py:74-85` rather than deleting it —
its "the band is what sits behind the infobox" argument is **correct away from catalogued spots**.
The fix is conditional: **spot reference AT a catalogued spot, cell reference elsewhere.**

---

## 4. FOUR OF MY OWN ERRORS — each a class

1. **MY VALIDATOR LET `inf` STRAIGHT THROUGH, and its own test caught it before shipping.** I
   guarded NaN with `v != v` alone. **The two non-finite shapes defeat the obvious guards in
   OPPOSITE directions:** NaN makes the whole score NaN (which `score_to_level` reads as the TOP
   bucket, **'epic'**) and inf drives `size_score` to **0.0** (reads flat). ⇒ `math.isfinite`, never
   a positivity or self-inequality check. ★ Numeric strings must **COERCE**, not be refused — the
   hazard a string poses is reaching the engine, and coercion is what removes it.

2. ⭐⭐ **MY FIX BROKE A NEGATIVE CONTROL, AND THE REPAIR IS THE FINDING.**
   `test_NEGATIVE_CONTROL_opting_in_does_reach_the_lookup` made a **real HTTP call to production**.
   Once the app began sending a reference there was legitimately nothing left to dial, so the control
   stopped observing anything — **silently emptying the zero-dial assertion it exists to license**.
   ★★ **A control that depends on a remote server's payload is not a control; it is a second system
   under test.** Repaired by stubbing provenance *without* the key — itself a real production state
   (older deploy, flag off upstream, no climatology at that cell).

3. ⭐ **I MEASURED junitxml BEHAVIOUR IN A BARE SCRATCH DIRECTORY AND GENERALISED.** A module-level
   `importorskip` emitted `classname=''` there, so I wrote "adds to `skipped`, NOT to the module
   count" into a commit message as a measured fact. The real run says **40 → 42 files**. Inside the
   `tests/` package pytest emits the dotted name and it DOES count. ★ **A measurement taken outside
   the configuration that actually runs answers an ADJACENT question — and reads exactly as
   confidently as the right one.** Corrected in `ci.yml`; the commit message is immutable.

4. ⭐ **A DEAD HYPOTHESIS, WRITTEN DOWN.** I believed `sim_health_probe`'s `rated.sort(key=-score)`
   + top-N **selected against** reference sensitivity (a high score means `size_gate` is saturated,
   where the reference has no leverage). **The data says the opposite:** mean |before−after| is
   **41.0** for the top-3 by served score vs **8.7** for the bottom-3 — the ranking is biased
   **TOWARD** the sensitive region. ⇒ **`-D` §4e's stated *rationale* is wrong.** The exemplars lane
   is still worth building, but for **known, independently verified values**, not for sensitivity.

---

## 5. HOW IT WAS VERIFIED

| # | check | result |
|---|---|---|
| A | two-sided reconstruction **before building** | control (None → 54.6) reproduces the deployed sim exactly; 1.86 → 31.8 reproduces the served glyph |
| B | guards in a **CLEAN `git worktree` at HEAD** | pass — depend on no symbol from the concurrent session's tree |
| C | **three mutations**, each caught by its own test | fix reverted → 6 red · only-the-score → 2 red · served gated behind the flag → 4 red |
| D | local composition sweep | **625 passed, 64 skipped, 0 failed** |
| E | CI on the pushed SHA | `backend-sim-composition-guards` **660 collected / 42 files / 588 passed / 0 failed** |
| F | `git merge-base --is-ancestor` × 2 | both on `origin/dev` |
| G | live A/B against production | §2 |

⚠️ **The worktree audit method has a blind spot worth knowing:** two `test_sim_whatif_baseline` tests
fail there for lack of the untracked, gitignored `dev.db` — **at unmodified HEAD too**, which is the
control that attributes them to the environment rather than to the change.

---

## 6. ⛔ OPEN — START HERE

1. ⭐⭐ **THE OWNER'S MCP SERVER STILL RUNS THE OLD CODE.** It is a long-running process, so
   `get_weather_forecast` will keep answering `reference_size_m: null` **until it restarts**. After a
   restart the fix applies with **no config change** — adding `RATING_LOCAL_SIZE=1` to the two MCP
   configs is now **optional** (it only re-enables the blob path as a fallback), where D §4a had it
   as required. **Acceptance after restart:** `why.inputs.reference_size_m` ≈ **1.93** (the cell
   value the endpoint serves) and `parity.quality.delta` ≈ **−1.4**, not +22.7. ⚠️ **`null` with a
   small delta is still NOT a pass.**
2. **E#1 — the cell-vs-spot reference gap** (§3). The dominant remaining term; route (a) or (b) is a
   decision, not a detail.
3. **D §4c is now actionable:** `reference_for_spot` **is on `origin/dev`**, so the duplicate
   `_REF_MAP_MEMO` inside `sim_rating.reference_size_for` can be collapsed onto it — two memos over
   one composition today.
4. **D §4e — the named-exemplars lane** for `sim_health_probe`, with the corrected rationale from
   §4.4 (known values, not sensitivity).
5. `weather_sim_mcp.py` is at **789/800 LOC** — the hook warns. The next addition needs an extraction
   first.
6. **`-E` open #3 is CLOSED:** the Forecast Calibration Census has now fired on `schedule`
   (run `30706418460`, `event=schedule`, success).
7. Still open from `-E`: the durable fastmcp fix (#5) and no deployed-SHA endpoint (#6).

★ **The most useful habit from this session:** when a previous handoff files something as *"config,
not code"*, ask **what makes the code depend on that config at all.** Here the answer was a
provenance gap — the sim was deriving one composition input from a different source than every other
input it uses — and the fix removed the config dependency instead of satisfying it.
