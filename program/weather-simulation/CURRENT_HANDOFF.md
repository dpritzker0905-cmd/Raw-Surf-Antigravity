# CURRENT HANDOFF — Program 13.0, Missions 1–3

**This file is written so a fresh session can continue WITHOUT rereading the 12+ audits.**

| | |
|---|---|
| **Date** | 2026-08-14 |
| **Branch** | `dev` |
| **Baseline** | `1f4e5149` |
| **End commit** | `3afaf8b1` (+ a docs commit; ahead 4, **not pushed**) |
| **Missions** | 1 · WS-OBJ-207/WS-CAN-0062 geometry disclosure **CLOSED** · 2 · spot_ratings.py split **CLOSED** · 3 · WS-CAN-0064 latency **DIAGNOSED, blocked** |
| **Result** | 2 verified complete, 1 diagnosed and blocked on an owner read |
| **Pushed / merged / deployed?** | ⛔ **NO.** Not authorized. Nothing left this machine. |

---

## 0. If you read one thing

> **The audit's authorized mission was already done, and of the three parts of the next one, only
> one could legally start. The other two are blocked by the same thing — and I proved it.**

Audit 12.2 authorized `WS-CAN-0066`; it had already shipped (`a1b5aac3`). The re-derived next
position is the *provenance visit* — `WS-CAN-0005` + `WS-CAN-0062` + the `run_time` display half.
`WS-CAN-0005` carries its own recorded stop condition (*"a PARTIAL fix is worse than none"*), and I
found that it **also blocks the display half**, which the path had not stated. So the visit is not
one visit. `WS-CAN-0062` was the only part that passed the readiness gate, and it is now closed.

---

## 1. What changed

| file | change |
|---|---|
| `backend/services/weather_pipeline/spot_geometry_readiness.py` | **+`caveat(verdict)`** — the compact form of `summarize()`, beside it, so readiness prose keeps one owner |
| `backend/services/weather_pipeline/spot_ratings.py` | one guarded consumption site appending the caveat to `why` |
| `backend/routes/admin/surf_forecast.py` | declares the new `RATING_GEOMETRY_CAVEAT` switch in `_RATING_FLAGS` |
| `backend/tests/test_spot_rating_geometry_disclosure.py` | **new**, 10 tests, guards lane |
| `.github/workflows/ci.yml` + `backend/tests/test_ci_floor_staleness.py` | guards floor raise (the mandatory **pair** of edits) |
| `program/weather-simulation/**` | the living control system (new) |
| **— Mission 2 —** | |
| `spot_ratings.py` → `spot_ratings_precompute.py` | the precompute + Supabase-L2 lane split out at the 800-LOC ceiling; **800 → 351** LOC, lane 498. **No behaviour change** — `precompute.rate_one_spot IS spot_ratings.rate_one_spot`, asserted |
| 10 production + 7 test import sites, 5 guard path-lists | repointed; `test_spot_rating_module_seam.py` (new, 11 tests) pins the ONE-WAY dependency |
| **— Mission 3 —** | |
| *(no code)* | `/api/conditions/batch` **diagnosed**, not repaired — see §4 |

**Behaviour:** a spot whose shore orientation is coarse or unresolved now says so on the surface a
user reads. `degraded → ", coarse shore detail"`, `blind → ", shore direction unknown"`,
`full` and **ungraded (`None`) → nothing**.

**`confidence` was deliberately NOT changed.** Read `BLOCKERS_AND_DECISIONS.md` **D-1** before
touching it — the register's first-listed option was rejected on purpose, and a guard enforces the
rejection.

---

## 2. Five things that will cost you an hour each if you don't know them

1. **`BLOCKERS_AND_DECISIONS.md` D-3 — local browser verification of a backend change is a TRAP.**
   `useSpotRatings.js:299` hits the Supabase **CDN** first (production precompute), and the local
   frontend's `BACKEND_URL` points at **production**. A naive check renders pre-fix data and shows
   your fix absent. Both overrides are needed:
   ```js
   localStorage.setItem('__RAW_DISABLE_RATINGS_CDN__','true');
   localStorage.setItem('__BACKEND_URL__','http://127.0.0.1:8000');
   ```
2. **A new `os.environ.get` in a rating surface is a REGISTRY EDIT.** I added
   `RATING_GEOMETRY_CAVEAT` and 155 targeted tests stayed green; only the **full 152-file guards
   lane** caught it (`test_flag_lane_parity`). The registry's own comment records the same omission
   on 2026-08-04 by someone else. Declare it in `routes/admin/surf_forecast.py` **in the same
   commit**. Full note in `MISSION_HISTORY.md`.
3. **The 800-LOC ratchet is real and `--no-verify` is not the answer.** It blocked Mission 1 at 821
   and forced Mission 2's split. ✅ **`spot_ratings.py` is now 351 and the precompute lane 498** — both
   have headroom again. When you next hit the ceiling, the repo's own remedy is **move rationale to
   `docs/research/`, never delete it**, and *verify the content survives elsewhere before compressing*.
4. **A test that patches something must assert something only the patch can cause.** Mission 2 found
   `test_spot_ratings` patching `sr.rate_one_spot` while the caller bound that name at import time —
   the patch was dead and the test **still passed**, because the real function swallows errors and
   every assertion was structural. Same session: my consumer census was blind to `sr.<attr>` access,
   and the guard I wrote to catch that matched **its own docstring**, then died in a subprocess
   (`WinError 6`) *only when run beside other tests*. **"Passes in isolation" is not "passes."**
