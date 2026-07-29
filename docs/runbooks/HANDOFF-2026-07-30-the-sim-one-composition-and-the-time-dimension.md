# HANDOFF 2026-07-30 — the sim: one composition, and the time dimension

**Continues `START-HERE-2026-07-30-verified-session-state.md`.** Read
[[standing-work-rules-user-mandate]] first.

Owner's brief: *"get the weather simulation system features of this app working well."*

**Branch `dev`, tree clean, EVERYTHING PUSHED** (`origin/dev` == HEAD). Backend **1,356 passed**
(was 1,277), 2,928 skipped, LOC ratchet green. One pre-existing unrelated failure remains:
`test_media_privacy_contracts.py::test_protected_grom_media_...`, confirmed still the same
grom-media source assertion and untouched by this session.

| commit | what |
|---|---|
| `c0fbc69a` | the what-if had to be told the weather it was asking about (+ the composition extraction) |
| `49821439` | the next engine input must reach every surface, or the suite goes red |
| `f70d2a4f` | the forecast cache held exactly one hour, so a time series re-fetched every frame |
| `e370db06` | the sim could say how it is at an hour, never WHICH hour |
| `812aec73` | **self-audit** — I quoted a worst-case tide point as the typical cost (71.5% -> 41.0%) |
| `e637d6dc` | the spectral transform had no data path |
| `a6280572` | **pinning a spot gave it no geometry until a human clicked a button** |

---

## 0. ★ WHAT I MEASURED BEFORE CHANGING ANYTHING

The sim was **not** broken. Measured live across 15 spots on five continents:

| | |
|---|---|
| geometry resolved | **15/15** |
| HEIGHT parity, sim vs the app at the same coordinate | median **0.38%**, p90 0.94%, max 2.08% |
| **SCORE parity, sim vs the served glyph rating** | **0 of 15 level differences**, 10 of 15 exactly 0.0 |
| latency | median 0.72 s |

★ That second row had never been checked. The sim printed a `parity` block for HEIGHT and was
silent on QUALITY — half the answer unverified, and quality divergence is exactly the defect class
of `9b808d05`. It is green, which is why this session is about **features and durability**, not a
rescue.

⚠️ One correlation in the first probe looked alarming and is NOT a defect: 7 of 15 spots reported
`swell_alignment_pct` = 10 (the floor) and regime `shelf`, perfectly correlated. Explained —
`surf_transform` returns `shelf` when the transform REDUCED the wave, and the same swell-angle
exposure factor drives both. Don't re-chase it. (The underlying "a wrapping swell reads as from
behind" is the known missing-refraction root, not this.)

---

## 1. ★★★ THE COMPOSITION IS NOW PINNED PER FACTOR, ACROSS ALL THREE SURFACES

CLAUDE.md's ONE FORECAST COMPOSITION rule has failed twice, both times the same way — a new
optional engine input reached some surfaces and not others (`902f47a9` height, `9b808d05`
capacity). AST-extracting the actual rating call at each surface:

| factor | `spot_ratings` (REFERENCE) | `spot_conditions` (HUB) | `sim_rating` (SIM) |
|---|---|---|---|
| `break_depth_m` | ✅ | ✅ | ✅ |
| `reference_size_m` | ✅ `RATING_LOCAL_SIZE` | ❌ | ✅ same gate |
| `tide_norm`/`best_tide` | ✅ `RATING_TIDE` | ❌ | ❌ |
| `breaker_xi` | ✅ `RATING_BREAKER_TYPE` | ❌ | ❌ |
| `partitions` | ❌ | ❌ | ❌ (nobody, anywhere) |

### The measured cost — hub vs glyph on identical inputs, SWEPT over each factor's own range

| | `|dScore|` median | max | **LEVEL differs** |
|---|---|---|---|
| all flags OFF (**production today**) | 0.0 | 0.0 | **0.0%** |
| `RATING_LOCAL_SIZE=1` (ref 0.6–4.0 m) | 10.6 | 75.7 | **59.1%** |
| `RATING_TIDE=1` (tide 0.0–1.0) | 5.8 | 40.9 | **41.0%** |
| both | 15.4 | 84.1 | **70.1%** |

⚠️⚠️ **THESE NUMBERS ARE CORRECTIONS — the first pass of this handoff was wrong.** It quoted ONE
hand-picked point per flag: `tide_norm=0.05` against a "mid tide" preference is near the worst case
`tide_fit` can produce and gave **71.5%**, against **41.0%** swept across the whole tidal cycle. ★ A
factor with a bounded range must be SWEPT before a number is taken off it — the same lesson as
"print a delta column", one level up.

