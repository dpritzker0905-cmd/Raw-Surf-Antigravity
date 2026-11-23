# 2026-11-23: triage of five unowned draft PRs (#1071, #1075, #1078, #965, #663)

Session: draft-triage, a side session of the director (local_d6b521eb). The owner said "Yes open it" in the director session,
2026-11-23. Dev was at 1e41f0203 when the PRs were read. Every branch is kept; only the PRs were closed.

## How each was decided

For each PR, the session read the PR, its log and decision entries, and what dev already has. It then put one public brief to
SubQ (savant-1.4), Reflection (Beam) and LongCat (2.5, via preview_review then submit_review): "what is the best path toward
SOTA: close as superseded, finish, or hold for the owner?" The brief held no secrets. All three gave the same five verdicts
independently. LongCat wrongly attributed EURO cloud to #1075; that slip changed no verdict.

## Verdicts

| PR | Verdict | Outcome |
|---|---|---|
| #1071 ICON air temp 0.125 | Superseded by #1136 (d4e8123df) | Closed |
| #1075 ICON rain 0.125 | Superseded by #1136 | Closed |
| #1078 EURO cloud | Superseded by #1136 | Closed |
| #965 0.5° world wave tier (B1) | Owner: **"Fold into coastal, close"** | Closed |
| #663 EURO scalar height flip (draft D-057, renumbered D-073) | Owner: **"run this by longcat, subq, and reflection. If retire it is best go that way"**; all three said RETIRE | Closed, retired |

### #1071, #1075, #1078: superseded

Dev has, through #1136:
- their client keys, `ownOnlyModels`, `gapFill`, the three test files (`ownRasterIconTemp`, `ownRasterIconRain`,
  `ownRasterEuroCloud`) and the three kill switches;
- the fixes for the advisor's holds: the session-long "unavailable" latch is now a 60 s retry, and the Open-Meteo credit is
  corrected;
- the answer to the owner's hold on blank ranges past ICON 180 h and EURO 240 h: a labelled fill (the coarser set, then the
  anchored prediction, then a GFS stand-in). It never uses Open-Meteo.

### #965: folded into the coastal band

- **What already lives on:** the vectorized reductions (`services/_fetch_region_reduce.py`, #962) are on dev, and the
  coastal-band writer calls them.
- **Where its purpose goes:** the tier was meant to stop a first visit outside a 0.25° pilot box from dropping to the 2° world
  frame. That becomes the band's fallback design, scoped inside the coastal-band lane under its one pilots-pass budget
  (fable-coastal-band-slice3-answers, condition 6).
- **Reference only:** the PR's tiled gzip-member packing and its byte-for-byte gate (1a).

### #663: retired

The only paired buoy read (#925, Actions run 43754098448, `log/2026-11-15-claude-verifier-euro-scalar-read.md`) was VOID on its
own C1 control. Read for the record only, it showed:
- a pooled dMAE of -0.002 / -0.006 / -0.008 m at +24 / 48 / 72 h, none significant;
- a high bias that rises at every lead (pooled +0.11..+0.20 m against +0.09..+0.15 m);
- Hawaii and the NE Pacific worse.

A second read on rows already seen risks p-hacking, and the buoy skill gate remains to catch any real EURO height issue. EURO
marine heights keep the vector-mean interpolation, and `SAMPLER_SCALAR_HEIGHT_MODELS` stays `GFS`.

### The EURO shadow lane: turned off after forensics, testing and the three advisors

The owner, 2026-11-23: "lets make sure turning it off it the SOTA way forward using forensics and testing. Then bouncing it
off reflection, longcat, and subq".

**Forensics** (dev 4c7b37304; forecast-ingest run 45142574342, 2026-11-23 10:47Z):
- **Consumers:** nothing served or paging reads `raw_surf:EURO_SCALAR`. Its readers were:
  - the retired D-073 read script;
  - the shadow-only reports, which take any source generically: the MOS shadow, the paired direction/period report (it
    strips `_SCALAR`) and the monitor table, which is informational for `raw_surf:*` lanes.
- **Cost:** the skill ledger's pending queue held 59,520 of its 68,000 cap (87.5%). Past the cap, the farthest-lead rows of
  every lane are evicted, which is how the instrument went dark on 08-04. EURO_SCALAR is one of 11 lanes, about 5.4k rows. CPU
  is minor: the whole skill pass took about 30 s.

**The change:**
- `SAMPLER_SCALAR_LEDGER_MODELS` goes from `'GFS,EURO,ICON'` to `'GFS,ICON'` in `forecast-ingest.yml` and `precompute.yml`.
- `ICON_SCALAR` stays, because ICON's flip is undecided.
- The pin `test_both_ledger_lanes_declare_the_shadow_model_list_equal` now asserts ICON present and EURO absent.
- EURO_SCALAR's scored history (2026-11-02 .. 11-23) stays in the scored files.
- Re-arming EURO is a new decision; that pin changes with it.

**Tests:**
- **Lane diff:** offline, under each workflow's real step env, the graded lanes go from
  `ICON, EURO, CONSENSUS, EURO_SCALAR, ICON_SCALAR` to `ICON, EURO, CONSENSUS, ICON_SCALAR`. Nothing else changes.
- **Retirement harness:** synthetic scored history (6 buoys × 30 days × 3 leads × 8 sources) in three states: the lane on,
  turned off 4 days ago with its old rows still in the window, and gone. Every report block the ledger builds ran in all
  three states: the summary, MOS shadow, attribution, consensus and its shadow, OCF, direction/period and its paired report.
  - **None raised.**
  - **Other lanes unchanged:** every other lane's numbers are identical across the three states. The only changes are two
    counts: MOS `rows_used` (34,560 -> 30,240) and the paired report's `n_kind_inferred` (25,920 -> 21,600).
- **Test suites:** `test_sampler_scalar_marine_height`, `test_forecast_skill`, `test_flag_lane_parity`,
  `test_euro_scalar_shadow_read` and `test_workflow_key_environment` pass, 203 tests, twice. The flake8 gate is clean.

**Advisors** (same public brief, no secrets):
- **SubQ:** TURN OFF. It adds a caution: this buys headroom but does not fix 87.5% occupancy.
- **Reflection:** TURN OFF. It asks for a check that the generic reports cope with the lane absent and its history retained;
  the harness above does that.
- **LongCat:** TURN OFF WITH CONDITION. Treat the pending cap as a separately tracked issue, because one lane's 9% only
  defers an eviction if lanes keep growing.

**The cap condition (all three raised it):** after this change the steady state is about 54k of 68k. A NEW lane must add its
own rows to the cap arithmetic in `forecast_skill.PENDING_MAX_ENTRIES`, as every past lane did. `pending_evicted_cap > 0` in the
report is the early signal.

## Ledger

The ledger lines are in `ledger.d/claude--draft-triage-2026-11-23.jsonl`: an owner_action (the owner's two decisions and
the five closures they authorized) and a doc_write (this log), and an env_change (the EURO shadow lane off, on merge). No served number moves, so it needs no SCOREBOARD row.
