# HANDOFF — 2026-08-01 (D) · the sim's local size reference: verified, and three defects behind it

**Read first:** `memory/standing-work-rules-user-mandate.md` →
`memory/THE-SURF-FORECAST-SCIENCE-canonical-chain.md` →
`docs/runbooks/START-HERE-2026-08-01-THE-ONE-QUEUE.md`.
**Topic memory:** `memory/sim-reference-pinned-to-186m-and-two-agents-one-lane-2026-08-01.md`.

Brief: *"get the weather simulation system features working well; keep going in the queue"* →
*"wait until the other contexts commit, then verify, then fix"* → *"audit your work, show proof."*

---

## 0. WHERE THINGS STAND

Branch `dev`, tip **`776cb129`**. Nothing pushed — `origin/dev` is behind; **pushing is the next
person's call.**

| sha | who | what |
|---|---|---|
| `fade0c69` | concurrent session | the sim never got a local size reference; `allow_lookup` param |
| `862dbf29` `1fbd5e4e` | concurrent session | probe diagnostics; monitor had the flag not the data |
| `50e441bd` | concurrent session | the lookup imported a symbol only in an UNCOMMITTED tree |
| **`f504d52b`** | **this session** | the graft outranked the climatology; the I/O budget was keyed on the wrong fact |
| **`776cb129`** | **this session** | my own memo reset was dead code (found by the audit) |

⚠️⚠️ **A CONCURRENT SESSION SHARES THIS WORKING TREE AND HAS 13 FILES UNCOMMITTED**
(`routes/explore_discover/*`, `routes/surf_data/*`, `scheduler/surf_alerts.py`,
`point_resolution.py`, `spot_conditions.py`, **`spot_size_climatology.py`**,
`test_rating_composition_parity.py`, `scripts/geometry_backfill.*`, `shore_normals_overlay.json`,
`test_spot_hub_local_size_reference.py`). **STAGE BY PATH. NEVER `git add -A`** (standing rule 18).

---

## 1. THE DEFECT, PINNED BEFORE ANY CODE WAS WRITTEN

The sim graded every real spot on the GLOBAL 1.2 m curve while the glyph graded each spot's own
good day. Rather than infer it, the sim's own composition was run locally against the exact live sea
it reported for Mavericks (2026-08-01T13:00Z):

    reference = None (GLOBAL)  -> 45.3 fair   == the deployed sim's 45.3   <- CONTROL passes
    reference = 1.86 m         -> 27.3 poor   == the SERVED glyph, |delta| 0.00
    reference = 1.81 m         -> 27.6 poor   (the independently recorded Mavericks p50)

★★★ **REPRODUCING BOTH ENDPOINTS IS WHAT MAKES THIS AN ATTRIBUTION RATHER THAN A COUNT.** The
control — my local composition reproducing the deployed 45.3 exactly — is what licenses reading the
27.3 fit as meaningful. ⇒ the divergence was **entirely** the missing reference.
★ Reusable: **sweep the ONE suspected input across its sane range and find which value reproduces
the other surface.** If none does, the hypothesis is dead before you build.

---

## 2. WHAT I FIXED (`f504d52b`) — three defects, one root

### 2a. A HAND-TUNED CONSTANT OUTRANKED THE CLIMATOLOGY
`sim_spots._GRAFTED_KEYS` copied `reference_size_m` from `CATALOG_DEFAULTS` onto a **LIVE** row
sharing the name, and `reference_size_for` returns an explicit value **before** consulting the blob:

    Mavericks (live row)   grafted 4.0 -> 12.0 very_poor
                           climatology -> 27.3 poor   == SERVED exactly
                           global      -> 45.3 fair

⇒ `fade0c69` moved Mavericks from **+18.0 to −15.3** vs the glyph — still a LEVEL divergence,
*reversed*. Removed from the tuple. ★★ **The precedent was already in that same tuple:**
`orientation` is excluded for exactly this reason. **A constant measured for a NAME has no claim
over a live row's own measurement.**
★ The split now verified three ways: Mavericks + Montara (live) → None; **Pacifica State Beach
(`catalog_default`, no live row, id=`3`) KEEPS 1.2** — the offline path has no glyph to disagree
with and no real id to look up.
★★ **Parity now holds in EVERY state**, which is the argument: climatology present → sim and glyph
both use it; absent → both fall to the global curve.

