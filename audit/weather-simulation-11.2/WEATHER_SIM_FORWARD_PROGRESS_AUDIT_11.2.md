# RAW SURF WEATHER SIMULATION — FORWARD-PROGRESS AUDIT 11.2

| | |
|---|---|
| **Version** | 11.2 (successor to 11.1; covers the OOM closure, the config half, and the height flip) |
| **Audit date** | 2026-08-11, 00:50Z – 01:15Z |
| **Branch** | `dev` · **HEAD** `c2e83b07` |
| **11.1 baseline** | `8be9dd56` · **this window** = `8be9dd56..c2e83b07`, 11 commits, two sessions interleaved |
| **Live backend** | `srv-d7fhiu7lk1mc73debje0`, deploy `679da3d9` live at 00:39:58Z |
| **Sources read** | `HANDOFF-2026-08-10-the-oom-the-instruments-that-lied-and-a-flag-flipped.md` (the concurrent session), Audit 11.1 and its evidence, Render events + env-vars + deploys API |
| **Production code modified** | **none** (audit-only) |

---

# SECTION 1 — VERDICT

# ⚖️ **ON TRACK**

Upgraded from 11.1's *ON TRACK WITH CORRECTIONS*. Three things changed the picture, all measured:

1. **The OOM is closed, and the attribution is clean** — not merely "no kills lately".
2. **Memory fell ~656 MB at a HIGHER product count** — I reproduced the concurrent session's
   matched-load result independently.
3. **The forecast chain is still bit-identical** across everything both sessions shipped.

One item moves *up* the risk table and is now the single largest open exposure: **the height flip
changes the default map display by a median 3× with no accuracy validation.**

## 1.1 What is now proven that was not at 11.1

| 11.1 said | 11.2 measures |
|---|---|
| "whether `oomKilled` has stopped is **unknowable here**" (gap G-01) | **26 OOM events on record, all before the fix, ZERO since.** Gap closed. |
| "the OOM condition is **improved but not closed**" | **Closed**, with a clean attribution window (§2) |
| "peak RSS 84.9 % of cap, ~350 MB headroom" | **39.2 % of cap, 789.1 MB, at a HIGHER product count** |
| "`MALLOC_*`/`PREFETCH_*` unset, 7 days open" | **All three now set and verified in the running process** |

## 1.2 The three highest risks now

