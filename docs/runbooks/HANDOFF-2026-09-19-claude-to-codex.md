# Handoff — Claude → Codex, 2026-09-19

Written at the end of a full-sweep audit session. Everything below is dated and cites the command
or measurement it came from. Where something is *not* established, it says so.

---

## 0. State convergence (verified this session)

| thing | value |
|---|---|
| `origin/dev` | `0b531b6e` (merge of PR #45) |
| deployed backend | `0b531b6e…` — **matches dev exactly**, uptime reset confirmed |
| deployed frontend | `BUILD_VERSION = '3bd38a83'` — **the 2026-05-20 shell, owner-frozen** |
| `origin/main` | `89343d11` (2026-09-02), 157 behind dev |
| local worktree | on `claude/island-gate-grid-path`, clean apart from pre-existing cache churn |

⚠️ **`main` is the Netlify frontend and is owner-gated.** A PR based on `dev` opened against `main`
is a **158-commit / 522-file / +84,960-line promotion** that also unfreezes the pinned production
frontend. I nearly opened one today because a command named `main` as the base. **Always base on
`dev`** unless the owner is deliberately promoting.

---

## 1. What changed today

**PR #45 — merged, deployed.** The 0.083° island lane (`fb50fa6d`) shipped **default ON** behind a
header claiming it was *"inert by construction until a serving tier reads region_id island_*"*.
That was false. Manifest selection ranks on geometry, and island tiles are the finest resolution in
the estate, so they won selection without anyone reading `region_id`.

Measured against production: **13,600 of 34,166 live products (39.8%)**, 20 regions, all 0.0833°
against a next-finest 0.25°, across all four marine layers including `waves`.

**PR #46 — open, CI running.** Auditing the five remaining `manifest.products` consumers found
**two more holes**, both on `/api/weather/grid`:
- `grid_resolver_selection.find_candidates` — ranking breaks an intersection tie by **smallest
  coverage area**, so a zoomed-in island request selected the island tile **deterministically**.
- `grid_resolver` Step 6 overlap — ties fall to **list order** (the `mid_res_tier` trap again).

Exonerated with cause: `lattice_fill` (exact-match allowlist), `icon_marine_extension` (allowlist +
ICON/GFS model filter; island is EURO), `far_edge_hold` (requires `coverage_mode == "global_tile"`).

The predicate now lives in `services/weather_pipeline/island_gate.py` — **five sites, one
definition**. `tests/test_island_serving_gate.py` pins all five.

**Ledger reconciled.** `program/weather-simulation/COMPLETION_LEDGER_4.2.csv` had been abandoned on
2026-08-16 while 74 commits landed through the Codex PR stream. Reconciled row-by-row against `dev`:
**31/32 terminal → 36/28.**

---

## 2. ⛔ Owner actions — nothing below can be done by an agent

### 2a. SEVEN PUBLIC CREDENTIALS (the largest open risk in the project)

The repository is **`visibility=PUBLIC`**. Six GitHub secret-scanning alerts are `open` and
`UNRESOLVED` since **2026-04-15**, plus a Qdrant key found separately:

| type | location | notes |
|---|---|---|
| **Supabase Service Key ×2** | `backend/.env:4`, `upload_local.py:6` | **bypasses RLS entirely — full prod DB** |
| Stripe API Secret Key | `backend/.env:5` | |
| OneSignal API Key | `backend/.env:10` | |
| Mapbox Secret Token | `Explore.js:593` | |
| Google API Key | `MessagesPage.js:173` | |
| Qdrant Cloud key | `BRAIN_RULES.md:200`, `.antigravityrules` | removed from HEAD by `3d599eb7` |

⛔⛔ **The earlier history cleanup remediated NOTHING and looks like it did.** `backend/.env` is
untracked and gitignored, and `git log --all` finds **zero** commits touching it. That reads clean.
It is not: commits `1efc0086`, `d4dc6dc0`, `2a633370` are **reachable from 0 refs** yet
`GET /commit/1efc00866835` returns **HTTP 200 unauthenticated**.

⇒ **Unreachable is not unreadable. A rewritten history is not a revoked credential.**
`git log` answers "clean" and is wrong; only an unauthenticated fetch settles it.

Also: `secret_scanning_non_provider_patterns` is **disabled**, which is why Qdrant, `RENDER_API_KEY`
and the Copernicus password were never alerted on. Assume those exposed too.

**Branch `claude/security-committed-credentials` (`3d599eb7`) is pushed and has no PR yet.** It only
removes the key from HEAD and documents the incident — **it does not reduce exposure of anything
already published.** Rotation at each provider is the only remediation. Full 8-step checklist:
`docs/runbooks/SECURITY-2026-09-19-committed-credentials.md`.

### 2b. Other standing owner gates
- Production frontend unfreeze (pinned `3bd38a83` since May).
- `NEARSHORE_VAL_ENABLED=1` — see §4.
- An SLO for `grid_series` (measurement is done; only the threshold is missing).

---

## 3. 🔴 The PR pile-up — read this before touching anything

Six Codex PRs are open, and **they are on a collision course with each other and with `dev`**:

| PR | branch | ahead | **behind dev** | overlaps my changes |
|---|---|---|---|---|
| #44 | weather-forensic-five | 7 | **4** | `grid_resolver.py`, `viewport_helper.py`, `ci.yml`, floor test |
| #43 | weather-direct-provider | 4 | **4** | `ci.yml`, floor test |
| #27 | weather-paired-geometry | 15 | **43** | `ci.yml`, floor test |
| #23 | weather-opacity-evidence | 20 | **49** | `ci.yml`, floor test |
| #22 | weather-raster-transport | 1 | **49** | none |
| #15 | weather-accuracy-evidence | 17 | **65** | `ci.yml`, floor test |

**All six touch `ci.yml` and `test_ci_floor_staleness.py`** — the CI floor pair, which by design
*must move together in one commit*. Six PRs editing the same two constants will conflict pairwise,
and a careless merge resolution is exactly how a floor silently regresses.

⚠️ **#44 also rewrites `grid_resolver.py` and `viewport_helper.py` — two of the five island gate
sites.** If it drops a gate during conflict resolution, `test_all_FIVE_manifest_selection_sites_carry_the_gate`
is the thing that catches it. **Do not delete or weaken that test to make a merge pass.**

**Suggested order:** land **#46** first (1 commit, current, gates a live defect), then **#43** and
**#44** (only 4 behind), then rebase **#27/#23/#15** — or close them if superseded. **#22** is one
commit and conflict-free; it can go any time.

⭐ **Re-measure each floor from the lane's own reading after every merge.** The convention is
`MIN_PASSED = reading − 6`, `MIN_FILES` exact, and `_FLOOR_SET_FROM[lane]` moves in the **same**
commit. `backend-floor-staleness` goes red if the observed count runs too far *above* the floor, so
adding tests without raising it is also a red.

---

## 4. Instruments that lie — verify before trusting

- ⛔ **Nearshore Validation reports `success` while executing nothing.** Every step after "Arm gate"
  is `skipped` (verified on today's run). A green here is not evidence. Flagged 2026-09-08 and still
  unchanged.
- ⛔ **A deploy label is not a deployed process.** Setting a Render env var did **not** restart the
  box: config read-back said `"0"` while `/api/health` still showed **31h56m uptime** and the lane
  kept ingesting. **Verify with `uptime` and the embedded SHA, never with the config read-back.**
- ⛔ **CI green belongs to a SHA.** Pushing to a PR invalidates the previous green. Both merges today
  were held until CI settled on the exact head being merged.
- ⚠️ **Local python is 3.14 vs the declared 3.12**, 28/46 pins differ. Every local run prints an
  env-parity warning. `test_grid_series_provider_ownership.py` fails **4 tests on clean `dev`**
  locally but passes in hosted CI — a local red there is not a regression. Use
  `~/AppData/Local/Python/bin/python3.exe`; the system python is broken.
- ⚠️ **Windows tax is real:** selector output is CRLF (strip `\r` before `pytest`), bash `/tmp` ≠
  python `/tmp`, and heredocs mangle apostrophes — write scripts to a file instead.

---

## 5. Science: what is true today

✅ **The persistence deficit is CLOSED and REVERSED.** The standing clock said we were losing at
+24h. Measured today, paired n=3,221:

| lead | ours | persistence | delta | win |
|---|---|---|---|---|
| +24h | 0.209 | 0.258 | **−0.048** | 54% |
| +48h | 0.219 | 0.343 | −0.124 | 62% |
| +72h | 0.228 | 0.373 | −0.145 | 62% |

MAE went 0.270 → 0.209 (−23%) under **unchanged** thresholds (0.40 RED / 0.30 WARN — verified not
widened). The 2026-08-22 gate date passed without paging.

🟠 **Still losing to public references**, unchanged since 2026-08-10: `open_meteo_marine` beats us
by **+0.050 m** at +24h (win 38%), `ncep_gfswave025` by +0.025. Deliberately a warning, not a page
(pages at +0.100) — "a permanently-red workflow trains red-blindness."

⭐ **Model selection is the top open accuracy lever.** `raw_surf` bias (−0.080) tracks
`ncep_gfswave025` (−0.074), not its own EURO (+0.023) or ICON (+0.065) lanes — the served default is
GFS-dominated. Our **own** EURO lane (0.181) beats the served composite (0.209) at every lead, and
ICON (0.293) is the drag. This is a **paired** comparison (n=3,219 vs 3,221), so the "EURO's edge is
coverage, not model" caution is *controlled here* — the edge is real but modest (+0.029).

---

## 6. Open items worth picking up (all re-verified today, with line numbers)

**Cheap and concrete:**
- `C4-UX-07` — bare `3.281` literal in **production backend** `spot_ratings.py:55` (and
  `WebGLMarineTextureEncoder.js:239`). `forecastHelpers.js` was fixed 2026-08-09; these were not.
- `C4-OP-14` — `WebGLMarineEngine.js:24` imports `createTexture`; the file's only
  `createTexture(` occurrence is `gl.createTexture(` at 2671, so it is genuinely unused.
- `C4-OP-04` — `frontend/package.json:81` still uses Unix inline env syntax that cannot run on Windows.
- `C4-SC-06` — `freshness_sec=1800` is a bare literal at `estimator.py:647`, `grid_resolver.py:622`.
- `C4-SC-05` — `python-upgrade-readiness.yml` has **runs=0**; never executed. Two such workflows exist.
- `C4-OP-09` — `backend/uploads/forecast_cache/*.json` tracked, **not** gitignored, dirty every ingest.
- `C4-OP-13` — `MEMORY.md` is 20,197 B, **grew**, over both the 17.1 KB hook and its 18 KB governance.

**Blocked, and the ledger was wrong about why:**
- `C4-MR-03` / `C4-MR-12` claimed partial progress citing `37f265bf` / `19e8c197`. **Neither is an
  ancestor of `dev`** — they live only on the unmerged `claude/halo-audit31-lane` (and there as
  *rebased* twins `fad1993a` / `8621a87d`; the original SHAs are orphans). In `dev` the overlay
  truth gate is **not started**. That branch's fate blocks both rows.
  ⭐ **A ledger row inherits the state of the BRANCH its evidence lives on.** Cite an
  ancestor-of-`dev` check, never a bare SHA.

---

## 7. Rules I would not re-derive

1. **Inertness is a property of the SELECTOR, never the WRITER.** "I only write products" is not a
   safety property while the reader ranks on an attribute the new products dominate.
2. **Grep the selector, not the schema.** The mandate guards `estimate_surf_at`; a *route* can
   bypass it entirely and every guard misses by construction.
3. **Gating the site that reproduced the bug ≠ gating the paths that can select the product.**
   Enumerate the consumers at the time of the first fix.
4. **A positive control or the result is worthless.** Every test here pairs its assertion with one
   (an equally-fine *non*-island product must stay ungated; the outcome test asserts the island tile
   wins *without* the gate before asserting it loses with it).
5. **Mutation-verify anything load-bearing.** Three gates were confirmed by breaking them.
6. **Check whether a failure is yours.** 4 red tests looked like my regression; stashing and
   re-running on clean `dev` showed they were pre-existing.
7. **Date HEAD at both ends of a session.** HEAD moved and was pushed by a concurrent session
   mid-audit once before.

---

## 8. Immediate next actions

1. **Merge #46** once CI is green on head `26ece46d` (a watch is armed; it gates a live defect —
   island products stay selectable until **2026-09-29**).
2. **Rotate the Supabase `service_role` keys.** Five months public, RLS-bypassing. Everything else
   in this document can wait; this cannot.
3. Open a PR for `claude/security-committed-credentials` (`3d599eb7`) — pushed, no PR yet.
4. Work the PR pile-up in §3 order; re-measure floors after each merge.
5. Arm or neutralize the nearshore lane so it stops reporting a green that means nothing.
