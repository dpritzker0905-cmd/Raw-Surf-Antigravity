# HANDOFF 2026-08-09 — Phases 0–2 + coverage shipped; the stability ledger and the path from here

**Session span:** `1e37b003..5ee77bcd` — 14 commits, all on `dev`, all deployed (production serves
`5ee77bcd`, verified live at write time). PR #8 carries the promotion to `main`.
**Method throughout:** forensics before design, before/after measurement on the same harness,
bit-identity by differential, mutation-killed guards (46/46 across seven matrices), kill switch on
every behavior change, memory corrected wherever it was wrong.

---

## §1 WHAT SHIPPED, with its verification state (all re-executed at handoff time)

| commit | what | proof at handoff |
|---|---|---|
| `9622c56d` | MASTER-AUDIT-11.0 (34 agents, adversarially verified) | the queue this session executed |
| `5e181f69` | **Skill-ledger eviction fix** — keep-earliest + cap 30k + instrument | 3/3 mutations killed; ⏳ first post-fix ingest still in flight at handoff (02:30Z run); pre-fix runs show the outage signature (`ledgered=708 scored=0`, old log format) |
| `ce9250a2` | **Accuracy monitor** — first workflow that can go RED on a wrong forecast | 5/5 killed; first prod run green, both archives read; ⚠️ its cron had not yet fired on its own (best-effort delivery) |
| `5bfea18b` | **Non-saturated height anchor** — Kr/H110 individually visible | Kr-drift mutation killed; the pair-cancellation margin (−1.2%) pinned |
| `071ce572` | **Persistence baseline** in the ledger | rides merge/score/summary unchanged; headroom recounted in-commit |
| `7dea8ff7` | **Serving trio**: manifest lane index · numpy wind sampler · branch-aware copies | 0/18 lane diffs · 0/2,587 sampler mismatches · containment pinned in 3 branches; 11/11 killed |
| `add8e78f` | **`/conditions/batch` bounded+parallel** · observation gate off-loop | one IN-query, cap 200 disclosed, shared semaphore; 4/4 killed |
| `247d2524` | **Runtime telemetry** on `/api/health` | **live in prod at handoff**: 252 req / 0 err / 31 route templates, no cardinality leak, riding every deploy |
| `3eeda053` | **Resolution tie-break** in point product selection | one `_selection_key`, drift-pin, kill switch; 3/3 killed |
| `ae0c03d5` | Hotfix: knots digits out of the sampler docstring | the guard that caught it re-verified killed |
| `5bb49478` | **0.25° expansion**: +4 regions (241 spots off global forcing), `per_cycle` 2→3 | cadence invariant holds (32 h); ⏳ stale-first onboarding of the new regions pending the next pilots fire |
| `4d82a13c` | **Land-present bit** — 14 atoll spots stop serving offshore Hs; 2 refuse honestly | served census **16 → 2**; healed Jacobian 4.33 (was the 3.28084 identity); 6/6 killed |
| `0eac7f32` | **Vercel silenced** (owner: never set up; Netlify is the host) | **0 deployments** created for it and for `5ee77bcd`, vs a failed pair on every prior push |
| `5ee77bcd` | `SURF_COASTAL_FROM_LAND_BIT` registered in `_RATING_FLAGS` | the lane-parity guard that went red on it is green locally; CI in flight at handoff |

**Board at handoff:** everything green except (a) `5ee77bcd`'s CI still running, (b) the census —
which is the *standing* calibration finding below, red since 08-08T09:19Z across pre-session SHAs.

## §2 WHAT THE SESSION'S OWN GUARDS AND AUDITS CAUGHT — the defect ledger, kept on purpose

Every failure below was caught by an instrument (guard, differential, census, or self-audit) —
none by a user. That is the stability story working.

1. **The manifest-index near-miss** — an identity-keyed cache on the manifest object would have
   gone stale-forever (writers reassign `manifest.products` in place at 11 sites). Caught by
   grepping for mutators pre-ship. → key on the **products list id + length**.
2. **The bench harness lied twice about one constant** — hardcoded `KT_TO_MS` (100% false
   mismatch), then its digits in a docstring (CI red: **docstrings are scan-visible, comments are
   not**). → the constant is reference-only, never written.
3. **Two false-green CI watch mechanisms in one day** — `--limit 1` raced run registration; then
   `| tail -1` swallowed `gh run watch`'s exit code. → **watch by head SHA, unpiped, then read
   `.conclusion` from the API.**
4. **An undeclared science switch** — `SURF_COASTAL_FROM_LAND_BIT` shipped invisible to the admin
   panel; the flag-lane-parity guard went red. → **register the flag in the same commit**, and the
   composition lane is the blast radius for any science-flag change.
