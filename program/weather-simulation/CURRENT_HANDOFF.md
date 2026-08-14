# CURRENT HANDOFF — Program 13.0, Mission 1

**This file is written so a fresh session can continue WITHOUT rereading the 12+ audits.**

| | |
|---|---|
| **Date** | 2026-08-14 |
| **Branch** | `dev` |
| **Baseline** | `1f4e5149` |
| **End commit** | *filled at commit — see `CURRENT_EXECUTION_STATE.json`* |
| **Mission** | **WS-OBJ-207 / WS-CAN-0062 — geometry-quality disclosure** |
| **Result** | **Verified Complete** |
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

**Behaviour:** a spot whose shore orientation is coarse or unresolved now says so on the surface a
user reads. `degraded → ", coarse shore detail"`, `blind → ", shore direction unknown"`,
`full` and **ungraded (`None`) → nothing**.

**`confidence` was deliberately NOT changed.** Read `BLOCKERS_AND_DECISIONS.md` **D-1** before
touching it — the register's first-listed option was rejected on purpose, and a guard enforces the
rejection.

---

## 2. Three things that will cost you an hour each if you don't know them

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
3. **The full guards lane takes ~1–2 h on this box**, and `-q` output is block-buffered, so it looks
   hung when it isn't. Stop the dev servers first — they compete for CPU. Do not trust arithmetic for
   the floor; run the lane.

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

**`WS-CAN-0064` EXPANDED + `WS-CAN-0009` — the latency visit (WS-OBJ-302).**

Critical-path position ④, and the highest-priority item that is genuinely **unblocked**. Audit 12.2
measured the 10 s breach population as **two** routes, not one (`conditions/batch` 11/11 over 10 s;
`grid_series` 4/22) — same file, one visit.

**Why not the others:**

| candidate | why not |
|---|---|
| `WS-CAN-0005` (position ②) | ⛔ **owner decision required** on its 4-step staged plan. Steps 3–4 are owner-facing. A partial fix is worse than none. |
| the `run_time` display half | ⛔ blocked by the above — see **D-2**. Do not schedule it first. |
| `WS-CAN-0067` (register the optical harness) | register bookkeeping; do it opportunistically, it blocks nothing |
| position ③ `WS-CAN-0022` (bounded lifecycle) | viable alternative if you prefer lifecycle over latency; both are unblocked |
| anything frontend (`WS-CAN-0068/0069`, the zoomlab HUD `LOADED`) | delivers no user value until `WS-CAN-0039` unfreezes production |

**Two owner decisions are the real bottleneck** — see `CURRENT_RELEASE_GATE_STATUS.md`:
`WS-CAN-0005`'s staged plan, and `WS-CAN-0039` (unfreeze the production frontend).

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
- ⚠️ **Every push to `dev` is a production backend deploy.** Nothing here has been pushed.