⚠️ The reference-size figure is **SYNTHETIC by necessity**: `load_size_climatology_l2_cached()`
returns None, so no spot has a real size reference and the 0.6–4.0 m span is plausible, not
observed. It bounds the shape of the risk; it does not measure it.

★ **NEW, and it sharpens the case:** `reference_size_m = 1.2` is **not** a no-op even though 1.2 m
is the documented default. `size_score` switches to a different CURVE SHAPE whenever any reference
is supplied — *"the two branches are intentionally different shapes"*, its own docstring, absolute/
legacy vs local-relative. So `RATING_LOCAL_SIZE` does not merely calibrate per spot; it re-shapes
the size gate for **every** spot that has climatology, which makes a surface sitting the flag out
diverge more, not less.

⇒ **Nothing is wrong today, and one flag flip makes the hub disagree with the map on 4–6 of every
10 spot-hours.** `test_rating_composition_parity.py` requires every surface to declare SUPPLIED or a
waiver **naming the blocker and its measured cost**; add a factor to `rating_score` and the suite
fails until all three declare. ✅ Verified it bites by re-enacting `9b808d05` and by appending an
undeclared parameter.

⚠️ **The REFERENCE implementation itself still calls with TEN POSITIONAL args.** Insert a parameter
before `break_depth_m` and `rate_one_spot` silently shifts.

### ⚠️⚠️ A PLAUSIBLE FIX KILLED BY MEASUREMENT — do not "just wire tide in"

`tide_fit` needs `best_tide`, a per-spot prior. In production: **38 of 1,773 spots (2.1%) have one
at all**, and `parse_best_tide` returns None for "all tides" (17) and "incoming" (3) ⇒ **18 spots
(1.0%) yield a usable band.** The tide LEVEL is now globally correct (`5394947b`); the rating factor
is blocked on a **data field**. This is why queue #4's ordering — **depth-dependent height first** —
is right. `breaker_xi` is likewise inert everywhere until the finer slope asset ships.

---

## 2. ★★★ THE FEATURES: the sim can now be asked the questions surfers ask

### `simulate_weather_change` — omit an input, hold the real forecast
It required all five weather inputs and had no `valid_time`, so *"what if the wind swings offshore
at dawn on Thursday"* meant calling `get_weather_forecast`, reading five numbers off it and
retyping four unchanged — and a transcription slip produces a different sea state than the one
being asked about, with an equally confident answer. Omitted inputs now come from the same baseline,
`valid_time` anchors the hour, and `baseline_delta` reports what changed and what it DID.

Live at Mavericks, forecast wind 11.5 kt from 307° swung to 4 kt offshore:
**32.2 `poor_fair` → 61.3 `fair_good` (+29.1)**, height unchanged; a 35 kt onshore gale reads
**−28.0, "worse"**. Signed both ways.

