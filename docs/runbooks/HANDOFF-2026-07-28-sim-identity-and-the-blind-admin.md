# HANDOFF 2026-07-28 — one identity per spot, a forecast that can see tomorrow, and a red gate

**Continues `HANDOFF-2026-07-28-SESSION-AUDIT-sim-geometry-catalogue.md`.**
3 commits on `dev` (`f845fedc`, `5f0085fd`, `48b923b3`), tree clean.
Backend **1136 passed / 0 failed** (full run, no `-x`). Read [[standing-work-rules-user-mandate]] first.

---

## 0. ⛔ DO THIS FIRST

**Restart the WeatherSimulation MCP server.** `get_weather_forecast` gained a `valid_time`
argument, and the client caches the tool schema from `tools/list` at connect time — until it
re-lists, the new parameter is invisible to it.

```powershell
Get-CimInstance Win32_Process -Filter "Name like '%python%'" |
  Where-Object { $_.CommandLine -like '*weather_sim_mcp*' } | Select-Object ProcessId
Stop-Process -Id <pid> -Force    # Claude Code respawns it on the next tool call
```
Safe: the out-of-band stdio probe and `test_weather_sim_mcp_server_startup.py` both pass on this
commit. ⚠️ Still verify out-of-band before trusting a restart — a bad server used to cost a
30-minute client hang.

---

## 1. ★★★ THE ROOT: SPOT IDENTITY (`f845fedc`)

**The measurement that started it — taken against the RUNNING server, not reasoned about:**

| | `"Mavericks"` | `"mavericks"` |
|---|---|---|
| coordinates | 37.4952,−122.5028 | **37.4915,−122.5083** |
| region | "California" | **"Half Moon Bay"** |
| served height | 2.347 m | 2.3521 m |

**The same spot, asked twice, 637 m apart — the CAPITALISATION of the argument decided which
catalogue answered.** `resolve_spot` consulted the hardcoded three-row table BEFORE the app's own
catalogue, and its key match was case-sensitive. ★ This is exactly the defect `913b4af7` fixed for
the drifted `dev.db` snapshot, **surviving in the three rows that fix did not cover.**

⚠️ **`Pacifica State Beach` is not in the catalogue at all.** Production carries
`Pacifica - Linda Mar` **2.5 km away**. That name returned a confident forecast for a coordinate
the app does not recognise as a spot.

★★ **THE PARITY BLOCK COULD NOT SEE THIS.** It compares the sim's height against the app's height
*at the coordinate the sim asked about* — so it read **0.00%** while the coordinate itself was
wrong. **Parity validates the mapping, not the location.**

### Two more, measured over the live 1818-row catalogue
* **5 names are carried by TWO active rows each** — `Miramar` twice, **9098 km apart**; also
  `Crescent Beach` (511 km), `FORMOSA` (902 km), `São Lourenço` (1372 km),
  `Playa de las Americas` (1.11 km). `exact[0]` picked one by list order, silently.
* **`get_weather_forecast("Pacifica")` said "not found in the catalog"** while
  `get_surf_spots("Pacifica")` returned 2 matches — it held the rows and stated the opposite of
  what it had just observed, then advised running the search that had already worked.
* **Staging was not symmetric with clearing.** `simulate_weather_change("mavericks")` stages under
  the RESOLVED name, so `clear_simulation_overrides("mavericks")` popped nothing and returned
  `success: true, cleared: 0` **while the override survived** — and an override outranks the live
  forecast on every later read. ★ A no-op reported as success is worse than the miss.

### The fix — `services/weather_pipeline/sim_spots.py`
Live catalogue owns identity. Hand-tuned rows contribute a baseline and `reference_size_m`, **never
a location**, and ⚠️ **never `orientation`** — that bearing was measured for a *different*
coordinate and is 44.9° wrong even there. Ambiguity returns CANDIDATES. A spot `id` always resolves.

⚠️ `_default_for` is derived on every call, **not** cached in a module index: `CATALOG_DEFAULTS` is
public and mutable, and a frozen index desynced the moment anything added an entry — which is the
same two-sources-of-truth bug the module exists to remove. It broke a test within minutes.

★★ **MUTATION-TESTED.** Restoring the old precedence fails exactly 5 of the 21 new tests — and only
the **exact-case** spellings fail while `mavericks`/`MAVERICKS` still pass. That asymmetry *is* the
original bug's signature, so the tests are provably non-vacuous.

---

## 2. ★★ THE TIME DIMENSION (`5f0085fd`)

`get_weather_forecast` sampled the current hour and nothing else — so "is tomorrow morning better?"
was unanswerable by a *simulation* server. Measured: `/api/weather/point` already serves
authoritative frames out to **at least +168 h**. The data was there and was never asked for.

Live at Mavericks:

