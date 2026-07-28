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

## 6. NEXT — the queue, unchanged at the top

1. ★★★ **FORECAST CALIBRATION** — still the biggest untouched lever, and now the only one left in
   the sim's input chain. The loop is LIVE (`GET /api/weather/buoy-calibration`, 60 buoy-matched
   spots, 421 pairs). ★★ Aggregate bias **+0.010 m is a TRAP**: stratified it runs **+0.229** at
   0–0.5 m to **−0.794** above 2.5 m ⇒ **the model COMPRESSES. Fit a monotonic QUANTILE MAP, not a
   bias term.** Gate behind `RATING_OBS_GATE`. ⚠️ n=10 in the worst band — hold it until more.
2. **The duplicate triage** over the 288 pre-existing name-matching pairs — `Teahupo'o` vs
   `Teahupoo` at **140 m** is the clearest single defect in the catalogue. Note the sim now
   *surfaces* same-name duplicates instead of hiding them, which makes this cheaper to work.
3. **`import_reviewed_spots.py` still dedupes on DISTANCE ALONE** (§9a of the prior handoff) — a
   name match within `SAME_BREAK_KM` is still NOT IMPLEMENTED.
4. The 155 misplaced spots; FR/ES/UK expansion (2333 candidates, blocked on judgement, not data).

⚠️ `weather_sim_mcp.py` is at **753/800** — the ratchet warns above 750. The next feature there
needs a seam, and `sim_spots.py`/`sim_forecast.py` are the precedent.
