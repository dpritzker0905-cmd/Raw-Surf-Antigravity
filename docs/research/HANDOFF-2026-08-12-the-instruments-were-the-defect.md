# Handoff 2026-08-12 — the instruments were the defect, four times

Supersedes the status lines in `HANDOFF-2026-08-11`. Everything of mine is pushed; nothing is
uncommitted on my side. Tip at writing: `b5632fc7`. Backend CI **20 pass / 0 fail**; `e2e` red for
environmental reasons documented below.

---

## ⭐ THE HEADLINE — `SURF_TIDE_DEPTH`, four samples, and one honest gap

| # | window | replayable | moved | max abs delta | tail rows |
|---|---|---|---|---|---|
| 1 | 08-09, 3 h | 486 | 0 | 0.2 | none |
| 2 | 08-11, 5 h | 496 | **8** | **3.2** | none |
| 3 | 08-12, 12 h span / **5 distinct served frames** | 123 | 0 | 0.2 | none |
| 4 | 08-12, 1 live frame | 15 | 0 | 0.2 | **4, to 3.22 m** |

**Sample 3 retired the tide-PHASE hypothesis** — it covered a measured 2.4–3.1 m tidal swing and
moved nothing. **Sample 4 is the first observation of the depth-limited regime ever taken** and
shows the same smallness.

⚠️ **SAMPLE 2 IS NOW UNEXPLAINED BY EITHER HYPOTHESIS.** Phase is dead (3), size is not supported
(4). I do not have a third explanation and did not invent one. Three of four samples say the term
is user-invisible; the outlier survived both stories I had for it.

▶ **NEXT: sample 5, once the precompute writes tail rows.** Unlike the false blocker I wrote
yesterday, this clock names the observation that ends it:
**`rows >= 2.5 m carrying inputs > 0` on a `source: precomputed` frame.**
Then `--frames-file` a production frame and read the **DEPENDENCY** line, never the headline.

---

## ✅ SHIPPED (all pushed, all verified before and after)

- **Tail sampling** (`b5632fc7`) — big surf now sampled UNCONDITIONALLY on top of the uniform 5%
  draw. `SPOT_RATINGS_INPUTS_TAIL_M` default 2.5 m. **Verified live in production:** rows >= 2.5 m
  carrying inputs went **0 of 7 → 4 of 4**; max sampled height **1.93 → 3.22 m**; payload +~0.6%.
- **Three coverage disclosures** in `science_shadow_ab.py`, none able to see the others' failure:
  `! SPAN UNKNOWN` (2323874a), `! REPEATED FRAMES` (70fa7144), plus the tail fix above.
- **The floor-provenance trap fixed at the CLASS level** (d4c4f5d3) — the staleness prescription
  now names BOTH edit sites, the file, the key and the value.
- **CI floors** carried forward correctly: guards 1685→1695→1699, estate `_FLOOR_SET_FROM`→349.

## ⛔ STILL DARK / OWNER-GATED (unchanged from 08-11)

`__RAW_LAYER_CAP_ALIAS__` · `__RAW_AXIS_FLOOR__` · `__RAW_RATING_SPAN_FADE_HI__ = 40`.
Radar legend units (#9) still blocked on the external RainViewer scheme-7 palette spec.
`BRAIN_RULES.md` still carries a committed live API key — owner rotation.

---

## ⭐⭐⭐ THE RULES THAT PAID FOR THEMSELVES

1. **A sample can look broader than it is, and each way is invisible to the guard for the others.**
   Span=None fell out of BOTH branches · 12 requested hours = 5 SERVED frames · a uniform 5% draw
   reaches a 1.5% tail never. ⭐ **Span is a property of the REQUEST; coverage of the RESPONSE.**
2. **A prescription naming one of two required edits has a 100% miss rate.** Three consecutive
   commits, two authors, same trap. ★ **Fix the INSTRUCTION, not the third instance.**
3. **A prescription computed from the last GREEN run cannot see tests already committed but not yet
   run.** Its number describes the past; a floor must survive the future. Project it, mark it
   PROJECTED, **show the arithmetic** — that is what makes it falsifiable rather than fabricated.
4. **A DEPLOY IS NOT A PRECOMPUTE.** Production ran `b5632fc7` while serving a blob written by its
   predecessor. The first reading said my change had failed; the deploy SHA said it had worked.
   **Both were true and neither was the answer** — the live-compute fallthrough was.
5. **A blocker I authored decays exactly like anyone else's, and I trust mine more.** "A third tide
   sample needs a large swell — a clock, not a task" died to one API call.
6. **A verification inherits the working directory of what it verifies.** A persisted `cd` made a
   restore fail AND made the `git diff` confirming it report "0 lines changed" — a clean reading
   from the wrong scope, leaving a bogus floor in a shared tree.
7. **A hand count is a measurement.** I published "3 distinct served frames"; the instrument said 5
   and was right. I applied no scepticism to it purely because I had done it myself.

---

## ⛔ WHAT I GOT WRONG (the useful half)

| # | wrong claim | what caught it |
|---|---|---|
| 1 | "backend-floor-staleness has already cleared" | RUN-level conclusions vs JOB-level; `gh pr checks` |
| 2 | fixed the floor, left `_FLOOR_SET_FROM` stale | the paired test, on the very next run |
| 3 | my own prescription stated a FALSE equation | forcing the branch to execute against a mutated floor |
| 4 | non-ASCII in a print, on cp1252 stdout | **twice** — my own most-recorded Windows trap |
| 5 | "3 distinct served frames" | the instrument I had just written said 5 |
| 6 | nearly published a "12-hour" sample | inspecting ONE instance before parsing the set |
| 7 | +24 LOC into a file with a HARD 800 limit | checking `wc -l` before committing, not after |

★ **Every catch came from a control, a mutation, or executing the thing. A green suite caught
none of them** — and in the SPAN UNKNOWN case the suite *could not*: its own helper emitted no
`hour_offset`, so all 29 tests ran the silent path.

---

## ⚠️ OPEN, AND WHOSE

- **Sample 2's outlier** — mine, unexplained, no third hypothesis. Do not paper over it.
- **`break_depth_m` present on only 9 of 15 sampled rows** — noticed, not chased.
- **A served row is not internally time-consistent** — tide is evaluated at the REQUESTED hour
  while the wave field can be a stale precompute (waves 01:00Z + tide 09:00Z in one row). That
  accident is what made sample 3 near-controlled. Nothing discloses it. **Serving-path, owner call.**
- **`spot_ratings.py` is at 796 of a HARD 800** (not grandfathered). The next rationale added there
  breaches it. Relocation works — the file is simply out of room.
- **`e2e` red — environmental, not ours.** 36× `page.goto: Operation was cancelled`, 13× 90 s
  timeouts, 12× 404, 12× 401, Mapbox failures, and a broken `/* mocked */` JSON fixture. Nothing
  touching `spot_ratings` or the inputs payload. ⚠️ I mis-attributed an e2e red once this week
  (called it a deploy race when the backend had been up 10–20 min), so this reads the SIGNATURE.
- **The band/glyph per-cell composition** — the concurrent session's. Do not tune either lane.

## ▶ IF YOU DO ONE THING

Run sample 5 when the precompute has tail rows. It is the first time the depth-limited regime will
be observable with a real n and a real span, and it is the only remaining way to either explain
sample 2 or retire it.
