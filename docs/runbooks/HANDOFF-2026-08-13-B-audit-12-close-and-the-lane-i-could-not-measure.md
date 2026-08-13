# HANDOFF 2026-08-13 (B) — Audit 12.0 close: four tasks shipped, one I could not measure

| | |
|---|---|
| **Session** | 2026-08-12 19:17Z → 2026-08-13 04:30Z |
| **Branch** | `dev` · started `3ec3fd13` · ended in the 3f19ed70 neighbourhood |
| **My commits** | `2ac9631f` `3bc776d9` `55f2c068` `f8825291` `e88be1af` `2f9ed300` `4c45afc2` `af0be9df` `29ff21ab` `06b6334a` |
| **Concurrent session** | active throughout; roughly **2 of every 3 commits tonight were theirs** |
| **Source of truth** | `audit/weather-simulation-12.0/CANONICAL_TASK_REGISTER.csv` — **59 tasks** |
| **Predecessor** | `HANDOFF-2026-08-13-audit-12-and-four-things-i-got-wrong.md` (covers 19:17Z–01:45Z) |

This handoff covers the second half. Read the predecessor first for Audit 12.0 itself, the EURO/coverage
finding, and the four errors I made in the first half.

---

## 1. Shipped this half

| Task | State | Note |
|---|---|---|
| **WS-CAN-0045** | ✅ **Complete** | Non-vacuity guard. **Closes the last open stage of Audit 11.4's packet** |
| **WS-CAN-0059** | ⚠️ **Shipped, UNVERIFIED** | `.json` matched `.js`. Owner accepted unverified — §3 |
| Estate CI floor | ✅ | 334 → 347, measured from the gate's own run, not predicted |

### WS-CAN-0045 — the non-vacuity guard (`29ff21ab`)

`expect(hit).toEqual(miss)` passes just as happily when **both buffers are empty**, so the headline
byte-identity assertion survived a cache that stamped nothing. `expectBothPhases` asserts the buffer
contains both fully-opaque (sheltered, alpha 255) and fully-transparent (open, alpha 0) pixels.

**Validated as the packet specified**, not by assertion-counting: with `NARROW` mutated to all-land
the test fails on the guard, naming the missing phase (`hasOpen: false`). Restored → 54/54. Full map
surface 129 suites / 1362 tests.

⚠️ **Correction to my own earlier claim:** I first described a sibling test's `shelteredFrac > 0` as
implying non-vacuity here. It does not — fixtures drift, and a sibling passing tells this assertion
nothing. **A guard must live in the assertion it protects.**

---

## 2. The E2E fix that could not be measured (`af0be9df`)

`weather-simulation.spec.js` branched on `url.includes('.js')` — a **substring** test — and
**`.json` contains `.js`**. Every `.json` off an allowed origin was answered `/* mocked */` under
`application/javascript`, so any `JSON.parse` raised
`Unexpected token '/', "/* mocked */" is not valid JSON`.

Fixed with a path-based extension check. Verified by table across 10 URL shapes: `.js`/`.mjs`/`.cjs`
and extensionless scripts unchanged; **only `.json` flips**, including
`api.mapbox.com/styles/v1/*.json`, which MapLibre parses as a basemap style.

**Blast radius is one extension. It cannot make the lane worse.**

---

## 3. ⛔ Why WS-CAN-0059 is unverified, and why that is not an engineering problem

**Five verification attempts, five cancellations.**

```
31666463778  (started, outcome unknown at handoff)
31666263329  cancelled   4.0 min
31665646843  cancelled  11.8 min
31665513136  cancelled   2.5 min
31664977337  cancelled  10.9 min
31664569511  cancelled   8.5 min   ← the run on my own fix commit
```

**One completed E2E run in eight hours.** The lane needs 10–35 minutes uninterrupted; pushes arrived
every **2–4 minutes**. That is a coordination constraint between two agents on one branch, and no
amount of retrying moves it.

### Two traps I hit, both now written into the register

**Dispatch does not help — it actively harms.** `github.ref` is `refs/heads/dev` for *both* push and
`workflow_dispatch`, so a dispatch shares the concurrency group and **cancels the push-triggered run
it was meant to replace**. I advised the owner to dispatch on the opposite belief, then caught it
before firing.

**Truncated runs read as clean ones.** A cancelled run produces no failure artifacts, so the browser
split reads `0 / 0 / 0 / 0` and the JSON-parse error reads absent. I nearly reported that as a pass.
The analysis script now prints `NONE FOUND -- TRUNCATED. Everything below is meaningless.` and
renders the split as `n/a` when there is no totals line. **Zeros cannot render as good news.**