### 2b. THE ZERO-NETWORK INVARIANT BROKE ON A WARM CACHE (`576dcbdd`)
`allow_reference_lookup=True` was justified by a comment: *"reached ONLY when the caller has already
paid for the fetch."* `baseline is not None` has **THREE** branches and two pay nothing — a PEEKED
cache hit and a staged `_SIM_OVERRIDES` entry.

    all five inputs, no hour, COLD cache -> 0 dials      WARM cache -> 2 dials

The warm case is the common one on a long-lived server, and is exactly the flow
`test_a_cached_forecast_is_PEEKED_not_refetched` calls *"what makes the delta free"*.
★ 3rd instance of **A CODE COMMENT'S FRAMING OF WHEN A PATH FIRES IS NOT EVIDENCE** (cf. #17, #20).

### 2c. `baseline_delta` COMPARED TWO DIFFERENT SIZE CURVES
`calc` omitted the flag while `base_calc` passed it ⇒ the what-if graded GLOBAL, its own baseline
graded LOCAL. Reported **"+16.9 better"** where like-for-like is **+9.8** — **7.1 points, 42 % of
the reported delta, was a curve switch the caller never asked for.** Same shape as the partitions
mismatch documented in the adjacent `_whatif_parts` comment (+12.5 of which +12.5 was composition).

> ### ★★★ ALL THREE COLLAPSE TO ONE ROOT
> **The I/O budget was keyed on "do we have a baseline" instead of "did the caller opt in."**
> One `_reference_lookup_ok = bool(omitted or hour)`, used by **BOTH** rating calls, fixes the
> invariant and the mismatch together. **A delta is only meaningful when both sides share a
> composition.**

---

## 3. THE AUDIT — what was proved, and how

| # | check | result |
|---|---|---|
| A | `git merge-base --is-ancestor f504d52b dev` | ✅ on the branch that ships (rule 10a) |
| B | guards run in a **CLEAN `git worktree` at HEAD** | ✅ **45/45** — no dependency on uncommitted symbols |
| C | mutation: restore pre-fix code | ✅ **both key guards go RED** (delta guard reports **23.5** while nothing changed) |
| D | blast radius `grep _GRAFTED_KEYS` | ✅ only `sim_spots` defines/uses it |
| E | three-way graft split re-measured | ✅ live→None, live→None, offline→1.2 |
| F | zero-network re-measured | ✅ **cold 0 / warm 0** |
| G | delta re-measured | ✅ **matched**, both sides reference 1.9 |
| H | live MCP discriminator | flag is OFF in that process — see §4a |

### ⭐⭐ THE AUDIT METHOD IS ITSELF THE FINDING
`git worktree add --detach <tmp> HEAD` and run the guards there. That is what proves a test does not
depend on **a symbol that exists only in another session's working tree** — the exact failure that
made `fade0c69` green locally and dead in the lane (`50e441bd`: it imported
`reference_for_spot`, uncommitted, so the deployed lane raised ImportError into a fail-open
`except` and graded the global curve **in silence**). **In a shared tree, passing tests are not
evidence about the branch that ships.**

### ⚠️ THE AUDIT FOUND A DEFECT IN MY OWN TESTS (`776cb129`)
Both new test files reset the memo as `if hasattr(SSC, "_ref_map_memo"): ...` — a name that lives
**only in the concurrent session's uncommitted tree**. On committed code `hasattr` is False, so the
reset cleared **nothing**:

    SSC._ref_map_memo exists (what the tests cleared) : False
    sim_rating._REF_MAP_MEMO exists (the real memo)   : True

The tests passed anyway — the memo is keyed on object IDENTITY and each test builds a fresh blob —
which is precisely what makes it worth fixing: the guard **looked** like it prevented cross-test
state sharing and did not. Now `assert`ed, negative-control verified.
★★ **A CLEANUP GUARDED BY `hasattr` DEGRADES INTO A SILENT NO-OP THE MOMENT THE THING MOVES.**

---

## 4. ⛔ OPEN — START HERE

### 4a. ⭐ THE OWNER'S OWN SIM IS STILL ON THE GLOBAL CURVE — IT IS CONFIG, NOT CODE
Measured live after the fix: `get_weather_forecast("Mavericks")` → `reference_size_m: **null**`,
sim 51.7 `fair` vs served 30.4 `poor_fair`, **delta 21.3, `level_differs: true`.**

