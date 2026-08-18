# EXECUTIVE TRAJECTORY VERDICT — Audit 13.1

**Raw Surf weather simulation · 2026-08-18 · `791fdf78..568fc2c6` (128 commits)**

---

# ⚖️ ACTIVITY WITHOUT SUFFICIENT CLOSURE

**…with two individually REGRESSING findings that must be corrected before any further feature
work. If either is still open at the next audit, the verdict becomes REGRESSING OR OFF PATH.**

---

## The verdict in nine numbers

| | |
|---|---|
| Commits since the last verified baseline | **128** — of which **6 are the same work counted twice** (`git patch-id --stable`) |
| Commits that ship anything to the running app | **30 (23%)** |
| Commits that are evidence, docs, self-correction or churn | **89 (70%)** |
| Commits containing a revert or retraction | **52 (41%)** |
| Objectives/tasks certified closed, of 40 + 71 | **6** |
| Architecture authority counts that converged, of 10 | **0** *(3 diverged, 7 flat)* |
| Authorised Finish-Line-A positions receiving **zero** commits, of 10 | **4** |
| Commits in a lane that appears in no authorising document and no register | **61 (48%)** |
| Days the production frontend is behind HEAD | **90** — unchanged since Audit 12.1 |

---

## Why not a better verdict

**Not "Verified Forward Progress":** objectives are not closing (6 small tasks), the critical
path is longer, architecture converged on nothing, and scientific integrity regressed.

**Not "Forward Progress With Corrections":** the central *direction* was not being followed.
Four of ten authorised path positions received no work at all while nearly half the window ran
in an unnumbered lane, and the two gates that regressed — Gate 0 (Program & Baseline Truth) and
Gate 1 (Data & Scientific Correctness) — are the prerequisites for every other gate.

## Why not a worse verdict

**Not "Regressing or Off Path":** architecture is **flat, not diverging** — eight of ten
authority counts are byte-identical to baseline. The ONE FORECAST COMPOSITION chain is
byte-identical at the computation level. Nothing multiplies under a race journey or three
remount cycles. Zero uncaught page errors across 1,558 requests. And a real, owner-visible
defect was genuinely root-caused and fixed.

**Not "Stalled":** the halo repair, the ~22× batch-latency repair, and a measurable rise in test
density are all real.

---

## The two findings that force the qualifier

### ⛔ CRITICAL — `swell_height_ft` publishes two different physical quantities, default ON

`backend/routes/surf_data/conditions.py:75` publishes `offshore_hs_m` — which originates at
`spot_ratings.py:136` as `getattr(marine.point, "speed", None)` under a `layer="waves"` resolve
— under the field name that the live lane fills from the **primary swell partition**
(`spot_conditions.py:251-257`). VHM0 ≠ VHM0_SW1.

`CLAUDE.md` states in bold: *"NEVER report marine `point.speed` as the surf height — that is the
OFFSHORE significant wave height."*

**It escaped every guard because the value never passes through `estimate_surf_at`, and that is
where all the guards live.** The mandate constrains a function; it does not constrain a route.
That is a structural gap, not merely a bug.

✅ **FALSIFIED AGAINST PRODUCTION 2026-08-18 — and it CONFIRMED.** 20 spots, 5 regions, all served
by the frame lane: **11 of 11 discriminating spots track VHM0, 0 track VHM0_SW1**; overstatement
**min +25%, median +84.2%, max +300%**, every one positive. **Rockpiles and Backdoor, Oahu publish
`4.0 ft` where the primary swell partition is `1.0 ft`.** Field identity confirmed from the wire:
**20 of 20** spots satisfy `published == round(frame.offshore_hs_m × 3.28084, 1)`. **No production
configuration was changed** — the run identifies *which variable the published number equals*
rather than flipping a lane off.

### ⛔ HIGH — a third EURO marine ingestion authority shipped default ON, labelled inert

`fb50fa6d` ships a 20-region 0.083° Copernicus island lane, default ON
(`forecast.py:174-175`). Its own docstring claims *"inert by construction until a serving tier
reads region_id `island_*`"*. The selector **never consults `region_id`**
(`point_resolution.py:340`, `manifest_view.py:39-51`) and ranks by
`(time_diff, resolution, bbox_area)` with **resolution as an active tie-break**. A 0.0833°
product therefore outranks every 0.25/2.0/10.0° EURO candidate covering the same point.

**The data reaching the forecast chain changes on the first successful ingest cycle. It shipped
labelled a no-op, so nobody is watching for it** — and EURO is now three upstreams under one
label, against a repo landmine that already records it as two.

---

## The single most consequential measurement

**The served marine grid is `~223 km (2°)` at every zoom from 5 to 12** — measured on the
deployed build, with the HUD disabled per the repo's own probe contract, at Cocoa Beach and
Madeira alike. At z12 one grid cell covers roughly forty times the entire visible viewport.

**48% of the audited window was spent investigating rendering artefacts downstream of that
cell.** The halo work was excellent and it fixed something real — but chasing a halo across a
223 km interpolated cell has a floor that no shader change can lift.

---

## What is genuinely excellent and must be preserved

1. **The forensic method.** Fifty-two voluntary self-retractions. `f7714cf2` reverted three
   commits and ~14 hours of its own work after an A/B measured the change made things worse.
   `9f89e891` **withdrew a regression accusation against another session** after running the
   A/B. `0f314702` describes itself as "the sixth mis-identification of the same thing." Very
   few programs count their own repeat errors.
2. **The halo repair itself** — nine hypotheses refuted before the real cause, then verified on
   the deployed bundle with a positive control.
3. **Test craft** — `a1b5aac3` found that the existing guard covered a manual endpoint while the
   **live 15-minute scheduled job** was unguarded, replaced the file list with a census, and
   added a suite that drives the real task. Eight days of green-on-nothing, closed.
4. **Concurrency and ownership.** Under an unthrottled race journey: workers 18→18, GL contexts
   1→1, canvases 4→4, no stale label surviving. Model switching and timeline scrubbing move
   **zero** long-lived GPU resources against a **zero-spread** noise floor.

---

## The uncomfortable pair

**One.** The only commit in 128 with a complete red → green → red-on-mutation artifact trail is
`d8c866bd` — **the first commit of the program.** The standard was set on day one and not
matched since.

**Two.** While this audit was measuring the tree, **a concurrent session committed and pushed to
`dev`**, which deploys the production backend. The commit it pushed contained the two files this
audit had recorded as its dirty baseline. **A program cannot certify a baseline it does not
control**, and fixing that costs less than any finding in this report.

---

## Next mission

**13.1-C1 — "One field, one meaning; one lane, one watcher."**
A repair-and-verification mission. Three tests written and watched failing first; four files;
**no renderer work, no shader work, no halo work.** Full contract in
`NEXT_AUTHORIZED_MISSION.md`.

---

*Production source code was not modified by this audit. No audit experiment was committed,
merged, or pushed. No prior audit or living program-control file was rewritten.*
