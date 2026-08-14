# DO NOT CREATE DUPLICATE WORK — Audit 12.2

**This file is mandatory and it is the point of the audit.** A coverage audit that only produces
gaps has failed at half its job. Every entry below is a concern that *looks* like a hole, that this
audit actively investigated, and that must **not** become a new objective or task.

Two kinds of entry:

- **§A — measured NOT a gap.** This audit ran the measurement and the system passed. Some of these
  overturn a claim in an earlier audit or in my own working notes.
- **§B — already covered.** The concern is real but an existing WS-OBJ/WS-CAN owns it. Naming it
  again would inflate the backlog and split ownership.

---

## §A — Investigated and measured NOT a gap

### A1. Cross-browser and mobile E2E coverage exists and runs on every push

**Apparent concern:** "Nothing tests Firefox or Safari; the whole estate is Chromium-only."

**Measured refutation.** `frontend/playwright.config.js:47-64` declares four projects —
`Mobile Safari` (iPhone 13), `Desktop Chrome`, `Desktop Firefox`, `Desktop Safari`.
`.github/workflows/e2e-tests.yml:116` runs `npx playwright install --with-deps`; `:173` runs
`npx playwright test` with **no `--project` filter**. The last run's log confirms all four executed:

```
13 [Desktop Chrome]   13 [Desktop Firefox]   13 [Mobile Safari]   28 [Desktop Safari]
```

**Do not open a browser-coverage task.** The *residue* — that every observed flake is WebKit — is a
different finding with a different fix, recorded separately (LV12-2-05) and dispositioned as
"reopen WS-OBJ-705 as PARTIAL", not as new coverage work.

### A2. The 12 weather layer buttons are accessible, and the mobile "0 px touch target" is my own artifact

**Apparent concern:** my own first mobile probe returned `minTouchTargetPx: 0` and
`layerButtonsWithAriaLabel: 0`, which reads as a mandate violation.

**Decisive control run.** Computed styles + ancestor walk on the mobile viewport (390×844, DPR 2,
`hasTouch`, `isMobile`):

```json
{"label":"Wind","w":0,"h":0,"hider":"display:none@absolute top-24 right-2 z-[1000] backdrop-blur-xl",
 "ariaHidden":false,"tabIndex":0}          … identical for all 12
"focusable": 0
```

All 12 zero-size buttons sit inside an ancestor with **`display: none`** — the desktop panel, which
the mobile layout correctly hides. `display:none` removes an element from the accessibility tree
*and* from the tab order, which `focusable: 0` confirms independently. The zero rect was me
measuring hidden desktop-layout controls, not a touch-target defect.

What the same probe *positively* establishes, in both desktop and mobile layouts:

| check | result |
|---|---|
| all 12 layer controls are real `<button>` elements | ✅ |
| all 12 carry `aria-pressed` | ✅ **12 of 12** |
| information conveyed by more than colour (visible text label on each) | ✅ |
| `aria-label` absent on the 12 | ✅ **correct** — they have visible text; `aria-label` would be redundant |

**Do not open a task for the weather layer controls.** They are better than the program's own
2026-07-14 debt inventory implies. (One icon-only button with no accessible name does exist — that
is pre-existing, known, counted debt under the standing accessibility mandate, not a 12.2 discovery.)

### A3. Every one of the 12 layers paints, on two configurations, on both models

**Apparent concern:** after WS-CAN-0060 (missing colour-scale key) and WS-CAN-0061 (ocean-mask layer
order), a reasonable worry is that other layers are silently blank.

**Measured.** Differential pixel oracle (screenshot layer-off vs layer-on, `pngPixels.diffFraction`),
GFS **and** EURO, chromium desktop **and** chromium mobile — **48 layer/model/config cells, 48
paint.** Lowest signal is Fog (4.1% desktop / 20.3% mobile), consistent with a sparse phenomenon
rather than a blank field; highest is Satellite/Air Temp at ~76–82%.

**Do not open a "check the other layers" task.** WS-OBJ-101's class guard (WS-CAN-0060) is doing its
job and now has an independent empirical confirmation.

⚠️ **What this does NOT establish**, stated so it is not over-read: that the painted values are
*correct*. A wrong-but-colourful field passes this oracle. Value correctness is WS-CAN-0028, which
is still not run.

### A4. Projection reaches every probed geography, including the antimeridian and 68°N

**Measured**, 8 locations × 2 configs, settled frames, `styleLoaded: true`, 143 style layers /
24 sources at every stop:

