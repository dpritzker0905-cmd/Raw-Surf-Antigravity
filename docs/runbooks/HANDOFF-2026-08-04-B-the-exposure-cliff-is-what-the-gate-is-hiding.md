# HANDOFF — 2026-08-04-B · THE EXPOSURE CLIFF IS WHAT THE GATE IS HIDING

**Every number here is measured today against live production. Three of this morning's own
standing claims died, including the headline of the handoff written a few hours earlier.**

---

## §0 THE THREE THINGS THAT CHANGED

1. ⛔ **The product CAN say "good", and does.** `HANDOFF-2026-08-04`'s headline
   (*"P(display >= good) = 0 exactly"*) is refuted. Corrected in place.
2. ⭐⭐⭐ **The observation gate is a SYMPTOM. The root is the `swell_exposure` cliff**, which
   manufactures the extreme cross-model disagreement that the gate then withholds.
3. ⛔⛔ **The ERA5 campaign — the critical path for the real fix — was DEAD for 8 h 20 min**, and its
   documented ETA was wrong by 4.5x. Restarted; the durable fix is blocked on one permission.

---

## §1 THE HEADLINE OF THE PREVIOUS HANDOFF IS REFUTED

`scripts/served_good_spotcheck.py`, 2026-08-04T13-15Z, read directly off the served objects:

| spot | served score | level | `confirmed` |
|---|---|---|---|
| Rock Island | **71.0** | **good** | `good` |
| Cloud 9 - Inside | **72.0** | **good** | `good` |

So `P(display >= good)` is **~0.2 % (2 of 979)**, not 0.

★ **What survives is the CONDITIONAL claim** — while `confirmed is None`, `min(raw, 69.9) < 70.0`,
so that spot cannot read good. That is sound arithmetic. **What was wrong was generalising ONE frame
(01:00Z, n=600, which genuinely had zero) into an arithmetic impossibility.** Rule 22, in a document
written the same day. Rarity has a distribution; impossibility does not — and the difference decides
whether the gate is a policy question or a bug.

⚠️ Note for anyone re-measuring: `internal_confirmation` is frame-dependent, so a probe that hard-codes
"the baseline is 0" will VOID spuriously. `confirmation_statistic_probe.py` was rewritten mid-session
for exactly this reason: **its control now compares against production's OWN served `confirmed`
field rather than against a remembered constant.** A control built on a number someone wrote down is
a control that expires.

---

## §2 ⭐⭐⭐ THE ROOT: A HARD SWITCH ON AN UNCERTAIN INPUT

### The observation that started it
`scripts/model_divergence_attribution.py` on Majestics (13.78N, 124.25E), all three lanes, same hour:

| lane | height | period | limiter | limiter_f | raw |
|---|---|---|---|---|---|
| GFS | 1.708 m | 13.0 s | `wind_period_blend` | 0.916 | **90.2** |
| ICON | 1.613 m | 9.4 s | `wind_period_blend` | 0.793 | **72.4** |
| EURO | 0.743 m | 9.7 s | **`swell_exposure`** | **0.100** | **5.6** |

⭐ **The heights differ ~2x. The scores differ ~13x.** EURO carries real data (0.743 m, 9.7 s, 7 kt
offshore) — so this is **NOT** the coverage class, which was the rival hypothesis the probe was built
to separate. The gap is `swell_exposure` sitting on its floor in one lane and at ~0.8 in the others:
an **8x multiplier**, landing undamped because `score = 100 * PROD(nine factors)`.

### Why that is a Jacobian defect, not a calibration one
    swell_exposure = 0.10 + 0.90 * max(0, cos(dtheta))
is continuous in VALUE but **discontinuous in SENSITIVITY at dtheta = 90 deg**: just inside, it
grades; just outside, it is pinned at 0.10 for the whole remaining half-plane. So a directional
disagreement of a few degrees near the boundary produces an 8x score swing.

### The census, with a control that could have killed it
`scripts/exposure_flip_census.py`, n = **979** spots carrying all three lanes, 13:00/15:00Z:

