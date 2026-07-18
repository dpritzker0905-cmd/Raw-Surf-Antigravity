# DESIGN — the marine COMMIT ARBITER (structural #1)

Status: DESIGN (no code yet). Grounded in the 07-18 probe evidence; the implementation is its own
arc. Read `HANDOFF-2026-07-18-EVE2-*` §1 and the EVE handoff STRUCTURAL REVIEW first.

## 1. Problem — one resident, ~8 writers, guards instead of decisions
`setMarineData` (the marine resident) is written by independent lanes, each carrying its own
retry/cache state, arbitrated only by accumulated pairwise guards (no-downgrade, rating-grace,
flavor-mismatch bypass, commit short-circuit, ping-pong guard, stale stamps, hour verification).
Every multi-lane disagreement ships as a new guard, and every guard is a new place for two lanes
to disagree forever. Probe-proven instances:
- **z6.5 band flap (07-18 pt3)**: scrub-settle verification loop re-committed a boot-era unrated
  coarse over the rated mid every ~2 s — two lanes fighting at 0.5 Hz until the commit-stamp
  invariant (`53b1ec66`) removed the driver.
- **§5b toggle wedge (07-18 EVE-2, `641c2678`)**: the direct lane fetched the WORLD (activation
  misclassification), the series lane supplied only the wrong flavor, and the backstop's re-drive
  was guard-starved — three lanes, none able to supply the needed frame, none aware of the others.
- **07-09 lesson**: "THREE scrub pipelines, fixes don't transfer" — same disease, older symptom.

## 2. Lane inventory (from the 07-18 probes' forensic rings)
| # | Lane | Entry point | Stamps today |
|---|------|-------------|--------------|
| 1 | Direct fetch | `updateMarineGrid` → `commitMarineData` | hourOffset + `__commitLane` (`53b1ec66`) |
| 2 | Series sharpen (clamp) | scrub-settle `detectClamp` → `stampSeriesCommit` | series stamp |
| 3 | Series scrub-settle hit | scrub-settle series-first branch → `stampSeriesCommit` | series stamp |
| 4 | §2b zoom-out recovery | scrub-settle engine-empty branch → `stampSeriesCommit` | series stamp |
| 5 | series_upgrade fastpath | `onSeriesRevalidated` → flavor cache commit | fastpath |
| 6 | Clamp re-drive | `'clamp_resharpen'` → `commitMarineData` | as lane 1 |
| 7 | Flavor backstop | `'flavor_backstop'` → `commitMarineData` | as lane 1 |
| 8 | SWR revalidation | `'swr_revalidation'` → `commitMarineData` | as lane 1 |
| 9 | Abort-recovery grid | `getAbortRecoveryGrid` commit | partial |
| 10 | Layer-clear / stale stamp | `handleRegionalGridClearing`, `setMarineData(null)` | n/a (clears) |
(Engine-side, NOT resident commits, out of scope: prewarm coarse-base stage, bridge captures.)

## 3. Guard inventory (what the arbiter must subsume, with origin)
no-downgrade (dims regression) · rating-grace (07-13 `9294ad7c`) · flavor-mismatch dedup bypass
(07-15) · commit short-circuit (same-product) · ping-pong guard · stale-stamp force-refetch ·
hour verification (scrub-settle §394: hourMismatch/noData only — NOTE 07-18 EVE-2: the boot-time
"rendered hour=undefined" line is the **noData** branch working as designed, NOT an unstamped
commit; do not re-chase) · terminal-nocov bypass · §7.6 churn caps · dedup windows.

## 4. Design
**One decision point.** Every would-be commit becomes a descriptor:
```js
{ lane, productId, tier,            // coarse_global | mid | regional_fine (from resolver contract)
  flavor,                           // rated | plain
  hourOffset, model, layer,
  bounds, dims, coversViewport,     // computed once, honestly
  freshness,                        // fetch timestamp vs resident's
  reason }                          // free text from the lane
```
`arbiterDecide(descriptor, resident, wants)` returns `{ verdict: commit|reject|defer, why }`,
where `wants = { hour, model, layer, flavor, viewport }` is derived from refs ONCE. Priority is a
single ordered rule list (first match wins), roughly:
1. resident empty / stale-stamped → commit anything renderable that covers.
2. wrong layer/model resident → commit matching.
3. flavor match beats mismatch (rating-grace window applies to transitions only).
4. hour match beats mismatch.
5. finer tier beats coarser IF it covers the viewport (no-downgrade generalized).
6. fresher beats staler at equal tier/flavor/hour.
7. otherwise reject with the losing rule named.
Every decision (including rejects) appends to the `__RAW_FORENSIC__` ring as `arbiter` events —
the ping-pong class becomes ONE readable decision log.

## 5. Migration plan (minefield rules: instrument first, kill-switch, A/B)
- **Phase A — descriptor + logging shim (no behavior change).** Wrap every lane's commit call in
  `describeCommit(...)` and log; existing guards still decide. Verify: zero behavioral diff on the
  staircase battery + probe_wedge + probe_flavor_loss reruns (byte-identical verdicts).
- **Phase B — SHADOW MODE.** `arbiterDecide` runs on every descriptor and logs what it WOULD do;
  actual behavior unchanged. Run the full battery + toggle/scrub/pan probes; diff shadow verdicts
  vs actual outcomes; tune the rule list until divergences are only the known-bug classes.
- **Phase C — flip.** `__RAW_MARINE_ARBITER__=1` routes commits through the arbiter; each legacy
  guard becomes a named rule or is deleted. Kill: `__RAW_DISABLE_MARINE_ARBITER__` restores the
  guard chain wholesale (keep both paths one release).
- Contract tests: rule-list unit suite (each rule = fixtures) + ladder-contract stays the
  tier oracle. Nightly battery is the acceptance gate at every phase.

## 6. Non-goals
Not a fetch scheduler (lanes still decide WHEN to fetch — only WHO COMMITS is centralized), no
wind/pressure/radar lanes (separate pipelines), no engine-side texture staging changes.
