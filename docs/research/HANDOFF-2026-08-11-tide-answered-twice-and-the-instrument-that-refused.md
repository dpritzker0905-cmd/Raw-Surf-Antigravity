# Handoff 2026-08-11 — the tide answered twice, and why the second answer mattered

Final handoff for this session. Supersedes the status lines in `HANDOFF-2026-08-10`.
All my work is pushed; nothing is uncommitted on my side.

---

## ⭐ THE HEADLINE — `SURF_TIDE_DEPTH`, measured at TWO tide phases

| sample | window | rows moved | max \|delta\| | levels changed |
|---|---|---|---|---|
| 1 | 2026-08-09 21:00–00:00Z | **0** of 486 | 0.2 pts | 0 |
| 2 | 2026-08-11 12:00–17:00Z | **8** of 496 | **3.2 pts** | 1 |

**Sample 1 alone would have been recorded as "user-invisible" and become settled.** Sample 2 —
same instrument, same candidate, a different tide phase — moved 8 rows and crossed one level
boundary, with a largest movement **16× sample 1's**. The `! NARROW` warning that flagged the
3-hour window is the only reason a second sample was taken.

⇒ **Honest verdict: SMALL in ordinary conditions, UNMEASURED in extreme ones.** Not "safe".
The term binds at the depth-limited cap (~12 m offshore at Pipeline), and no big-swell day has
been sampled. The harness proves it can see a **38.1-point** move, so the smallness is real
rather than blindness.
▶ **Next: a third sample during a large swell.** That is a clock, not a task.

The `* INFERRED` line did real work here: **8/8 rows that moved carry `water_level_m`, and none
of the 5 without it moved** — the dependency was discovered from the data, no registry consulted.

---

## ✅ SHIPPED (mine, all pushed)

- **Shadow A/B** (`science_shadow_ab.py`) — replays served spot-hours under a candidate flag set.
  **11 refusal/disclosure paths**, every one added *after* it had already been fooled: baseline
  self-check, NOT-READY≠REFUSED, COVERAGE + `! NARROW`, positive control (`candidate_can_move`),
  `! DILUTED` / `! BLIND`, and registry-free dependency inference.
- **Readout-truth fixes**: ft/m toggle reaching the infobox cards (+ a drifted 3.281 constant);
  fog reading `--` on EURO/ICON under a live GFS raster; legend numbers sitting up to **47 pp**
  from their own colours; model-substitution and stale-hour disclosures.
- **Horizon work**: eight cross-fall cutovers named and drift-guarded; the stale-frame defect
  proven; `effectiveCutoverH` live-axis floor.
- **Telemetry**: percentiles no longer print a bound as a measurement (overflow now marked
  `pNN_ge_ms` + `over_10000ms`), and a percentile can no longer exceed the observed max.
- **`marineController` 853 → 791** — rationale relocated verbatim to docs (the owning session then
  split it properly: `f5b0a9e8`, 853 → 776).

## ⭐ NOW LIVE (owner flipped it)

`__RAW_NEARSHORE_RENORM__` is **ON** (`679da3d9`). Height no longer gets zero-filled on land *and*
decayed — the double penalty measured at **11.43×** worst case. `= false` reverts.
⚠️ It does **not** change the backend point lane, which was already correct
(`sampler.py:365/390/429`). It makes the two lanes **agree**.

## ⛔ STILL DARK (default off, byte-identical, evidence attached)

| flag | effect when ON |
|---|---|
| `__RAW_LAYER_CAP_ALIAS__` | ICON rain scrubber 14 d → 7 d (fixes `rain` only — `temperature`/`water_temp` have **no capability row**) |
| `__RAW_AXIS_FLOOR__` | a silent stale-frame *time* lie becomes a *disclosed* model substitution |
| `__RAW_RATING_SPAN_FADE_HI__ = 40` | closes the 9.5–40° dead zone where a rated band paints at alpha 0 |

---

## ⚠️ OPEN

- ~~**LOC RED RIGHT NOW**: `MapWeatherControls.js` 957 → 982~~ — ⚠️ **RETRACTED, I WAS WRONG.**
  CI LOC Governance is **green**; the file is **952 committed** (under its 957 baseline). The 982
  was my **local working tree**, carrying the concurrent session's **uncommitted** +29 for an
  in-flight feature (`servedResolutionNotice`, still untracked). I quoted a local `wc -l` as the
  shipped state without running `git status` first — the same local-vs-production error this very
  document catalogues, made inside it. Nothing to fix; it becomes theirs when they commit.
- **Radar legend units** (#9) — needs the RainViewer **scheme-7 palette spec**, absent from this
  repo. I refused to invent dBZ thresholds; fabricated numbers read as measured ones.
- **Serving latency** — `/api/health` p90 16 s, RSS 70–73% of a 2 GiB cap, **stable, not leaking**.
  Belongs to the concurrent session's OOM thread.
- **Band/glyph per-cell composition** — theirs. Do not tune either lane.

---

## ⭐⭐⭐ THE RULES THAT PAID FOR THEMSELVES

1. **A mechanism that predicts the wrong SIGN is refuted, not "partial."**
2. **A null result from an inert lever is not evidence of a quiet lever** — prove the harness can
   move the thing first. (This produced a false "safe to flip" for a lever worth 38.1 points.)
3. **An instrument may not tax the product it measures** (+42.8% on a client-downloaded blob).
4. **A stale comment on a flag-gated path reads true for as long as the flag is off** — and the day
   it flips is the day the claim matters.
5. **Run the lane the gate runs, not the subset you trust.**
6. **Being cautious can be the more damaging choice.** Twice: I left a shared branch red on a
   principle that did not apply to the fix actually available, and nearly left a stale comment
   standing.

**The through-line, and the most useful thing to carry forward: my instruments failed far more
often than the code under test — ~16 times across this session — and a green suite caught none of
them. Every catch came from a control, a mutation, or executing the thing.**