| requested | Hs | Tp | breaking | quality |
|---|---|---|---|---|
| now | 1.40 | **17.05** | 7.7 ft | **59.1 fair_good** |
| +12 h | 1.72 | 10.83 | 7.2 ft | 40.4 poor_fair |
| +48 h | 1.88 | 11.28 | 8.0 ft | 38.3 poor_fair |

★ **Bigger swell, worse surf** — the period collapses 17 s → 11 s. That is the entire point of
asking about a future hour, and it was invisible.

A malformed hour is refused BEFORE dialling (it would otherwise burn the full timeout and return
empty, which reads identically to "no data at this spot"). A staged override is timeless and still
wins, but now **says** it is masking the requested hour.

⚠️ **False comment fixed:** `_FORECAST_CACHE` claimed entries "expire on their own as the hour
turns". **They do not** — the KEY changes, so a stale entry becomes unreachable and is never freed.
`_remember` prunes.

⛔ **NOT built, deliberately:** a multi-hour timeline tool. Each hour costs 2 requests; fanning out
would hammer the 1-CPU free Render box the memory records melting (`SPOT_RATINGS_LIVE_MAX_CONCURRENT=2`).
`grid_series` is bbox/grid-shaped — sampling it per point means re-implementing `point_resolution`,
the private-reinterpretation drift `cf2efb48` exists to prevent. If a timeline is wanted, bound the
steps and the concurrency, and reuse the point lane.

---

## 3. ★★★ THE LOC RATCHET HAS BEEN RED SINCE `46280a1b` (`48b923b3`)

`gh run list --workflow loc-check.yml` → **8 consecutive failures.** `AdminSpotsPanel.js` crossed
the 800 limit on 2026-07-27 (**755 → 807 → 829 → 840**) and was never grandfathered.

★★ **WHY THE LAST SESSION'S AUDIT MISSED IT:** its final commits were docs-only, which skip the
workflow's `paths:` filter — so `gh run list` showed **CI success** on the head commit while the
ratchet had simply not run. ⚠️ **A green CI on a docs commit says nothing about the code gates.**
The audit flagged the *test* file at 792 and never noticed a frontend file already past 800.

Fixed by extracting the stats header verbatim to `AdminSpotsStats.js` (840 → **760**).

---

## 4. ★★★ THE ADMIN CERTIFIED DATA THAT NEVER ARRIVED (`48b923b3`)

**The owner suspected this by eye mid-session and was right.** Both fetchers swallowed their own
error, so `Promise.all` always resolved and `refreshAll` ran `setLastRefreshed(new Date())`
unconditionally. With `stats` still null, `stats?.total_spots || 0` rendered **0**.

Measured live against production, unauthenticated (`/admin/spots/stats` → **401**):

> `0 Total Spots · 0 Countries · 0 Active` — `Showing 0 of 0 matching (0 in the database)` —
> stamped **"Live · updated 9:50:10 PM"** — against a catalogue holding **1818** spots.

★ **A 401, a 500 and an empty database were indistinguishable — and the timestamp that exists to
make a stale panel distinguishable from a correct one was vouching for the lie.** Fourth instance
of the blind-admin class after `ad6cd082`, `46280a1b`, `7883e4b0`.

Now: fetchers report success; the timestamp is stamped only when data arrived; a failed read shows
**"—"** with a `role="alert"` explanation. Verified in the browser before and after.

