# HANDOFF 2026-07-30 — the sim: one composition, and the time dimension

**Continues `START-HERE-2026-07-30-verified-session-state.md`.** Read
[[standing-work-rules-user-mandate]] first.

Owner's brief: *"get the weather simulation system features of this app working well."*

**Branch `dev`, tree clean. 16 commits unpushed** (`origin/dev..HEAD`). Backend **1,317 passed**
(was 1,277), 2,928 skipped, LOC ratchet green. One pre-existing unrelated failure remains:
`test_media_privacy_contracts.py::test_protected_grom_media_...`, confirmed still the same
grom-media source assertion and untouched by this session.

| commit | what |
|---|---|
| `c0fbc69a` | the what-if had to be told the weather it was asking about (+ the composition extraction) |
| `49821439` | the next engine input must reach every surface, or the suite goes red |
| `f70d2a4f` | the forecast cache held exactly one hour, so a time series re-fetched every frame |
| `e370db06` | the sim could say how it is at an hour, never WHICH hour |

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

### The measured cost — 540 combinations, hub vs glyph on identical inputs

| | `|dScore|` median | max | **LEVEL differs** |
|---|---|---|---|
| all flags OFF (**production today**) | 0.0 | 0.0 | **0.0%** |
| `RATING_LOCAL_SIZE=1` | 10.5 | 75.2 | **60.6%** |
| `RATING_TIDE=1` | 17.4 | 34.7 | **71.5%** |
| both | 23.6 | 82.5 | **78.5%** |

⇒ **Nothing is wrong today, and one flag flip makes the hub disagree with the map on 6 of every 10
spot-hours.** `test_rating_composition_parity.py` requires every surface to declare SUPPLIED or a
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
    with the 60.6% measurement and all ~7 call sites listed.
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
2. ★★ **A waiver must carry a number.** "We didn't wire tide" is an excuse; "18 of 1,773 spots yield
   a usable band, and flipping the flag diverges 71.5% of levels" is debt inventory that tells the
   next person what to do.
3. ★★ **Measure before assuming the thing you were asked to fix is broken.** The sim's score parity
   was green at 15/15; the work was therefore features and durability, not a rescue. The two hours
   that would have gone into "fixing" a correct engine went into the time dimension instead.
4. ★ **A cache's eviction policy encodes an assumed access pattern.** One-hour retention was correct
   for "sweep many spots at one hour" and exactly wrong for "sweep one spot across hours" — and the
   test asserting `[2, 2, 2]` was pinning the very behaviour that defeated the new feature.
5. ★ **Extract to make room BEFORE the ratchet blocks you.** This file blocked two sessions at
   789/800; the split is what made three of this session's four commits possible.