★ **`null` is a DISCRIMINATOR, not a null result.** With the flag ON and pre-fix code Mavericks
would read the grafted **4.0**; with the flag ON and current code, ~1.81. Only the first line of
`reference_size_for` returns None ⇒ **`RATING_LOCAL_SIZE` is unset in that process.** Confirmed
independently:

    .claude.json                -> WeatherSimulation  env: None
    claude_desktop_config.json  -> WeatherSimulation  env: {}

⇒ **FIX (owner's machine, needs their approval — it is Claude's own config):** add
`"env": {"RATING_LOCAL_SIZE": "1"}` to the `WeatherSimulation` entry in **both** files, then restart
the server. It runs `backend/weather_sim_mcp.py` directly from the repo, so a restart also picks up
the code. ⚠️ Until then every local sim answer disagrees with production **for a reason that has
nothing to do with the code**, and any local "verification" of this feature is void.

### 4b. PRODUCTION VERIFICATION IS STILL OWED
Nothing is pushed. After deploy, the acceptance test is **one MCP call, no checkout**:
`get_weather_forecast("Mavericks")` must show `why.inputs.reference_size_m` **≈1.81–1.86** and
`parity.quality.delta` ≈0 (sim ≈27.3–27.6 vs served 27.3).
⚠️⚠️ **A null reference with a small delta is NOT a pass** — it means the curve never changed and
the two sides happened to agree.

### 4c. `reference_for_spot` IS STILL UNCOMMITTED — A COLLAPSE IS OWED
`spot_size_climatology.reference_for_spot` exists only in the concurrent session's tree.
`sim_rating.reference_size_for` therefore inlines `reference_map(load_size_climatology_l2_cached())`
**with its own `_REF_MAP_MEMO`**, duplicating the memo their helper also has. **When they commit,
collapse the two** — otherwise there are two memos over one composition.

### 4d. THE LOADER DOES NOT CACHE NEGATIVE RESULTS
`load_size_climatology_l2_cached` stores `None` then re-checks `if obj is not None`, so when the
blob read fails **every permitted call re-dials** (that is why the warm measurement read 2, not 1).
Harmless while the blob loads; a blocking 10 s dial per call when it does not. In
`spot_size_climatology.py` — **the concurrent session's file, left alone.**

### 4e. THE PARITY PROBE MAY NEVER SAMPLE THE SPOTS THAT WERE WRONG
`sim_health_probe` selects by **viewport + top-N per region** (deliberately: "names drift"). The
`california` bbox contains Mavericks, but a 27.3 `poor` spot will not make a top-N cut ⇒ the graft
defect was **invisible to the instrument**. Consider a "named exemplars" lane alongside the
viewports — the same lesson as *only the EXEMPLARS could validate the flip*.

### 4f. HOUSEKEEPING
* **`weather_sim_mcp.py` is at 778 / 800 LOC** — the hook warns. The next addition needs an
  extraction first.
* **A STALE WORKTREE pollutes repo-wide greps:**
  `.claude/worktrees/gracious-cannon-e4aed4` (branch `claude/sharp-jang-334fba`, `7a4351a2`) holds
  **pre-fix copies** of `sim_rating.py`/`sim_spots.py`. My first blast-radius grep matched it and
  showed the OLD signature. ⇒ **scope greps to `services/ routes/ scripts/`, or delete the worktree.**
* `backend/.env` points at **`weewaulkwfwlbhqemxma` = "Raw Surf App Dev"**, not production
  (`jnfbxcvcbtndtsvscppt`), whose `weather-products` bucket lists EMPTY ⇒ **no local run can read
  the real climatology.** Every local `reference_size_m` is None for that reason alone.

---

## 5. TRAPS ADDED THIS SESSION

1. **A `hasattr`-guarded cleanup is a silent no-op once the thing moves.** `assert` instead.
2. **Measure the function that performs HTTP, not the cached wrapper.** Stubbing
   `load_size_climatology_l2_cached` bypasses its 600 s TTL and inflated my first dial count.
3. **A dial spy must RETURN, not raise.** The lookup sits in a fail-open `except Exception` that
   swallows `AssertionError` — `fade0c69` shipped exactly that control-cannot-fail bug.
4. **The best guard was ARITHMETIC, not structural:** *omit all five inputs, change nothing, and the
   delta must be exactly 0.* It cannot pass by accident; mutation made it report 23.5.
5. **Two agents in one tree:** check `git status` **mtimes before designing**, not just before
   committing. My first design was clobbered mid-edit; I deleted it and adopted theirs.
6. **`git log` between your last look and your commit.** Three commits landed under me and one
   changed the function I was verifying.
