# START HERE — 2026-07-30 · verified state after the surf-science session

**Read [[standing-work-rules-user-mandate]] first, then this.** This supersedes nothing — it is the
VERIFICATION pass over the three handoffs below, plus the state a fresh context needs.

* `HANDOFF-2026-07-29-EVE-the-oversize-gate-and-the-windsea-measurement.md`
* `HANDOFF-2026-07-29-NIGHT-the-instrument-and-the-pin-that-never-syncs.md`
* `HANDOFF-2026-07-29-surf-physics-audit-and-the-missing-refraction.md` (the audit this all answers)

---

## 0. ⚠️ THE FIRST THING TO KNOW

**12 commits are UNPUSHED on `dev`** (`origin/dev..HEAD`, 25 files, +2,995 lines). The whole
session is local only — not deployed, not backed up. Tree is clean.

**Nothing is live yet.** Every measurement below is against the local engine. The Render deploy
still runs the pre-session code, which is why a browser check of these changes would show the OLD
behaviour and was not attempted.

---

## 1. ✅ WHAT WAS VERIFIED THIS PASS (not just tested — re-measured)

### Combined A/B, all engine changes together, full live catalogue
1,773 spots × 7 realistic sea states × 3 swell directions = **37,233 evaluations**, flags off vs on
(`RATING_OVERSIZE`, `SURF_SHELF_KF_FLOOR`, `RATING_PERIOD_GATE`), with a harness self-check that
fails loudly if the flags are inert.

| Tp | level changed | responsible |
|---|---|---|
| 4 s | 47.3% | period veto — intended |
| 5 s | 37.2% | period veto — intended |
| **8 s / 10 s** | **0.00%** | the gate is *precisely* inert at ≥7 s, no leakage |
| 12 / 14 / 16 s | 0.1 / 0.8 / 1.3% | friction floor + oversize |

Served height changed on **0.73%** of evaluations, **every one an increase** (the friction floor, as
designed). **Regression guard: ordinary groundswell (Tp ≥ 12 s) shows 0.71% level changes.** The
changes act on short-period, oversize and wide-shelf cases and nothing else.

### Tides cross-validated against an INDEPENDENT source
Open-Meteo (our new path) vs NOAA CO-OPS (the old path's source) — neither derives from the other,
so the check can go red. Timing agreed to **36 min mean at Port Canaveral, 65 min at San Francisco**,
consistently EARLY.

★ **That offset is not a bug.** The derivation was then tested against a synthetic M2 tide with
analytically known extrema: **mean bias 0.0 min, max error 0.2 min over 56 events at 8 phases.** The
offset is harbour lag — NOAA stations sit *inside* Port Canaveral basin and the Golden Gate while the
Open-Meteo grid point is open coast, and the tide propagates inward. The ordering confirms it: SF
(deep inside an estuary) lags more than Canaveral. Height offsets of −0.76…−1.02 m are the MLLW vs
MSL datum difference and are near-constant per station, exactly as a datum offset should be.

### Tide coverage did NOT regress
60 random live spots: **60/60 (100%) get usable tide events.** Before, 100% got tides and 98.3% of
them were Florida's. Boston Harbor and Puget Sound return a *flat* series (Open-Meteo has no tidal
model in those enclosed waters) and correctly fall to the honest "unavailable" path — neither is a
surf spot.

### The route and the render contract
`get_spot_tides()` exercised directly: Pipeline, Thurso and Cocoa Beach each return their OWN tides
(`station_id=open-meteo:sea_level_height_msl`); Boston returns the unavailable state; and
`TIDES_GLOBAL_SOURCE=0` restores station `8721604` byte-for-byte. Every field the frontend touches
was then run through real Node exactly as `SpotConditions.js` does — **no `Invalid Date`, no `NaN`**,
negative heights and sub-minute times both render, and the old shape still parses on the kill-switch
path.

### Production data untouched
1,773 active spots · 55 verified peaks · **0 rows with `osm_id`** (ODbL still clean) · newest spot
2026-04-23 · **0 `condition_reports` modified in 12 h**, confirming the sim's non-admin what-if
writes nothing.

### Suites
Backend **1,277 passed**; frontend **1,542 passed / 171 suites**; LOC ratchet green.
⚠️ One pre-existing failure: `test_media_privacy_contracts.py::test_protected_grom_media_...`,
confirmed pre-existing by stashing all session changes. Spawned as its own task.

---

## 2. ★★★ THE OWNER'S QUESTION, ANSWERED

*"When we pin a new surf spot, do the forecast and surf report data automatically sync up?"* — **No,
and there is exactly one reason.**

Everything else already follows a new pin: spot membership, the marine and wind points, the
precompute (reads the live spot list every run), the hub (computes live per request). The exception
is **fine per-coordinate geometry (shore normal + `break_depth_m`)**, which lives only in
`data/shore_normals.json` — a git-committed artifact rebuilt by a **`workflow_dispatch`-ONLY**
workflow whose own header says *"RE-RUN THIS whenever spots are added, moved, or re-placed."*

⇒ **The sync is a human clicking a button in GitHub Actions.**