⚠️⚠️ **THE ZERO-NETWORK INVARIANT.** All five supplied and no hour named ⇒ **0 HTTP requests**,
verified live. An unconditional fetch there is the `576dcbdd` regression (42.2 s of blocking, past
where an MCP client reports a TIMEOUT instead of an answer — indistinguishable from "the sim is
broken"). Omitting an input or naming an hour is the caller opting IN; otherwise
`peek_live_forecast` reads the cache only and never dials.

### `find_best_window` — WHICH hour, not just this hour
Ranks the horizon through the same chain a single-hour answer uses. Live: 17 frames over 48 h at
Mavericks, all resolved, **8.5 s cold, ~0 s warm**; driven as the **VERY FIRST call against the
real stdio server it answered in 2.40 s** — the check that matters, because the 2026-07-27 deadlock
struck whichever tool went first and no in-process test could see it.

Two things a scan gets quietly wrong, both pinned: an unresolved frame is **EXCLUDED and named**,
never scored flat (a gap in the data must not become "the surf is bad then"); and a truncated
horizon **says so** — it cuts the horizon rather than silently widening the step, because a caller
who asked for 3-hourly resolution and got 9-hourly has no way to tell.

### ★ The cache held exactly one hour
`_remember` dropped every entry whose hour differed, so **a time series was the one access pattern
the cache defeated**. 16 frames at a 3-h step: cold **19.8 → 6.7 s**, warm re-scan
**6.163 → 0.000 s**. Now a bounded FIFO (oldest-first, *not* LRU — a comment in this repo once
claimed LRU for a FIFO and cost a session to disprove).
⚠️ **The TTL is newly load-bearing:** the old one-hour wipe gave freshness by accident. Holding many
hours, an entry for a FUTURE hour would outlive the ingest that supersedes it and be served stamped
with the OLD `run_time` — worse than a miss, because it looks authoritative.

---

## 3. ⛔ THE QUEUE

Unchanged items carried from `START-HERE-2026-07-30` §3, with this session's edits:

1. ★★★ **Auto-resolve geometry on a new pin** — unchanged, still the direct answer to the owner's
   earlier question. Three blockers captured (APScheduler on the FastAPI event loop; nearest-wins
   displacing a correct neighbour; normal and `break_depth` resolved at two separate sites).
2. ★★★ **Wire `partitions`** — unchanged, still dark, still to be costed against **precompute**.
   ★ NEW: when it lands, `test_rating_composition_parity.py` will fail until **all three** surfaces
   declare it, which is the point.
3. ★★★ **Kr as a directional transfer function** — unchanged.
4. ★★ **Depth-dependent height**, then tide/moon in the RATING. ★ NEW evidence above **confirms this
   ordering**: the tide factor is starved of its per-spot prior at 99% of spots, so depth-dependence
   is the only tide path that reaches the catalogue.
5. ★★ **Shore normals** — 434 spots with none.
6. ★ `SURF_V3_KOMAR=0` is a mislabelled landmine.
7. ⚠️ **EURO waves blank day** — spawned previously.
8. ⚠️ Friction inert at ~46% of the catalogue.
9. ⚠️ Tide times render in the VIEWER's timezone, not the spot's.
10. **NEW** ★★ **Thread a spot id into the hub** so it can use local size climatology — spawned,
    with the 59.1% measurement and all ~7 call sites listed.
11. **NEW** ⚠️ Sim name resolution misses accents/spelling (`Nazaré`, `Tofino`, `Taghazout` return
    not-found), and `Pipeline`'s `orientation_source` advertises `override:Pipeline / Backdoor` — a
    name `get_weather_forecast` 404s on. Cosmetic but it makes the catalogue look thinner than it is.

### Carried over
⚠️ **`weather_sim_mcp.py` is 769/800 and the pre-commit hook now WARNS.** The composition and the
scan were extracted to `sim_rating.py` / `sim_window.py` precisely so the next addition has
somewhere to go — **put it in a sibling module.** `RATING_LOCAL_SIZE` is still absent from both
workflow env blocks. Precomputed frames remain authoritative for glyphs. **No report/calibration
loop feeds back into the forecast**, so "sync up" in the model-correction sense still does not exist.

---

## 4. ★ METHOD NOTES

1. ★★ **A guard that cannot go red is decoration.** Both negative tests were run before trusting the
   registry — re-enact the original defect and watch it fail.
2. ★★★ **A factor with a bounded range must be SWEPT before a number is taken off it.** This handoff's first pass quoted one hand-picked tide point and reported 71.5% where the honest sweep says 41.0% — I audited my own instrument only because I was asked whether I was spiralling, which is the wrong trigger. Sweep first.
3. ★★ **A waiver must carry a number.** "We didn't wire tide" is an excuse; "18 of 1,773 spots yield
   a usable band, and flipping the flag diverges 41.0% of levels" is debt inventory that tells the
   next person what to do.
4. ★★ **Measure before assuming the thing you were asked to fix is broken.** The sim's score parity
   was green at 15/15; the work was therefore features and durability, not a rescue. The two hours
   that would have gone into "fixing" a correct engine went into the time dimension instead.
5. ★ **A cache's eviction policy encodes an assumed access pattern.** One-hour retention was correct
   for "sweep many spots at one hour" and exactly wrong for "sweep one spot across hours" — and the
   test asserting `[2, 2, 2]` was pinning the very behaviour that defeated the new feature.
6. ★ **Extract to make room BEFORE the ratchet blocks you.** This file blocked two sessions at
   789/800; the split is what made three of this session's four commits possible.


---

## 5. ★★★ AFTER THE AUDIT — WHAT THE SECOND HALF OF THE SESSION SHIPPED

The owner asked mid-session whether this was progress or spiralling, and for two audit reports. The
honest answer was **progress, but drifted**: the sim delegates 100% to production, so its accuracy
was never in the sim to improve. That reframing produced the rest of the work.

### 5a. A correction to this document (`812aec73`)
The flag-flip divergence numbers in §1 were each taken from ONE hand-picked point.
`tide_norm=0.05` against a "mid tide" preference is near the worst case `tide_fit` can produce:
**71.5% -> 41.0%** swept across the whole tidal cycle. The reference-size row was additionally
SYNTHETIC — `load_size_climatology_l2_cached()` returns None, so no spot has a real size reference.
★★ **A factor with a bounded range must be SWEPT before a number is taken off it.** I caught this
only when asked to self-audit, which is the wrong trigger.

★ A real finding fell out of the re-measurement: **`reference_size_m = 1.2` is NOT a no-op** despite
1.2 m being the documented default — `size_score` switches CURVE SHAPE whenever any reference is
supplied. `RATING_LOCAL_SIZE` therefore re-shapes the size gate for every spot with climatology,
which makes a surface sitting the flag out diverge MORE, not less.

### 5b. Partitions now have a data path (`e637d6dc`) — queue #2, closed
`estimate_surf_partitioned` was landed and DARK since `b9595de6`. Wired at
`point_resolution._resolve_partitions`, **the single injection point** where `surf_height_m` is
produced — computing it anywhere else would give the hub and the sim a different height from the
glyphs.

⚠️⚠️ **Reconciliation is the GENERAL case, and the roadmap understated it.** The prior note recorded
only "swell_1 exceeds the total at Hossegor". Measured over 16 spots: partitions miss the total by a
**median 9.5%, max 43.8%**, OVER at 10 of 16 and UNDER at 1. Raw partitions therefore **invent
energy** (+6.2% median). `reconcile_partitions`: **the total Hs is the SCALE, the partitions are the
SHAPE.** Effect once reconciled: **median +0.6%, range −44.7%…+26.8%**, signed both ways.

⚠️ `SURF_PARTITIONS=0` by default — 4x the point resolutions. **Enable everywhere or nowhere.**
⛔ The RATING half is still dark (`dominant_swell_period`, `sea_cleanliness`).

### 5c. A new pin now gets its own geometry (`a6280572`) — queue #1, the owner's original question
All three audited blockers addressed **structurally rather than carefully**:
1. **Event loop** — `resolve_many` is plain BLOCKING and a test asserts it is not a coroutine. It
   ships as a script, deliberately NOT wired to the ingest workflow; `--dry-run` exists so cadence
   is chosen from a measured backlog.
2. **Displacement** — the overlay is consulted ONLY when the committed asset returns nothing, so a
   new entry can never displace a gate-passed neighbour. By construction, not by tuning a radius.
3. **Two sites** — `shore_normal_at` and `break_depth_at` now share ONE `_nearest`. There is nothing
   left to wire twice.

Same `measure()`/`accepted()` gate as the committed build — no lower bar. `needs_geometry` gates on
readiness `actionable`, so ~22 s of ERDDAP is never spent on a pin that simply has to move.

⚠️ **Two bugs the TESTS caught, not review:** `add_overlay_entry` called `_load_overlay()` while
holding a non-reentrant lock and **deadlocked the process** on the first call (the suite HUNG rather
than failed — that is what exposed it); and `resolve_many` had no injection point, so testing it
meant dialling NOAA at ~22 s a spot.

### 5d. The science now has a spine
`memory/THE-SURF-FORECAST-SCIENCE-canonical-chain.md` — the one canonical description of how an
offshore model number becomes a surf height and a 0-100 quality: every stage, every measured number,
the five invariants, what a new pin inherits, and the known-missing physics so it is not mistaken
for a bug. The memory index had also grown to 19.9 KB against a 24.4 KB read limit and was compacted
to 17.0 KB by delegating the science detail to that spine — **an index that cannot be read is the
same as no memory at all.**

### ⛔ QUEUE AFTER THIS SESSION
Closed: #1 (geometry on a new pin), #2 (partitions — height half). Still open: **#3 Kr directional
transfer function** · **#4 depth-dependent height** (confirmed as the prerequisite for tide) ·
**#5 shore normals, 434 spots** · #6 `SURF_V3_KOMAR=0` mislabelled · **#7 EURO waves blank day
(USER-REPORTED, still untouched — it should outrank refactors)** · #8 friction inert at ~46% ·
#9 tide times render in the viewer's timezone · #10 thread a spot id into the hub (spawned) ·
#11 sim name resolution misses accents. **NEW #12: wire `partitions` into the RATING.**
**NEW #13: decide the `SURF_PARTITIONS` rollout by measuring it in the precompute.**