### Partial signal — explicitly insufficient

Across three truncated post-fix runs the mocked-JSON error never appeared and mapbox style 404s
consistently did. **That is the fix changing the failure mode as designed. It is not evidence the
lane is fixed** — a 404 on a basemap style may break the page as thoroughly as a bad parse.

### To verify, when the branch is quiet

Re-count the browser split against the pre-fix baseline **Safari 24 / Firefox 10 / Chrome 0 /
mobile 0**. If Safari and Firefox still fail, the substring bug was a *contributor* and **"why did
Chrome pass with the identical handler"** is the live question. **Do not call the lane fixed on one
green** — 6 pass / 28 fail across 34 runs means one green sits inside the noise.

---

## 4. Two shared-branch hazards, one of which refutes a standing rule

**① `stage BY PATH` does NOT isolate a commit.** Project memory says it does. I staged five files by
path with a commit message carrying the pool analysis; a concurrent session then ran its own commit,
which took the **whole index** including my staged files, and shipped them under an unrelated
message.

```
stage by path => my commit contains only my files ....... still true
stage by path => my files end up in MY commit ........... FALSE
only a PUSH is unisolatable ............................. FALSE, the INDEX is too
```

**Mitigation, used since:** `git commit -o <paths>` commits only the named paths regardless of index
state. **Durable lesson: put the reasoning in a FILE, not only in a commit message** — on a shared
branch a commit message is single-writer state and can be lost between `git add` and `git commit`.

**② Intermediate commits get no CI.** `e88be1af` has **zero** workflow runs — a concurrent push
carried it, so GitHub only started workflows for the tip. `2ac9631f` and `55f2c068` likewise have no
E2E of their own, and `paths-ignore` is evaluated **per-push, not per-commit** (an `audit/`-only
commit triggered E2E because it was pushed with code). **A per-commit reading of CI history says
things that did not happen.**

---

## 5. Open at handoff

| | |
|---|---|
| `06b6334a` | Mine, **blocked behind the other session's `3f19ed70`**, which adds 4 tests without raising a floor and is refused by their own new pre-push hook. It is a one-field register correction; it ships on their next push. **I did not `--no-verify`.** |
| E2E `31666463778` | Started 04:15Z, outcome unknown |
| WS-CAN-0026 | **Arms 2026-08-22.** On current data it **pages** |
| `big >3m` | n=0 across all 9 census runs — the ocean, not the sampler (0 of 204 buoys worldwide >3 m). Needs a **storm**, not more runs |

### Next, in order

1. **WS-CAN-0059 verification** — free; needs only a quiet branch.
2. **WS-CAN-0027** — Playwright `video: 'retain-on-failure'`, *after* 0059.
3. **WS-CAN-0058** — +3 to +5 tile regions, `WORLDWIDE_REGIONS_PER_CYCLE` raised in **both**
   workflows. Measure the pilot lane's fixed-vs-variable runtime split before exceeding `per_cycle` 5.

### Owner-only

**Unfreeze the production frontend** — 84 days behind, and it means the entire frontend test estate
validates an artifact users never receive · **one heartbeat URL** to make the uptime probe real ·
rotate the two committed credentials · the WS-CAN-0026 threshold decision before 08-22.

### Do not

Flip the default model (5.9% like-for-like, not 33.5%) · Zarr/JAX/SWAN · WebGPU · AI correction ·
`--no-verify` on the floor hook · **a sixth broad audit**.

---

## 6. Method notes worth keeping

- **A control that can void its own result is worth more than the result.** `model_skill_census.py`
  VOIDS if every model serves the same provider. That control turned "EURO is 33.5% better" into
  "coverage is the difference."
- **Prove red paths against real targets.** The uptime probe's positive-control test was green while
  nothing could reach it with a 503 — `urlopen` raises on 4xx/5xx. **Coverage of an assertion is not
  coverage of its reachability.**
- **A census with a moving denominator is not a census.** My CI watcher used `--limit 10`; newer runs
  pushed the failures out of the window and it reported "0 failed" for a commit with 2.
- **A green CI on the commit that adds tests does not mean the floors are current** — the staleness
  gate grades against the last *observed* run, so the debt lands on the next, innocent commit.
- ⭐ **Three times in one session, "grep for an existing one before proposing a new one" would have
  caught an error**: `model_skill_census.py` already existed, `OBS_BANDS` already had an importer,
  and `REGIONAL_CONFIGS` already covered the regions I was about to propose.
