# HANDOFF 2026-08-01 C — provenance, the Jacobian, and what carried over

⚠️ **THIS IS ONE OF THREE PARALLEL HANDOFFS. Read the queue first, then all three.**
* **`START-HERE-2026-08-01-THE-ONE-QUEUE.md`** — the single entry point (IDs #1–#11). **Start there.**
* `HANDOFF-2026-08-01-B-audit-close-and-the-queue-that-moved.md` — a concurrent context's close.
* `HANDOFF-2026-08-01-two-agents-one-tree-and-a-fix-that-could-not-fire.md` — the shared-tree session.
* **THIS FILE** — the 2026-07-30 provenance/geometry/Jacobian arc, written from a context that has
  since been overtaken by ~60 commits. Its *findings* stand; its *queue* is superseded by the
  ONE QUEUE above.

Full detail for this arc: **`HANDOFF-2026-07-30-EVE-provenance-geometry-and-the-jacobian.md`**
(committed `5c1a3e94`). This file is the carryover: what survived, what was superseded, and what
is still owed.

---

## 0. STATE AT WRITING

`origin/dev` == HEAD == `e42534d1`, **0 unpushed**. Working tree has **3 untracked files** — see §3.

---

## 1. ★★★ WHAT THIS ARC ESTABLISHED (still true, verify before trusting)

### The measured Jacobian — read before choosing what to improve
Perturbing one input by a REALISTIC error, from a 1.5 m / 14 s / light-offshore / head-on base:

| input | realistic error | **Δ score** |
|---|---|---|
| **shore normal** | **+22.3° (its MEASURED median error)** | **6.0** |
| **shore normal** | **+45° (26.6% of spots are worse)** | **23.6** |
| Tp | +10% | 2.7 |
| wind | +10% | 1.3 |
| **offshore Hs** | **+10%** | **0.0** |

★ **Leverage = sensitivity × uncertainty; the shore normal wins both.**
⚠️⚠️ **Hs accuracy was worth 0.0 to the SCORE above chest-high** because `size_score` saturated at
the global 1.2 m default. That made **local size climatology the unlock** — and commits
`f827ff65` / `44020553` have since landed it. **RE-RUN THIS JACOBIAN**: with a real climatology
blob the Hs sensitivity should no longer be 0.0, and if it still is, something did not wire.

★ Depth-blindness, concrete: **Trestles and Pipeline produced a byte-identical 3.063 m** — both
shelves so deep that friction AND shoaling are inert and the cap never binds. At most spots the
transform is ~a constant 1.5× on Hs.

### Provenance — two labels were lying (both fixed)
* ⛔ **`provider` is a DISPATCH KEY, not provenance.** `normalizer.py` branches on it to choose
  `source_dataset` AND the whole CMEMS variable mapping. **Never repurpose it.** It reads
  `open-meteo` for ECMWF, NOAA and DWD data alike. Fixed `4d69e62a` by propagating the
  `__provider` tag every direct fetcher already stamped into `upstream_provider` (self-correcting:
  no tag ⇒ Open-Meteo genuinely served it).
* ★★ **A coarse shore normal was served to 14 decimal places** (`111.54097591853844`) with no
  source, no depth, no verdict. Fixed `8ce65c95`: `shore_normal_source`, `break_depth_m`,
  `geometry_readiness` (full|degraded|blind) + `geometry_missing`, stamped at the single injection
  point so glyphs/hub/sim inherit ONE verdict. ⚠️ **`geometry_readiness` ≠ `confidence`** —
  confidence grades the PIN, readiness grades the INPUTS.

### The gate is all-or-nothing; the measurements are not (`e058ea49`)
A live ERDDAP run (the first ever — all prior tests used fakes) **killed my own backfill plan**: a
spot with no asset entry is one the gate ALREADY REJECTED, and the fit is deterministic, so
re-running reproduces the rejection. **707 "actionable" spots were never a backfill opportunity.**

But the rejected fit still carried a usable `break_depth_m`. `nearshore_depth_m` never sees the
bearing fit and self-gates below 3.0 m. So the gate now splits:
* **PLACEMENT** rejections (`spot_misplaced*`, `not_on_open_ocean_*`) ⇒ publish **nothing**.
* **BEARING-ONLY** (`ambiguous_coastline`, `too_few_windows`) ⇒ publish the **depth**, withhold the
  bearing. ALLOW-list, not deny-list; unknown reason ⇒ nothing.

✅ **Independence proven, after I flagged it unresolved:** Pearson **r(spread, depth) = +0.0403**
over n=1,087; band medians flat (11.0 / 11.3 / 10.6 / 15.0 m across 0–40°). ⚠️ Variance grows in
the top band (p90 46 → 134 m) — noisier, not biased.
★★ **And I had compared Bondi to the wrong control.** Its 21.0 m looked generous beside Mavericks'
22.1 m, but Mavericks is a different coast; Bondi's 12 nearest gate-passed neighbours read median
12.5 m and the two within 1.5 km read 17.0 m @ 34.7° and 13.0 m @ 39.9°. **Compare a spot to its
NEIGHBOURS.**

---

## 2. ⚠️ WHAT IS SUPERSEDED — do not act on the old queue

~60 commits landed after `5c1a3e94`. From their subjects, at least these of my queue items are done:
`f827ff65`/`44020553` size climatology + ERA5 · `646f76ef` **geometry travels with the spot
(columns, seed, staleness contract)** · `7502cc4b` partitions reach the rating at every surface ·
`d472a075` one writer + self-erase guard. Plus a marine direction/vortex arc this context never saw.

⚠️ **I have read commit SUBJECTS ONLY, not the code.** Treat the §3 "state-of-the-art path" in
`GEOMETRY-must-travel-with-the-spot-2026-07-30.md` as **largely implemented** and re-verify rather
than re-propose. Use **THE ONE QUEUE** for what is actually open.

---

## 3. ⛔ UNTRACKED RESIDUE — decide, do not ignore

```
backend/services/weather_pipeline/data/shore_normals_overlay.json   ← 5 DEPTH-ONLY entries
backend/scripts/geometry_backfill.json                              (4.8 KB, another context)
backend/scripts/geometry_backfill.sql                               (6.0 KB, another context)
```

★★ The overlay holds **5 depth-only entries** — `[lat, lng, null, null, depth]` — i.e. the §1 gate
split has been exercised at scale by a later run, not just my Bondi test. **It is NOT gitignored.**

⇒ **Two open decisions, neither made:**
1. **Commit it or ignore it?** It is documented as a *CACHE on an ephemeral disk*. If geometry now
   lives on the spot row (`646f76ef`), this file may be **redundant or a second source of truth** —
   the exact duplication the ONE COMPOSITION rule exists to prevent. Decide deliberately.
2. If kept as a cache, **add it to `.gitignore`** so a stray `git add -A` cannot make a cache
   durable by accident.

---

## 4. ⛔ STILL OWED FROM THIS ARC — the EURO cadence seam (user-reported)

Root **correctly attributed and NOT fixed**. Not a wrong provider, not a fixed date:
ECMWF's own step list is **3-hourly→144 h then 6-hourly→240 h**. The scrubber walks a uniform
3-hourly grid, and the estimated filler only starts *past the end* of native coverage
(`scheduler_helpers.py:681`, `p.valid_time_start > anchor_time`). ⇒ every odd-3 slot between
+144 h and ~+204 h has **no product at any global tier** — measured **10 dead slots, all ≡ 3
(mod 6)** — walking forward a day per day, which is why it read as "Sat blank, Fri/Sun fine".

★ **Gated on a HORIZON when the defect is a CADENCE.**

⚠️ Cross-check against the ONE QUEUE's lattice work — invariant 7 in the science spine
(`timeline_slot_census.py --fail-on-dead`, `lattice_fill.py`) may already cover or conflict with
this. **Verify before implementing.** Options, in my order: (a) make the series honest about a
6-hourly source; (b) extend the filler to in-band gaps (needs interpolation, not the persistence
blend); (c) serve-time interpolation (real per-cell compute on a 1-CPU box with melt history).

★ Bonus finding: the total (`waves`) is **ECMWF WAM 0.25°** while the partitions are **CMEMS
0.083°** — *different models*, so quadrature was never going to close. That independently justifies
`reconcile_partitions`.

---

## 5. ★ METHOD NOTES — four of my own claims died this session

1. ★★★ **Do not correct a suspect label by trusting another label.** I "corrected" the owner on
   EURO using `source_dataset` — which names the MODEL that both fetch routes share.
2. ★★★ **Sweep a bounded factor before quoting a number off it.** I reported a worst-case tide
   point (71.5%) as typical; swept, **41.0%**.
3. ★★★ **Compare a spot to its NEIGHBOURS, not to a famous spot elsewhere.**
4. ★★★ **Test the riskiest assumption against the REAL dependency before planning around it.**
   `resolve_one` passed 28 tests with fakes and published nothing on its first real call.
5. ★★ **A broad `except Exception` hides CODING errors.** A LOC-forced extraction left a stale
   `self`; the except swallowed the `NameError` as a debug line and **the surf transform was
   silently OFF** while every response still validated. One test caught it.
6. ★★ **A field that cannot distinguish the thing it is named for is worse than no field.**
7. ★ **A source-grep assertion must know every shape it can take** — mine matched only a literal
   `"__provider": "ecmwf"` and falsely reported the ECMWF fetcher broken; it stamps via a helper.

---

## 6. MEMORY WRITTEN BY THIS CONTEXT (all indexed in `MEMORY.md`)

`THE-SURF-FORECAST-SCIENCE-canonical-chain` (the spine) ·
`JACOBIAN-the-shore-normal-dominates-2026-07-30` (what to fix, with the resolved caveat) ·
`GEOMETRY-must-travel-with-the-spot-2026-07-30` (⚠️ largely implemented since — re-verify) ·
`provenance-what-a-number-says-about-itself-2026-07-30` ·
`memory-tooling-preference-mem0-is-limited` (**mem0 is METERED — local files first, mem0 last**).