| class | spots | p50 spread | p90 | max |
|---|---|---|---|---|
| **FLIP** (floor engaged in some lanes, not others) | 117 (12.0 %) | 9.5 | **40.1** | **85.0** |
| ALL_FLOOR (every lane floored) | 94 (9.6 %) | 1.0 | 2.3 | 5.3 |
| NONE | 768 (78.4 %) | 10.6 | 25.3 | 55.4 |

⛔ **REFUTED — my own hypothesis, at the median.** FLIP does **not** raise typical spread:
median ratio **0.90x**. If I had only looked at the median I would have called the cliff harmless.

⛔ **REFUTED — the borrowed-normal story.** FLIP is **not** concentrated on degraded geometry:
38 % degraded vs NONE's 42 %. The reasoning that a 29-deg borrowed-normal error drives the flip does
not survive its own cross-tab.

✅ **SURVIVES, and it is the finding: the cliff manufactures the EXTREMES.** FLIP's p90 is 1.6x
NONE's, and **every one of the 8 widest-spread spots in the entire population is an exposure flip.**
No non-flip spot exceeds 55.4; flips reach 85.0.

✅ **Internal check the classifier is sound:** ALL_FLOOR spots agree almost perfectly (p50 spread
**1.0**) — exactly what a genuinely-facing-away spot should do.

✅ **It is BIDIRECTIONAL, so it is not a model bias.** Philippines: EURO floored, GFS/ICON not
(Twin Rocks, Majestics, Puraran, Cloud 9). Costa Rica/Panama: GFS/ICON floored, EURO not (Santa
Catalina, Estero, Dominicalito, Playa Dominical). A boundary being straddled from both sides.

⚠️ **UNDERPOWERED, do not quote as fact:** among the 11 spots where the gate is in play (any lane
>= 70), 4 are FLIP — 36.4 % against a 12.0 % base rate. Suggestive of 3x enrichment, but **n = 11**.
Re-measure across frames before believing the direction.

⚠️ The census **UNDER-counts** FLIP by construction: `limiter` is an ARGMIN, so a lane floored on
exposure while some other factor is lower is not labelled. The bias runs against the hypothesis.

### Why this re-ranks the queue
The gate withholds `good`; what it withholds is dominated by extreme spread; that extremity is made
by the cliff. **Fixing the confirmation statistic without fixing the cliff only changes which
unstable number gets displayed.**

⛔ **DO NOT TUNE THE FLOOR.** `scripts/directional_exposure_science.py` already settled this: a real
sea is a spectrum `cos^2s(phi/2)` (s~70 swell, s~10 windsea), and at dtheta=100 deg it delivers
**0.013** against our flat **0.100** — the floor is 7.7x too GENEROUS, not too harsh. Its control
holds (flux -> cos(dtheta) as s -> infinity). The principled replacement is the **empirical per-spot
directional exposure from the ERA5 record** — continuous, so no cliff — which is exactly what the
campaign in §3 is producing.

---

## §3 ⛔⛔ THE CRITICAL PATH WAS DEAD, AND ITS ETA WAS WRONG BY 4.5x

Found at session start: **no ERA5 process alive; log last written 01:09, now 09:29 — 8 h 20 min of
silence** at spot 37/1673. The nightly supervisor had last run 8/3 21:30 and **exited 1** (its guard
correctly saw the then-live manual campaign), so nothing would have run until 21:30 tonight.

### The measured rate, because the docstring is not evidence
37 spots, per-spot elapsed extracted from the log:

| | |
|---|---|
| median | **241 s/spot** — the docstring's *"~1-2 min/spot"* is **3.1x optimistic** |
| mean / min / max | 273 s / 84 s / 1303 s |
| first-10 vs last-10 mean | 113 s -> **426 s** — the rate DEGRADES 3.8x as CDS queues |
| pure-compute projection | **4.6 days** |
| **observed wall-clock** | **20.7 days** (37 spots / 11.1 h = 3.3 spots/h) |

★★ **That 4.5x gap is entirely SUPERVISION, not compute.** The job dies and nothing notices for up
to 20 h, because its only supervisor fires once daily.

### Two distinct death modes, do not conflate them
* **08-03 run:** stopped silently mid-download at 01:09 AM, **no traceback** -> consistent with the
  machine sleeping. (`WakeToRun: False`.)