1. ~~**The height flip is unvalidated**~~ — ✅ **RESOLVED by Mission 1, same session.** Measured
   against the buoy-scored point lane at 130 real spots: **|tile − point| mean 0.0004 m with the
   flag ON vs 0.2579 m OFF** — ON is closer by ~645×, and reproduces the scored lane to ~0.4 mm
   because the two are now the same computation. **Keep the flip.** See
   `MISSION_1_HEIGHT_FLIP_VALIDATION.md`. *(Risk #1 is now #2 below.)*
2. **A live credential is still committed** at `BRAIN_RULES.md:200` — measured present at HEAD.
   Unchanged across 11.0, 11.1 and now 11.2. **The oldest unactioned P1 in the lineage.**
3. **No CI green has ever proven the marine field paints** — the pixel oracle is still
   5 live / **1 `test.fixme`** / **6 `test.skip`**, and 333 backend test files still run in no lane.

---

# SECTION 2 — THE OOM: ATTRIBUTION, NOT JUST ABSENCE

11.1 could only say "unknown". 11.2 can say which intervention did it, because the deploy timeline
isolates one.

### The events (Render API, read-only, 1,200 events paginated)

26 × `{evicted:false, oomKilled:{memoryLimit:"2Gi"}}`, 2026-08-02T20:26Z → **2026-08-10T13:09:19Z**.

### The clean window

| | |
|---|---|
| last OOM | **13:09:19Z** |
| `0d9149b7` (build-time bound) deployed | **~14:00Z** |
| first env-var redeploy (`PREFETCH_*`, `MALLOC_TRIM_THRESHOLD_`) | **21:50:20Z** |

> **WINDOW A — 7.8 h, `0d9149b7` the ONLY intervention active: ZERO OOMs.**
> **WINDOW B — 3.2 h, fix + env vars: ZERO OOMs.**

Window A isolates the code fix from the config fix. That is the attribution 11.1 lacked.

### ⚠️ The honest bound on it

Pre-fix inter-OOM gaps (h): **44.6, 31.3, 27.6, 27.6, 16.3, 10.1, 6.0, 5.5 …** median **1.3**.
**6 of 25 pre-fix gaps (24 %) were ≥ 7.8 h; 5 of 25 (20 %) were ≥ 10.9 h.**

A 7.8 h window is 6× the median but sits inside the observed distribution. **A clean run past
44.6 h exceeds every pre-fix gap and settles it** — re-read the counter at 2026-08-11T13:57Z (48 h)
and again at 72 h. Until then: *closed on the balance of evidence, not proven.*

### The config half, reproduced independently

The concurrent session measured `MALLOC_TRIM_THRESHOLD_=131072` at matched `disk_product_count`.
**I re-read it cold from `/api/health` and it reproduces:**

| | disk_product_count | RSS | % of 2 GiB |
|---|---:|---:|---:|
| pre-trim (their measurement) | 590 | 1,445.3 MB | 71.2 % |
| post-trim (their probe) | 554 | 784.0 MB | 38.3 % |
| **post-trim (my independent read, 11.2)** | **618** | **789.1 MB** | **39.2 %** |

**≈ −656 MB at a HIGHER product count**, third independent series. The mechanism is sound: glibc
auto-raises its trim threshold as a program frees large blocks, which is exactly why 11.1 measured
RSS never returning. Pinning it at 128 KB disables that.

★ This also **explains 11.1's central measurement without contradicting it.** A per-request
+156.7 MB and a closed OOM are both true: the delta was arena high-water that glibc refused to
return, not a leak. 11.1 measured the symptom correctly and named the wrong remedy.

---

# SECTION 3 — MY OWN 11.1 METHODOLOGY, TESTED AGAINST THEIR CRITIQUE

Their §0.2: *"MATCH THE LOAD, NOT THE CLOCK — RSS climbs with products loaded, not uptime, so
`uptime` is not a control."* They retracted a "−62 %" of their own for this.

**This is a correct and important critique, and it lands partially on me.**

| my measurement | control used | survives? |
|---|---|---|
| T-CAP-01 (+156.7 MB) | uptime 4 h + RSS flat 40 s | **weakened** — no load control |
| T-CAP-02 (+201.6 MB) | RSS flat 213 s | **weakened** — same |
| **T-CAP-03 (small +5.7 MB vs global +812.8 MB)** | **two arms, adjacent windows, same box** | **SURVIVES** |

T-CAP-03 is the one carrying the attribution, and it is immune: background product loading would
raise **both** arms. The small arm moved **+5.7 MB**. So the rise tracked the request, not the load.

⚠️ **But `disk_product_count` is exposed on `/api/health` and I did not use it.** A matched-load
control was available the whole time and I reached for uptime instead. Recorded as a methodology
defect of 11.1, and the reason T-CAP-01/02 are downgraded to corroborating rather than decisive.

---

# SECTION 4 — THE HEIGHT FLIP: THE LARGEST OPEN EXPOSURE

`679da3d9` flips `__RAW_NEARSHORE_RENORM__` **ON by default**
(`window.__RAW_NEARSHORE_RENORM__ !== false`).

**Measured by them on real production data** — a live GFS Florida grid (40 % land cells), 93 real
spots, through the shipped sampler: **80/93 (86 %) move · ratio p50 3.00× · p90 4.52× · max
10.68×**.

**And it is the default display path**, not a transient: the overlay renders whenever any layer is
active, `isExactPointAuthority` requires `selectedSpot || longPressLocation`, so with a layer on and
nothing selected the decayed tile value is shown **directly**.

| | |
|---|---|
| ✅ **Proven** | internal consistency — height now treated as period always has; and it removes a client-side height transform `CLAUDE.md` forbids as a second forecast path |
| ⛔ **NOT proven** | **accuracy.** No buoy scores this sampler. The skill ledger scores the **backend point lane**, which `679da3d9` does not touch (verified: frontend-only diff) |

> ★★★ **A CONSISTENCY PROOF AND AN ACCURACY PROOF ARE DIFFERENT CLAIMS.** Making the tile lane agree
> with how period is handled is a real improvement to composition — it retires a forbidden second
> forecast path. It says nothing about whether the new number is closer to the sea. A 3× median
> change to the number this product exists to report, on the default screen, with no observational
> check, is the largest single exposure in this audit.

**The validation that does not exist and should:** the backend point lane is scored (`raw_surf` MAE
0.202 m at +24 h, paired). The tile lane is not. **Compare the tile sampler against the point lane
at the same coordinates** — if ON brings them into agreement, the tile lane inherits the point
lane's validation and the flip is corroborated by the one lane that is checked against buoys. If ON
pushes them apart, the flip is wrong. **Neither session has run this test.** It is Mission 1 below.

*(11.2 could not run it within budget: the renorm lives inside `sampleValueFromDecodedTiles`, which
reads `window.__DECODED_OM_TILES__`, so it needs their tile harness plus a point-lane fetch. Stated
rather than skipped.)*

---

# SECTION 5 — SCIENTIFIC INTEGRITY

**Bit-identical, third audit running.** The ONE FORECAST COMPOSITION control at HEAD, after the
store refactor, the load-time stride and the height flip:

```
0.5 m -> 3.3 ft / 68.1    1 m -> 5.8 / 84.5    4 m -> 17.6 / 84.5
8 m -> 30.6 / 55.7       12 m -> 29.5 / 59.8
```

Identical to the 11.0 baseline `c9a0e9fc`. The height flip is frontend-only and does not touch the
scored backend lane.

**Both sessions independently found and killed the same false alarm** — "we are losing to
persistence" was an unpaired-population artifact; paired, we win (0.186 vs 0.203 theirs; 0.181 vs
0.199 mine, different windows, same direction). Convergent refutation from two independent routes is
the strongest form this record has produced.