⚠️ **My first probe was WRONG and nearly produced a false diagnosis.** `fetch('/api/...')` returned
**200 + HTML** (webpack's SPA fallback) and looked like a broken endpoint. `apiClient` uses an
**absolute** base (`REACT_APP_BACKEND_URL` → Render), so a relative probe never touches the real
target. ★ **Probe the way the app calls, not the way that is convenient.**

---

## 5. Verified / not verified

**Verified:** backend **1136 passed / 0 failed**; 68 sim tests; identity + ambiguity + id +
clear-symmetry + the summary resource end-to-end through the real stdio server; the time dimension
against production; the admin before/after by screenshot; ESLint clean; ratchet green.

⚠️ `test_dynamic_viewport::test_negative_cache_stale_fallback_success` failed **once** under `-x`
with `[WinError 5] Access is denied` on an atomic rename, then passed in isolation *and* in the
full run. Windows file-lock flake, not a regression — but it is order-dependent, so expect it again.

**NOT verified:** the admin panel with a REAL admin token (only the 401 path was exercised — the
success path is unchanged code, but unproven this session). The map at 1818 spots is still
unlooked-at, carried over from the previous handoff.

---

## 6. ★★★ FORECAST CALIBRATION — MEASURED, AND THE QUEUE'S PREMISE WAS WRONG (`2ff07b84`)

I went at the #1 queue item and the first measurement stopped it: **the curve is blocked on
EVIDENCE, not on method.**

### ⚠️ "421 obs/model pairs" is not 421 observations
The report carries 421 `spots` rows over **60 distinct buoys**, and **416 are replications of 55
unique (buoy, obs, model) tuples** — Cape Canaveral's buoy contributes **40 identical rows**.
★★ **0 of 54 multi-spot buoys had a model value that varied across its spots** (the model is
resolved AT THE BUOY), so the per-spot rows carry **literally no extra information about skill**.

★ **Production already knew.** `_one_residual_per_buoy` exists, its docstring says "a dense stretch
of Florida coast would outvote all of Hawaii", `summary` reports **`height_n: 60`**, and the
per-spot list is documented as being kept *for auditability*. **The previous session's stratified
table bypassed a dedupe the code deliberately applies.**

| observed | per-spot rows (as recorded) | **per BUOY (the real evidence)** |
|---|---|---|
| 0.0–0.5 | n= 95 **+0.221** | n= **7** +0.237 |
| 0.5–1.0 | n=146 +0.011 | n=**18** +0.028 |
| 1.0–1.5 | n=109 −0.099 | n=**22** −0.178 |
| 1.5–2.5 | n= 59 −0.004 | n=**10** −0.086 |
| 2.5–10 | n= 9 −0.870 | n= **2** −0.808 |

★ **The COMPRESSION is REAL — it survives deduplication**, independently confirming 2026-07-26. ⚠️
But the top band is **2 buoys**, and the aggregate (−0.072) hides the whole spread. **A quantile
map cannot be fitted from this, and fitting on the per-spot rows would weight one Florida buoy 40×
and calibrate the global model to Florida.**

### Why nothing could ever accumulate
`calibration/buoy_latest.json` is a **SINGLE KEY overwritten on every CI run** — exactly one
snapshot has ever existed. `2ff07b84` adds a rolling per-buoy residual archive (the pattern
`report_calibration.prediction_archive.json` already uses): append → dedupe on
`(buoy_id, buoy_time)` → prune by age and cap. ⛔ **Nothing there changes a rating.**

⚠️ Two measured design points, not preferences:
* **Model Hs of exactly 0.0 against a real observation is a COVERAGE HOLE** (3 of 421), not skill.
  Archiving it teaches the curve the model under-predicts by the entire wave height.
* ★★ **`n` is rows; `n_buoys` is INDEPENDENCE.** A week of hourly runs gives the top band ~336 rows
  but **still 2 stations**. Row count alone would call that fittable. The gate needs **both**
  (30 rows AND 10 buoys) and the report NAMES every band that fails — today **all five do**.
* The entry cap is a **bandwidth** budget: 175 B/row measured, and the object is downloaded *and*
  re-uploaded every run, so 40000 rows was 6.7 MB hourly for no extra power. Now 20000.

**⇒ NEXT on calibration: let it run and check `report["archive"]` in a week.** Fit only bands that
clear the gate, gate the result behind `RATING_OBS_GATE`, and remember the report weight K is a
**KALMAN GAIN — derived, not chosen**.

## 7. ★★★ THE DUPLICATE ARC — the tool that makes them, and the 47 that exist (`c91e9530`+`da25f7c4`)

### 7a. The importer could not tell a new spot from the same break pinned elsewhere
The 2026-07-27 import introduced 2 duplicates (`COXOS`/`Coxos` **2.17 km**,
`CONSOLAÇÃO`/`Consolação` **3.20 km**) — both just OUTSIDE the 2.0 km radius, so a distance-only
gate could never catch them. ★ **Structural, not a tuning miss:** a gazetteer names a BEACH, the
catalogue names a PEAK, so their coordinates routinely differ by 2-3 km. **Only the name can
separate "new spot nearby" from "same break, pinned differently."**

⚠️ **The prefilter box was part of the bug** — 0.05° (~5.5 km) excludes the very 2-8 km band the
name tier exists to cover. A test now walks the full radius.

★★ **THE REPLAY FOUND A FALSE POSITIVE AND THAT WAS THE REAL FINDING.** Replaying the actual
305-row import: the first attempt rejected **1** row — `MADALENA DO MAR` → `Jardim do Mar`, **two
distinct Madeira villages**, collided on `{do, mar}` ("of the", "sea") via `len(ta & tb) >= 2`.
`normalise_name` now drops Romance articles/prepositions and generic water nouns. After that:

| | rejected by name | of |
|---|---|---|
| the real import replay | **0** | 303 |
| `COXOS` / `CONSOLAÇÃO` at their real separations | **both caught** | 2 |

⇒ **catches every real failure, loses no legitimate candidate.** This was a prerequisite for the
queued FR/ES/UK expansion, whose 2333 candidates are largely built from those connectives.
⚠️ Blast radius checked on all 3 consumers: SAME/DIFFERENT pairs hold; `Nazaré` → `NORTE (NAZARE)`
now matches (an improvement — cross-validated by two authorities); the STRICT corrector still
rejects `Jaws (Peahi)` → `Peahi`. **Loose gate, strict corrector — unchanged.**

### 7b. `dedup_surf_spots.py` structurally cannot see them
It groups with **SQL equality on `SurfSpot.name`**, so only BYTE-IDENTICAL names in the same state.
`Teahupo'o` vs `Teahupoo` (**142 m**) is invisible to it. New `triage_duplicate_spots.py`
(**review artefact, NEVER writes**) over the live 1818:

| tier | n | meaning |
|---|---|---|
| **IDENTICAL** | **47** | same name after normalisation — the merge candidates |
| VARIANT | 122 | one name contains the other — **needs a human** |
| WEAK | 26 | |
| DISTINCT_PEAKS | 82 | positional difference — **must NOT be merged** |

47 pairs → **43 clusters** (41 pairs + 2 triples) → **45 rows removed, 1818 → 1773**. Median
separation **2.14 km**, which is why a proximity sweep never found them. Several
(`El Cotillo`/`Cotillo`, `Playa de Famara`/`Famara`, `Los Lobos`/`Lobos`) surfaced only *because*
of 7a's stopword fix.

★★ **CALIBRATION REJECTED MY FIRST DRAFT.** I listed feature nouns (`main`, `peak`, `bowl(s)`,
`reef`, `inlet`) as positional, which classified three **already-adjudicated duplicates** as
distinct peaks. **A surf name's feature noun is decoration; only its POSITION separates two peaks.**
Digits are positional by construction, so numbered street grids generalise unenumerated.

### 7c. ✅ MERGED IN PRODUCTION (owner-approved) — 1818 → 1773

★★ **THE FK LIST IN `dedup_surf_spots.py` IS WRONG, AND I CHECKED BEFORE TRUSTING IT.** Queried
`information_schema` instead: the real set is **23 tables, not 22** — the script is missing
**`surf_log_entries`** (the user's logged surf sessions, and the table `report_calibration.py`
matches against). ⚠️⚠️ **8 of the 23 are `ON DELETE CASCADE`** (`surf_reports`, `surf_alerts`,
`spot_verifications`, `surf_passport_checkins`, `photographer_requests`, `spot_of_the_day`,
`spot_refinements`, `spot_seo_metadata`), so a table missing from the re-parenting list does not
merely detach rows — **it deletes them**. Fix the script's list before anyone runs it.

Measured before writing: **all 88 cluster rows had ZERO child rows across all 23 FK tables**, so no
re-parenting was needed at all and the merge reduced to a plain delete.

**Survivor rule (deterministic, applied in SQL):** human-verified peak → `offset_adjusted` →
NOT (`low_accuracy` or flagged) → longer description → older `created_at` → id.
⇒ all **4 verified peaks survived** (`Playa de Famara`, `Los Lobos`, `Lacanau Ocean`,
`Vieux Boucau`), **`Nazaré [offset_adjusted]` survived** over `Nazaré Beach`, and **all 4
`low_accuracy` rows were deleted, none kept**.

| | before | after |
|---|---|---|
| total rows | 1821 | **1776** |
| active | 1818 | **1773** |
| verified peaks | 55 | **55** (unchanged) |
| `offset_adjusted` | 11 | **11** (unchanged) |
| IDENTICAL pairs remaining | 47 | **0** |

⚠️ `Teahupoo - End of the Road` correctly SURVIVES as a VARIANT — it is a real separate break 1.6 km
from `Teahupo'o`, not a spelling of it.

### ROLLBACK
```sql
INSERT INTO surf_spots SELECT * FROM surf_spots_dupe_backup_20260728 b
  WHERE NOT EXISTS (SELECT 1 FROM surf_spots s WHERE s.id = b.id);
```
Snapshot `surf_spots_dupe_backup_20260728` holds all **1821** pre-merge rows.

## 8. NEXT — the rest of the queue
2. **The duplicate triage** over the 288 pre-existing name-matching pairs — `Teahupo'o` vs
   `Teahupoo` at **140 m** is the clearest single defect in the catalogue. Note the sim now
   *surfaces* same-name duplicates instead of hiding them, which makes this cheaper to work.
3. **`import_reviewed_spots.py` still dedupes on DISTANCE ALONE** (§9a of the prior handoff) — a
   name match within `SAME_BREAK_KM` is still NOT IMPLEMENTED.
4. The 155 misplaced spots; FR/ES/UK expansion (2333 candidates, blocked on judgement, not data).

⚠️ `weather_sim_mcp.py` is at **753/800** — the ratchet warns above 750. The next feature there
needs a seam, and `sim_spots.py`/`sim_forecast.py` are the precedent.