* **Task-launched runs:** exit code **`0xC000013A` = STATUS_CONTROL_C_EXIT**, with `^C` in the log —
  a console interrupt. Measured: a *short* PowerShell tool call does NOT cause it (control run
  survived); the deaths coincided with *long-running* ones. ⛔ **Trigger not attributed — do not
  claim it is.**

### ⛔ THE FIX IS BLOCKED ON ONE PERMISSION
The mitigation is cause-agnostic: add an hourly trigger beside the nightly one, so dead time after
any death drops from ~20 h to <= 1 h.

    Set-ScheduledTask -TaskName 'RawSurf ERA5 Climatology Campaign' -Trigger @(
      (New-ScheduledTaskTrigger -Daily -At 21:30),
      (New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Hours 1)))

Safe: the task is already `MultipleInstances: IgnoreNew`, so Task Scheduler itself refuses a second
instance, and the script's own (mutation-tested) guard is a second layer. **Blocked by the tool
permission classifier — the owner must run it or grant the permission.** Expected effect on the
critical path: **20.7 d -> ~7 d.**

✅ Restarted this session; running, resume verified (`150 in scope, of 1643 still needing work` —
130 of 1773 banked).
✅ `era5_deepen_climatology.py` now stamps **UTC wall-clock on every progress and checkpoint line**,
ASCII-only (the log is written through `cmd` redirection on a cp1252 console that already mangles
non-ASCII in it). Diagnosing this cost file-mtime archaeology across 37 elapsed values because not
one line carried a clock.
⚠️ **Compile-verified and guard-tests green (16), but the new line format has NOT been observed in a
live run** — the running process holds the old code. Confirm on the next run.

---

## §4 INSTRUMENTS ADDED

| instrument | question | control it carries |
|---|---|---|
| `confirmation_statistic_probe.py` | is the confirmation statistic wrong or merely strict? | compares recomputed rule against **production's own served `confirmed`**; plus a "arms must discriminate" check |
| `served_good_spotcheck.py` | does the product ever actually display `good`? | REFUSES when no spot has raw >= 70, so "flat hour" cannot masquerade as "cap blocks good" |
| `model_divergence_attribution.py` | is a 17x disagreement physics or a data hole? | dumps an **agreeing** spot from the same request as background |
| `exposure_flip_census.py` | does the exposure cliff make the spread? | NONE class as background; VOIDS on an empty FLIP group; states its own under-count bias |

---

## §5 WHAT I GOT WRONG, AND WHAT CAUGHT IT

| claim | caught by |
|---|---|
| "P(display >= good) = 0 exactly" (this morning's headline) | reading the **served object** instead of a derived count |
| "the gate is a pure tax; the statistic is simply wrong" | the discriminator — bitten spots have p50 spread **26.9** vs population 9.5, so the gate has a real job |
| "the cliff raises cross-model spread" | its own control — median ratio **0.90x**. Only the tail moved |
| "FLIP is concentrated on degraded geometry" | the cross-tab — 38 % vs 42 % |
| a `banked + len(results)` progress line | re-reading my own edit; `banked` was already incremented |

★ Zero of these came from a green suite or from review. Every one came from a control, a cross-tab,
or reading the primary artifact.

---

## §6 THE QUEUE FROM HERE

1. ⛔ **Run the scheduled-task command in §3** — one line, 3x on the critical path, blocked on permission.
2. ⭐⭐⭐ **The learned/empirical directional exposure** (continuous, replaces the cliff).
   Accumulation-gated on the campaign. This is now the top engineering item, ahead of the gate.
3. **Re-measure the FLIP-vs-gate enrichment across several frames** — n=11 is not a finding.
4. **The gate** stays an owner decision, but is now **downstream** of item 2. Its statistic really
   does count crossings rather than agreement (Majestics: 90.2 / 72.4 / **5.6** satisfies "2 of 3
   >= 70"), so it will still need fixing — just not first.
5. Unchanged and still owed: buoy depth/exposure stratification (`fetch_ndbc_station_coords`
   returns lat/lng only), which keeps the accuracy programme unfalsifiable.