5. **The greedy-census tuple bug** — a comprehension rebuilt tuples so id()-removal removed
   nothing (12 identical proposals). → keep original objects when removing by identity.
6. **cp1252 ate three outputs**, including the build script's own refusal reason. → ASCII in every
   printed string; the build's refusal print is fixed in-tree.

## §3 OPEN CLOCKS AND STANDING ITEMS (nothing here is silently pending — each has a pager or an owner)

| item | state | who/when |
|---|---|---|
| Ledger recovery (`scored>0`) | first post-fix ingest in flight at handoff; expected within ~24–30 h of 08-09T00:26Z | **self-paging**: the monitor goes RED after 08-12T06:00Z if not |
| Monitor's own cron | not yet fired on schedule (manual dispatch was green) | if no scheduled run by 08-10: external probe (the data-health header's own prescription) |
| Skill-MAE gate | deliberately not armed — only pre-outage baseline exists | arm ~**08-22** with two clean post-fix weeks |
| Census red (Pipeline 1.49 vs ≥1.5, **1 cm**) | standing calibration finding, pre-session, ordering NOT inverted (FL 0.70/0.86 < Pipeline 1.49 < Mavericks 1.72) | **owner call**: wait for ERA5 campaign, or re-derive all bounds at the operating percentile (never a nudge; memory: do-not-widen) |
| New-region onboarding | stale-first will pick all 4 within ~2 pilot fires (never-ingested sorts first) | verify the `stale-first picked` log line next pilots run |
| Per-region MAE as tiles land | the accuracy monitor + residual archive watch it | observe; no action unless red |
| Vercel App uninstall | silenced from repo; integration still installed | **owner one-click** (GitHub → Settings → Applications) |
| `BRAIN_RULES.md` committed API key | flagged, untouched | **owner: rotate + move to env** |
| Netlify prod freeze (`3bd38a83`, 05-20) | unchanged this session | **owner: one dashboard screen** |
| Quarters/Yin Yang mis-geocode | refusal pinned as control; task chip spawned | data task (task_5162f66a) |
| §28 sim mandate | **not advanced this session** — owed | next session opens INDEX-weather-sim.md first |

## §4 THE BEST PATH TO LONG-TERM STABILITY — Jacobian-ranked (∂stability/∂effort, measured terms only)

Stability here = the platform's ability to **detect, localize, and revert its own regressions
before a user does.** This session built most of the detection layer; the ranking below is what
buys the most of what remains, per unit effort.

1. **Let the new instruments run, and close only their gaps** (near-zero effort, highest yield):
   the ledger + persistence + monitor + telemetry + anchors now form a loop that pages on accuracy
   death, calibration drift, eviction, retention stalls, and constant drift. The ONE unreliable
   link is **GitHub cron delivery (measured 5.4–32% of nominal)** — an external uptime probe on
   `/api/health` and on the monitor's endpoint is the cheapest single stability purchase left.
2. **Arm the skill-MAE gate on 08-22** — it converts the monitor from liveness+MAE to true
   lead-time skill regression detection, on a clean baseline. ~20 lines, already scoped in-file.
3. **Resolve the census bound honestly** (owner decision above) — a permanently red scheduled
   workflow teaches everyone to ignore red, which un-buys item 1.
4. **The JS mirror refusal port** — zero reach today, **63.5 points** the day `SURF_PARTITIONS`
   flips; it is the one known landmine armed to fire on a flag. Port + golden-grid extension
   before anyone touches that flag.
5. **Shadow execution for the science chain** — the audit's remaining zero-mechanism item.
   `rate_one_spot` is pure over (geometry, sea state); the precompute already rates every spot
   3×. A shadow lane diffing candidate-vs-live constants per cycle turns every future calibration
   change from a flag-flip gamble into a measured A/B. This is the largest *structural* stability
   gain still unbuilt.
6. **Owner one-clicks** (Vercel uninstall · key rotation · Netlify unfreeze) — minutes each,
   each closes a standing exposure no code can reach.
7. ⛔ **Explicitly NOT the path** (priced and rejected, three audits + this session's live data):
   JAX/GPU/neural emulation, Zarr, nested grids/AMR/SWAN/GCN, γ-thread work (0.145% reach), finer
   bathymetry (0.72% vs the shore normal's 16.83%), shore-normal work alone (the aim angle halves
   it), and the learned nearshore transform (labels accrue at 0.00/day).

**One sentence for the next session:** open `INDEX-weather-sim.md` first (the owed mandate), check
the three clocks (ledger, monitor cron, new-region onboarding), and trust the guards — every
defect this session was caught by an instrument, and the instruments are now watching each other.