**What survives and is the real target:** Open-Meteo beats us at every lead, paired
(n = 844/853/716). `1140b3e4` pins a same-model control (`open_meteo:ncep_gfswave025`) to separate
*model choice* from *our chain* — needs ~1–2 days of scored rows.

---

# SECTION 6 — SOFTWARE JACOBIAN DELTA (11.1 → 11.2)

| coupling | 11.1 | 11.2 | class |
|---|---|---|---|
| global bbox × resident RSS | 142× the memory for 5.9× the cells | **broken by `MALLOC_TRIM_THRESHOLD_`** — the arena now returns memory; RSS observed *below* peak mid-flight, never seen before | **Unexpected coupling REMOVED** (by config, not code) |
| `grid_series` build × process high-water | intact, +156.7…+812.8 MB | per-request delta unchanged; **operational consequence removed** | Reduced, not removed |
| env var × running process | not examined | **`PUT /env-vars` returns 200, read-back shows the new value, and the process keeps the old one until a deploy** | **NEW unexpected coupling — high blast radius** |
| RSS × uptime (the control I used) | assumed valid | **refuted** — RSS tracks `disk_product_count`, not clock | **NEW coupling, on the INSTRUMENT** |
| tile-lane height × default render state | not examined | `isExactPointAuthority` gates on `selectedSpot`, so the **default** state displays the tile value directly | **NEW unexpected coupling — user-visible** |
| network census × client render state | not examined | a 423-resolution census showed the point endpoint answering 100 %, and concluded the tile lane was unreachable — **it measured whether the endpoint CAN answer, not whether it is the AUTHORITY** | **NEW coupling, on the INSTRUMENT** |
| docs commit × production deploy | closed out-of-band, unverified by 11.1 | **verified both directions**: docs → no deploy, `render.yaml` → deploy | Removed, now proven |
| concurrent session × my measurements | 2 restarts mid-audit, 1 retraction | **4 more deploys during 11.2**, incl. two double-deploys for env vars | **Unchanged — and it is now the dominant source of measurement noise** |

