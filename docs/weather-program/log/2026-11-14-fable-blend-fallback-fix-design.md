# 2026-11-14 · fable · the model blend's defect: fix design and its test, written before the cause is confirmed

Session: the Fable repair lead (worktree `fable-repairs-ec7369`), on the director session's request (2026-11-13 20:40 EST):
do not build yet; read the build code and write the design and its pre-registered test, so the build can start the day
the 2026-11-16 read confirms the cause. Docs only. No code, flag, served number, workflow dispatch or live backend call.
Read at `origin/dev`: `consensus_product.py`, `consensus_ingest.py`, `consensus_serve.py` (read only: Codex-reserved),
`sampler.py`. Nothing here is measured; every number is quoted from `log/2026-11-14-fable-archive-three-questions.md`.

## 01:44Z What the code shows (proven by reading, not by a run)

1. **A member "answers" a cell through any sampler path except two.** `consensus_product.member_answer` refuses only
   `unavailable` and `out_of_bounds_fallback` (`_NO_ANSWER`). A member whose own grid has land at a GFS cell still
   answers it through `nearest_ocean_fallback`, `nearest_ocean_coarse_masked` or `bilinear_ocean_masked`, that is,
   with a neighbouring cell's sea, up to max(1.5 cells, 1 deg) away. The blend takes that value as the member's.
2. **The shadow and the served product treat an unanswered cell differently.** The shadow is built with
   `unblended="mask"` (`consensus_ingest.build_hour`): a cell the members could not all answer is marked invalid. The
   served product (`CONSENSUS_SERVE`) keeps GFS's own value there (`consensus_serve.py` docstring, line 6).
3. **So at a point whose cells are masked, the shadow's row is not what would be served.** The point sampler finds no
   valid corner in the shadow product and falls back to the nearest blended cell. The served product would give GFS's
   own cell there. The shadow lane grades a product nobody would serve at exactly those points.

Two places a far-water value can enter, which the record so far does not tell apart:
- **(A) at build:** a member answers a coastal GFS cell from far water (point 1). The cell is blended and looks valid.
- **(B) at read:** the cell is masked in the shadow, and the buoy's read falls back to a neighbouring blended cell
  (points 2 and 3).

The measured defect fits either: the shadow loses to the lane mean by 0.100 to 0.202 m only where a member lane found
no stored product at the point, which is where member coverage is thin and cells are either masked or fallback-answered.

## What the 2026-11-16 read decides (rule already fixed in `log/2026-11-14-fable-shadow-interp-grouping.md`)

That grouping reads the SHADOW's own sampler path at the buoy, so it tests (B) directly and (A) only by elimination.

| Verdict on 11-16 | Meaning | Next |
|---|---|---|
| FALLBACK IS THE CAUSE | (B): the shadow row is a neighbour's blended cell | Build fix 1 below |
| CONSISTENT, NULL ARM MISSING | (B) fits, no plain-path cell to contrast | Build fix 1; its own test supplies the null arm |
| REFUTED | the shadow reads its own cell and is still high: the cell itself is wrong | Hypothesis (A): instrument first (below), then fix 2 |
| UNTESTABLE | the shadow's rows carry no path | Find why `interpolation_method` is empty on the shadow's point response; re-read |
| UNDECIDED | neither rule met | Both instruments below, no build |

## Fix 1 (for cause B): the shadow mirrors what would be served

- `consensus_ingest.build_hour` builds the shadow with `unblended="keep"` behind a new flag, so an unanswered cell
  carries GFS's own value, as the served product would. The frame's diagnostics already count `kept_primary`; the
  share of kept cells is reported per frame so a mostly-GFS frame is visible and not mistaken for a blend.
- The reason the mask was chosen ("the shadow never serves a GFS-only value under the consensus name") is met another
  way: the shadow lane is never served; and the row records `interp`, so kept cells can be separated in the ledger.
- Files: `consensus_ingest.py` only (not Codex-reserved). `consensus_serve.py` is not touched.
- Served numbers: none. The shadow is a measurement lane. So no D-065 history filter; a flag with a kill switch, the
  flag registry and a SCOREBOARD row for the lane's definition change.