5. **The full guards lane takes ~26–28 min on this box** (**153 files, 1741 tests**), and `-q` output
   is block-buffered, so it looks hung when it isn't — do not conclude it stalled from a static byte
   count. chain ≈13 min (786), estate ≈2 min (372, **2,864 skipped**). Stop the dev servers first;
   they compete for CPU. Do not trust arithmetic for the floor; run the lane.

---

## 3. Evidence — where it is and what it proves

`IMPLEMENTATION_EVIDENCE_INDEX.csv` indexes all 11 artifacts. The three that matter most:

- **The defect, live on production** (`evidence/network/WS-CAN-0062-live-before-after.txt`):
  **8 distinct `why` strings served byte-identically across BOTH full and degraded geometry**,
  n=87, 2026-08-14T18:00Z. Kennedy Space Center (degraded) was byte-identical to Playalinda Beach
  (full).
- **The science did not move** (`evidence/scientific-validation/WS-CAN-0062-disclosure-matrix.txt`):
  score `93.4` / level `epic` identical across `full`/`degraded`/`blind`/`None`.
- **It renders** (`evidence/browser/`): the Kennedy Space Center popup, read from a map asserted
  settled, served by the local repaired backend — `~2.6 ft surf, 7s period, 1kt offshore wind,
  coarse shore detail · HIGH CONF`.

Guard behaviour: **4 failed** on the known-bad tree, **10 passed** repaired, **2 failed** with the
repair disabled (`RATING_GEOMETRY_CAVEAT=0`) — red in the correct direction, for the correct reason.

---

## 4. Next mission — recommended, with the reason

**Read one value, then decide.** Mission 3 diagnosed the worst route in the system and stopped one
step short of a repair, on purpose.

> ⭐ **THE NEXT ACTION IS A ONE-MINUTE ADMIN READ, NOT A CODE CHANGE:**
> **what is `SPOT_RATINGS_CONCURRENCY` set to on the production Render service?**
> `/admin/surf-forecast/status` reports it (admin-gated — an owner or admin session must open it).

Why that, and not a fix: `/api/conditions/batch` is **perfectly linear at 0.380 s/spot** on
production (n=2…87, stdev 0.031), crossing 10 s at **n ≈ 26** — and the declared concurrency of 6
buys *nothing*. But the same code path parallelises **7.28× locally**, so the serialisation is
**environmental, not algorithmic**. The flag's value decides which repair is correct, and they are
opposite repairs. Full forensics + the decision table:
`evidence/performance/WS-CAN-0064-latency-forensics.md`.

⛔ **DO NOT just raise the concurrency.** `SPOT_RATINGS_CONCURRENCY` drives **two** unrelated
semaphores — `conditions/batch` **and** the map's `/spot-ratings` glyph endpoint — on a 1-CPU serve
box with a three-incident melt history. Any change is a two-surface change and must be measured on
both.

⭐ **The architectural half, whatever the flag says:** `/spot-ratings` has a precompute + CDN lane
(`spot_ratings_precompute.py`); `/conditions/batch` has **none** — it recomputes every spot on the
serve box on every request. If the flag reads 6, that gap *is* the finding, and it belongs to
WS-OBJ-401 as much as WS-OBJ-302.

**Co-scope `WS-CAN-0009`** (nine 200-with-error-body sites, four leaking `str(e)`) — same file,
`routes/surf_data/conditions.py`, one visit.

**Why not the others:**

| candidate | why not |
|---|---|
| `WS-CAN-0005` (position ②) | ⛔ **owner decision required** on its 4-step staged plan |
| the `run_time` display half | ⛔ blocked by the above — **D-2** |
| `WS-CAN-0067` register the optical harness | bookkeeping; blocks nothing, do it opportunistically |
| anything frontend | no user value until `WS-CAN-0039` unfreezes production |

**Three owner decisions are now the bottleneck** — `SPOT_RATINGS_CONCURRENCY`'s live value,
`WS-CAN-0005`'s staged plan, and `WS-CAN-0039`.

---

## 5. Work that must remain untouched

- ⛔ **`backend/uploads/forecast_cache/marine_global.json` and `wind_global.json`** — dirty in the
  working tree at baseline, **not mine**, deliberately never staged. Verify after any commit that
  they are still unstaged.
- ⛔ Do not weaken `test_flag_lane_parity`'s `>= 27` coverage floor — shrink-only by contract.
- ⛔ Do not couple `confidence` to `geometry_readiness` (D-1).
- ⛔ Do not flip any flag; do not delete any of the 261 runtime overrides; no Tier-3 research; no
  Finish Line C work.
- ⛔ **`git commit -o <paths>` only** — the git index is shared with concurrent sessions, and a plain
  `git commit` has previously swept another session's staged files into someone else's message.
- ⛔ **Do not raise `SPOT_RATINGS_CONCURRENCY` before reading its live value** — two surfaces, 1 CPU.
- ⚠️ `spot_ratings_precompute.py` starts at 498 LOC; `spot_ratings.py` now 351. Both have headroom.
- ⚠️ **Every push to `dev` is a production backend deploy.** Nothing here has been pushed.