**What the pattern says:** every coupling removed this window was removed by **config or process**,
not by code — and **three of the four new couplings are on instruments, not on the product.** That
is the same signature 11.1 reported, now at a higher level: the system is converging while the
measurement apparatus around it is where the defects concentrate.

---

# SECTION 7 — WHAT DID NOT MOVE

| item | status | age |
|---|---|---|
| Live credential at `BRAIN_RULES.md:200` | **present at HEAD, measured** | flagged 11.0 → 11.1 → **11.2** |
| Pixel oracle | 5 live / **1 `test.fixme`** / **6 `test.skip`** | unchanged |
| Backend test files in no CI lane | 333 of 486 (memory family fixed only) | unchanged |
| External uptime probe (R11 action 1, **P0 in the report's own table**) | not started | 11.0 → 11.2 |
| `__RAW_*` flags | **321** — three dark flags still await an A/B | +5 this window, none retired |
| `forecast_confidence` in the six sim tools | zero | unchanged |
| R11-13 integrity chain (checksums) | zero | unchanged |

---

# SECTION 8 — GATES

| gate | 11.1 | 11.2 | why |
|---|---|---|---|
| A Baseline truth | PASS | **PASS** | tree clean, CI green, deploy = HEAD |
| B Correctness | CONDITIONAL | **PASS** ⬆ | chain bit-identical; **the height flip is now validated against the scored lane** (Mission 1) |
| C Lifecycle | CONDITIONAL | **CONDITIONAL** | unchanged; R11-01 still unexercised under a trip |
| D Regression protection | **FAIL** | **CONDITIONAL PASS** | the capacity oracle now exists and is mutation-proven (6/6); the pixel oracle still does not |
| E Capacity | **FAIL** | **PASS** | 39.2 % of cap at higher load, zero OOMs, attribution isolated |
| F Upgrade readiness | HOLD | **CONDITIONAL** | E and D cleared enough to unblock the next phase, once B's height question is answered |

**Gate E passes. Gate D improves to conditional. Gate B was the binding gate and Mission 1 cleared
it the same session.** The remaining binding constraint is **D** — the pixel oracle still does not
exist, so no CI green has ever proven the marine field paints.

---

# SECTION 9 — NEXT THREE MISSIONS

### Mission 1 — Validate the height flip against the lane that IS scored
**Why first:** it is the only open item that changes a number on the default screen, by a median 3×,
with no observational check. Everything else is infrastructure.
**Do:** run the tile sampler (ON and OFF) and `/api/weather/point` at the same coordinates across
the 93 Florida spots; report the distribution of |tile − point| for both flag states.
**Decides:** ON closer ⇒ the flip inherits the point lane's buoy validation, keep it. OFF closer ⇒
revert with one flag.
**Non-goal:** do not tune any constant. This is a measurement, not a calibration.

### Mission 2 — Read the OOM counter at 48 h and 72 h
**Why:** 7.8 h and 10.9 h both sit inside the pre-fix gap distribution (24 %/20 %). **44.6 h is the
number that settles it.** One API call, no code.
**Decides:** whether Gate E's PASS is durable or was a quiet stretch.

### Mission 3 — The external uptime probe (R11 action 1)
**Why:** scored **P0 in Report 11.0's own table** and open across three audits. Every scheduled
instrument's value is gated on delivery, and GitHub cron was measured at 5–32 % of nominal.
**Non-goal:** not a new dashboard — one external check that pages.

---

# SECTION 10 — AUDIT INTEGRITY

No production code modified. All Render API calls read-only (`GET`); no service, env var or deploy
was changed by this audit. `RENDER_API_KEY` was read from gitignored `backend/.env` and never
printed, logged or committed. The credential at `BRAIN_RULES.md:200` is referenced by location only.

⚠️ **A concurrent session worked this tree throughout both 11.1 and 11.2**, pushing 4 commits and
triggering 6 deploys during the measurement windows. Every live figure here carries the SHA and
timestamp it was taken at.