## Fix 2 (for cause A): a member answered from far water is not an answer

- `member_answer` also refuses the fallback paths (`nearest_ocean_fallback`, `nearest_ocean_coarse_masked`,
  `nearest_scalar_fallback`), behind a flag. The cell then counts as unanswered: GFS's own value when served, and under
  fix 1 GFS's own value in the shadow too. `bilinear_ocean_masked` (a blend of the wet corners of the bracketing cell)
  stays an answer: it is local water. That choice is an assumption and is one arm of the test.
- This changes what `CONSENSUS_SERVE` would serve, so D-065 applies in full when the blend is served; today the flag is
  off, so the only moving number is the shadow lane's.
- Files: `consensus_product.py` (not Codex-reserved).
- Fix 2 without fix 1 makes (B) worse: more masked cells, more neighbour reads. If fix 2 is built, fix 1 goes first.

## The instrument for (A), needed only on REFUTED or UNDECIDED

`_build` gains a per-member count of answers by sampler path in `grid.diagnostics["consensus"]` (measurement only).
Reading it needs stored frames, so it also needs the dispatch-only tile job (not built) or a new line in the ingest
log. Rule for that read, fixed now: (A) is supported if, on frames at +48 h and later, at least 20% of blended coastal
cells (a cell with a land neighbour) have a member answered by a fallback path, against under 5% at +24 h.

## The test of the fix, fixed now (the fix is not written; no row from a fixed build exists)

**Unit level, before merge (synthetic, known answers):**
- A GFS grid with a coastal cell; a member whose grid is land there and whose nearest wet cell holds 3.0 m against a
  local 1.0 m. Before: the blended cell reads high by the planted amount. After fix 2: the cell is unanswered and
  carries GFS's 1.0 m (keep) or is invalid (mask). After fix 1: a point in an unanswered cell reads GFS's own value,
  and its `interp` is a plain path.
- Null arm: a grid where every member has water at every cell is byte-identical with the flags on and off.
- Kill switch: each flag at "0" restores the old product byte for byte.

**Ledger level, after merge and deploy (the acceptance read):**
- Window: shadow rows whose forecast was made after the deploy, at least 7 days of targets, at +48 and +72 h.
- Same table and grouping as today (`scored-rows-gate.yml`, "member tiers"); only cells with n >= 100 count.
- **PASS** if on every mixed group shadow MAE - lane-mean MAE <= +0.020 m at both leads (today +0.100 to +0.202), AND
  on all rows shadow MAE - lane-mean MAE <= +0.005 m at both leads (today +0.072, +0.071), AND the stored/stored group
  stays within 0.010 m of its value today (-0.004, -0.005).
- **FAIL** if any mixed group with n >= 100 still reads >= +0.050 m at either lead.
- Otherwise **PARTIAL**: reported with the numbers; the 14-day shadow run does not start on a PARTIAL.
- Also reported, no threshold: the share of kept cells per frame and the share of shadow rows whose value is GFS's own.
  If most mixed rows become GFS's own value, the blend is simply absent there, and "the blend matches the lane mean"
  would be false: say so instead.
- Limits, stated now: pairs, not independent stations; no interval in this table; the lane mean on mixed rows uses
  Open-Meteo's copy of a member, which our serving path would not use, so matching it there is a bar the served
  product may not be able to reach. The honest bar on mixed rows may turn out to be "no worse than served GFS".
- Only after PASS: the pre-registered 14-day shadow run of the mean (step 2 of #866), with Hawaii and big-swell endpoints.

## Also recorded here: red-team limit 5 on #852, traced

No served number uses the sample at buoy 46267's coordinate. By code search at `origin/dev`: the buoy calibration report
is read only by `GET /api/weather/buoy-calibration` (diagnostic) and measurement scripts;
`height_quantile_map.apply_height_quantile_map` has no caller in `services/` or `routes/`; the skill ledger's scored rows
are read only by the skill modules and scripts. What moves when 46267 returns "no data" is measurement only: the
calibration summary, the skill ledger's served lane, the shadows' fits. A search for readers, not a run.
