# 2026-11-17 Fable: the sampler-path grouping, read against its registered rule. REFUTED, COMPARISON SUSPECT

Session: Fable repair lead (`e372475c`). Branch `fable/shadow-interp-read`. Docs and one ledger line. No code, no
served number, no dispatch by me. Fulfils the commitment in `ledger.d/fable--blend-fallback-design.jsonl:1` (due
2026-11-18).

## 2026-11-17 19:36Z The read

**Run.** `scored-rows-gate.yml`, run 44155289880, on `dev` at `5850efa03`, 2026-11-17 19:08Z. Dispatched by the
senior research lead on the owner's word typed in ITS session ("Yes, dispatch it", 14:06 EST), ledgered by it. I did
not dispatch it and did not see the words typed. Aggregates only; I read the job's public log, and no row.

**Rule.** `log/2026-11-14-fable-shadow-interp-grouping.md`, fixed on 2026-11-14 before any row with this grouping
was read. Table "Built CONSENSUS shadow vs the computed equal mean", grouping `interp x members`, +48 and +72 h,
cells with n >= 100. This is the first read. The research lead read the same table independently and reached the
same word.

**The cells** (shadow MAE minus equal-mean MAE, metres):

| lead | sampler path | members | n | shadow MAE | equal MAE | difference |
|---|---|---|---|---|---|---|
| +48 h | bilinear (plain) | mixed | 456 | 0.435 | 0.371 | +0.064 |
| +72 h | bilinear (plain) | mixed | 260 | 0.456 | 0.378 | +0.078 |
| +48 h | bilinear (plain) | stored | 1,131 | 0.391 | 0.421 | -0.030 |
| +72 h | bilinear (plain) | stored | 642 | 0.426 | 0.453 | -0.027 |
| +48 h | nearest_ocean_coarse_masked (fallback) | mixed | 13 | 3.138 | 0.874 | +2.264 (n under 100) |
| +72 h | nearest_ocean_coarse_masked (fallback) | mixed | 12 | 2.964 | 1.013 | +1.951 (n under 100) |
| +48 h | not recorded | mixed | 14,394 | 0.380 | 0.247 | +0.133 (no path: outside the rule) |
| +72 h | not recorded | mixed | 13,342 | 0.391 | 0.256 | +0.135 (no path: outside the rule) |

**Clause by clause.**
- UNTESTABLE: no. A `mixed` cell with a recorded path reaches n = 100 at both leads.
- FALLBACK IS THE CAUSE: no. Clause (a) needs at least 80% of the `mixed` pairs with a recorded path to sit on
  fallback paths. They are 13 of 469 (2.8%) at +48 h and 12 of 272 (4.4%) at +72 h.
- REFUTED: yes, by the rule's words. A `mixed` cell on a plain path with n >= 100 reads +0.050 m or more at both leads.
- Control: FAILED. `members=stored` on a plain path must read within 0.020 m of zero; it reads -0.030 and -0.027.
  The rule's word for that is "the comparison is suspect".

**Verdict, exactly as the rule gives it: REFUTED, COMPARISON SUSPECT (control out of band at both leads).** The rule
did not say which of the two takes precedence. I do not choose now: voiding the read would change the rule after the
result, and dropping the caveat would be the same fault the other way (the advisor's ruling, which I asked for).

## 2026-11-17 19:36Z What survives the failed control, and what does not

1. **Survives: the fallback path is not the cause of the bulk.** This rests on a COUNT (13 of 469, 12 of 272), not
   on any MAE difference, so the control cannot touch it. My hypothesis, the reason this grouping was built, fails
   on counts alone. There is no fallback fix to build.
2. **Suspect: the sizes +0.064 and +0.078.** Nothing may be decided on them until the control is explained. I had
   written that against the stored baseline the mixed cells are "worse by about 0.09 to 0.10 m". That is withdrawn:
   the -0.03 offset is of unknown origin, and the stored and mixed cells are different station-hours (equal MAE
   0.421 against 0.371), so there is no ground for assuming they share it.
3. **NOT tested by this rule: "the defect tracks a missing member".** Mixed and stored cells differ in place and
   time as well as in membership. Read after the fact, that is a confounded comparison. The data are CONSISTENT WITH
   it, and it is a reasonable hypothesis for Brief 1; it needs its own rule, written before its read, on the same
   station-hours with a member present against the same member withheld.
4. **Representative of a few days only.** 94% of the shadow's rows predate #857 and carry no path (26,208 of 27,808
   at +48 h). They read +0.133 on an equal MAE of 0.247; the recorded 6% read on an equal MAE of 0.37 to 0.42. The
   recorded rows are a different regime. The verdict is about those days.