Measured cost (1,360 spots × 8 directions = 10,880 evals): shore-normal error median **22.3°**, p90
**81.4°**, max **179.4°**; **26.6%** of spots off by >45°; **rating LEVEL changes on 45.8% of
evaluations, median jump 2 levels**; breaking cap **lost at 78.4%** of spots.
★★ **Virginity is the DEFAULT** — 69.6% of spots have both along-shore neighbours outside the 1 km
match radius, so pinning a second peak one beach down loses it.

### ⚠️⚠️ TWO PLAUSIBLE FIXES KILLED BY MEASUREMENT — do not re-try
1. **"Suppress the bad coarse normal."** Mean LEVEL error **1.04** (coarse) vs **4.12** (`None`) —
   a `None` normal disables the directional gate entirely and every swell scores head-on (68% median
   height error). **A wrong bearing is bad; no bearing is far worse.**
2. **"The asset is just stale."** Of 24 sampled unmatched spots, **ZERO were merely missing** — all
   were *deliberately rejected*: 62% `ambiguous_coastline`, **38% PLACEMENT** (inland / >3 km from
   shore / in deep water). Re-running repairs none of the placement group; the pin must move.

**Feasibility measured:** `build_shore_normals.measure()` reproduces the committed asset **exactly**
(0.00°, identical depths, 6 calibration spots), one ERDDAP round-trip ≈22 s, payload-independent,
parallelises to ~3.8 s/spot at 6 workers. ⇒ background job yes, request path never.

---

## 3. ⛔ THE QUEUE

1. ★★★ **Auto-resolve geometry on a new pin** — spawned, with all three adversarial blockers:
   APScheduler runs **on the FastAPI event loop** (would freeze the app ~23 s/tick, up to 279 s);
   **nearest-wins can displace a correct neighbour** within 1 km; and `resolve_surf_geometry`
   resolves the normal and `break_depth` at **two separate sites** — wiring one leaves the cap dead.
   `spot_geometry_readiness.py` (shipped) is the zero-network half.
2. ★★★ **Wire `partitions`** — `estimate_surf_partitioned` is landed, tested and **dark**; nothing
   supplies partitions, so live behaviour is unchanged by design. Costs 2 extra point resolutions
   per spot; cost it against **precompute**, never the live lane (three-incident melt history).
3. ★★★ **Kr as a directional transfer function** — Snell is anti-correlated (r = −0.565) and the
   horizon buys only the directional ~13%; the dominant **site offset (A 0.852–1.250)** needs a
   measured or MOP-style source. `validate_nearshore_transform.py` is the instrument to score it.
4. ★★ **Depth-dependent height**, then tide/moon in the RATING. ⚠️ `tide.py:76-81` still divides out
   the spring–neap amplitude — the endpoint is now correct, the rating factor is not.
5. ★★ **Shore normals** — 434 spots with none; §2 shows re-running repairs only ~62% of them.
6. ★ `SURF_V3_KOMAR=0` is a mislabelled landmine (different physics, not a rollback).
7. ⚠️ **EURO waves blank day** (user-reported: Sat 2026-08-08 blank, Fri/Sun fine) — spawned.
8. ⚠️ **Friction is inert at ~46% of the catalogue** — may be correct for narrow deep shelves, but
   unverified.
9. **NEW** ⚠️ **Tide times render in the VIEWER's timezone, not the spot's.** Pipeline shows as
   12:45 PM on a US-East machine. NOT a regression — the old path returned a naive station-local
   string that JS also rendered as viewer-local, so it was *silently* wrong; the new one is at least
   an unambiguous instant. Fixing it needs a spot-timezone lookup in the UI.

### Carried over
`weather_sim_mcp.py` **789/800** — extract before the next change. The MCP server holds the OLD
module until a host restart. `RATING_LOCAL_SIZE` is absent from both workflow env blocks, so the
climatology path is inert. Precomputed frames are authoritative — a new spot is absent from the
glyph layer until the next cron write. **No report/calibration loop feeds back into the forecast at
all**, so "sync up" in the model-correction sense does not exist yet.

---

## 4. ★ METHOD NOTES WORTH KEEPING

1. ★★ **Audit your own instrument before trusting its headline.** Mine omitted `shelf_dissipation`,
   a term production applies first. The number survived — but only checking proved it, and checking
   exposed a live defect (friction unbounded below, Salthill retaining 0.4% of its swell).
2. ★★ **A positional call is how a new engine input silently fails to reach a surface.** The spot hub
   called `compute_surf_rating` with ten positional args and silently opted out of per-spot capacity.
   Pass every optional factor by NAME; a test now pins the call style itself.
3. ★★ **When two sources disagree, test your own derivation against a synthetic truth before blaming
   either.** The 36–76 min tide offset looked like a bug; the derivation proved unbiased to 0.2 min,
   which reclassified the offset as real harbour lag.
4. ★ **A regeneration procedure that lives in a chat log is not a procedure.** The 4,320 parity
   goldens went stale and the grid had to be reverse-engineered — now
   `backend/scripts/gen_rating_parity_goldens.py`. Run it after ANY engine change.
5. ★ **Print a delta column.** An A/B harness that reads `os.environ` inside the call is not two
   engines; a column of `+0.0` everywhere is what caught it.