| location | desktop variance | mobile variance |
|---|---|---|
| Cocoa Beach FL | 95.8% | 98.9% |
| New York coast | 95.6% | 96.6% |
| Portugal | 92.7% | 92.0% |
| Morocco | 96.2% | 89.4% |
| El Salvador | 92.4% | 94.0% |
| Open Pacific | 98.1% | 98.2% |
| **Antimeridian (179.6, −17.6)** | **94.8%** | **97.7%** |
| **High latitude N (−20, 68)** | **95.0%** | **98.9%** |

This is consistent with SOTA **A6 ✅ MET** and adds a *rendered* confirmation to what was previously
certified by arithmetic and API probes. **Do not open a projection task.**

### A5. The ONE FORECAST COMPOSITION chain has no route-level bypass

`git grep -ln "resolve_surf_geometry\|estimate_surf_at\|compute_surf_rating" -- 'backend/**/*.py'`
returns **63 files**, and a targeted search for the classic bypass — a route reading marine
`point.speed` or a raw significant wave height as a surf height — returns **nothing** under
`backend/routes/`. The mandate's own reference implementation (`spot_ratings.rate_one_spot`) and the
sim (`sim_rating.py`) both delegate. **Do not re-open the composition question.** It is
`WS-OBJ-201`, CERTIFIED COMPLETE, and it survived an independent check.

---

## §B — Real, but an existing objective or task already owns it

| Apparent concern | Owned by | Why no new ID |
|---|---|---|
| `/api/conditions/batch` is catastrophically slow (live: n=11, **11 of 11 over 10 s**, max 36.0 s this window) | **WS-CAN-0064** / WS-OBJ-302 | Named, evidenced across three consecutive audits. 12.2 adds a third reading, not a new task. |
| `/conditions/*` returns 200 with an error body | **WS-CAN-0009** | Nine sites already enumerated with line numbers. |
| The executed-GL pixel oracle cannot fail | **WS-CAN-0018 / 0019** | Still `test.fixme` at `weather-simulation.spec.js:607` at HEAD. Unchanged, already owned. |
| `run_time` carries the ingest wall clock, not the model cycle | **WS-CAN-0005** / WS-OBJ-202 | The *wire* half is owned. (The **display** half is a genuinely new finding — see the missing-objective register — and is scoped as an expansion of 202, not a new objective.) |
| Production frontend is 85 days stale | **WS-CAN-0039** / WS-OBJ-104 | Owner decision. Every frontend finding in this audit inherits its reach limit from this row, which is why the audit states it once here rather than as a caveat on each. |
| Committed credential in `BRAIN_RULES.md` | **WS-CAN-0021** / WS-OBJ-703 | Confirmed still present at HEAD by pattern (value deliberately not reproduced). Owner action; history retains it regardless. |
| 5 stale worktrees, one of them **inside the primary tree** at `.claude/worktrees/gracious-cannon-e4aed4` | **WS-CAN-0055** / WS-OBJ-704 | Already open. 12.2 adds one operative detail rather than a task: the in-tree one **poisons `grep -rn` from the repo root** with another branch's content, so it is a measurement hazard, not only hygiene. Fold into the existing row. |
| The geometry-readiness signal is on the wire but `confidence` ignores it | **WS-CAN-0062** / WS-OBJ-207 | Unchanged at HEAD. |
| No exit condition on the commit arbiter / settle debounce / ICON blend | **WS-OBJ-402** / WS-CAN-0007, 0032, 0043 | Owned for those three. The **261-global override surface** is a different class and is registered separately — see LV12-2-03. |
| Nothing measures whether the uptime probe is delivered | **WS-CAN-0025** / WS-OBJ-505 | Built, proven live, owner-gated on one heartbeat URL. |
| Frame rate is unmeasurable | **WS-CAN-0037** | ⚠️ **Its premise is now partly false** (`window.__MAP_RENDER_FPS__` is written every second by the running app; `marine-nightly` analysed 387 animation frames in CI). The task should be **rescoped**, not duplicated and not closed. |
| Rain unit label, wind legend, ft/m threading, cross-fall sampling | **WS-CAN-0015** / WS-OBJ-204 | "2 of 7 shipped" — the remaining five are enumerated. New legend findings in this audit attach here as expansions. |

---

## The rule this file enforces

12.1's governance rule 12 says a finding gets an ID **when it is diagnosed**. The corollary, which
this audit adds: **a finding gets a *search* before it gets an ID.** Of the candidate gaps raised
during 12.2, roughly a third died to one of four checks — the proof did not reproduce at HEAD, an
existing row covered it under different words, it was a symptom of a tracked task, or it had already
shipped in the last seven commits. Those deaths are recorded here and in
`NEGATIVE_SPACE_FINDINGS.md`, because an audit that hides its refuted claims is not auditable.