**From the same job, descriptive, no rule of mine behind it** (grouping `member tiers`, signed mean of shadow minus
equal; "unknown" means the scored lane row carries no stored tier):

| lead | EURO / ICON lane tier | n | shadow - equal | shadow bias | equal bias |
|---|---|---|---|---|---|
| +48 h | global_mid / global_mid | 12,945 | -0.044 | +0.003 | +0.047 |
| +48 h | unknown / global_mid | 10,138 | +0.138 | +0.247 | +0.109 |
| +48 h | unknown / unknown | 4,627 | +0.336 | +0.323 | -0.014 |
| +72 h | global_mid / global_mid | 12,305 | -0.044 | -0.007 | +0.037 |
| +72 h | unknown / global_mid | 9,176 | +0.138 | +0.242 | +0.104 |
| +72 h | unknown / unknown | 4,343 | +0.333 | +0.318 | -0.015 |
| +24 h | unknown / unknown | 1,039 | +0.648 | +0.647 | -0.001 |

Where a member lane has no stored tier, the built shadow reads high against the buoys while the computed equal mean
does not. This covers all rows, not only the 6% with a path. It is the research lead's observation; the same caution
as point 3 applies.

## 2026-11-17 19:36Z The control: why the built blend need not equal the computed equal mean (code reading, nothing measured)

With every member stored the two differ by about 0.03 to 0.04 m. Read in `consensus_product.py` and
`consensus_ingest.py` on `dev`, the two are different objects in four ways:

1. **Where the mean is taken.** The built product takes the mean at each GFS grid NODE (each member sampled at the
   node), and the buoy's value is then interpolated from those nodes. The computed equal mean takes each lane's own
   value AT THE BUOY and averages them. Interpolating a mean of members sampled at another grid's nodes is not the
   mean of each member's own interpolation.
2. **Which member product answers.** At each node the builder asks a chooser for "the product the point resolver
   would answer that cell from", which may be another tier, or a frame up to the resolver's time tolerance from the
   GFS hour (the build counts these as `member_frame_offset_cells`). The lane's scored row is that lane's own answer
   at the buoy.
3. **Masking.** The shadow is built with `unblended="mask"`: a node a member could not answer is marked INVALID, so
   the shadow never serves a GFS-only value under the consensus name. A buoy near masked nodes is then answered from
   the nodes that are left, which is another place.
4. **Live fallback.** The module header says a CONSENSUS point "reads a stored product or answers unavailable", while
   the GFS, EURO and ICON lanes may answer from a live upstream. A lane row with no stored tier is presumably such an
   answer, so on those rows the member inside the blend and the member in the computed mean come from different
   sources.

- Not found: unequal weights, a different quantity (the mean is of heights, `sum(vals) / len(vals)`), or a clip.
  Heights are rounded to 4 decimals.
- Items 3 and 4 would also produce "the shadow reads high where a member has no stored tier": the blend masks those
  nodes and the buoy is answered from further away. That is a HYPOTHESIS from reading code. Each stored product
  carries the counts that would test it without any buoy (`member_missing`, `masked`, `member_sources`,
  `member_frame_offset_cells` in its diagnostics). Not read.

## 2026-11-17 19:36Z For future reads only: what a failed control does to a verdict

Written after this result, so it does not apply to it. From now on, in a rule of mine: a failed control keeps the
verdict's name, adds SUSPECT, and nothing is decided on the magnitudes until the control is explained.

## Not done

- Why the stored-member control reads -0.03 m: candidates listed above, none measured.
- The one fallback location (about a dozen pairs per lead, shadow MAE near 3 m). Shadow only, so nothing served. The
  question to ask of it (the advisor's): do the SERVED lanes take `nearest_ocean_coarse_masked` at that same place,
  and what do they read there? If one does, that is a served-number question for the director.
- Brief 1 (the blend's missing-member behaviour) and its own pre-registered rule.
- The second owed dispatch, `accuracy-per-buoy-split.yml`.
