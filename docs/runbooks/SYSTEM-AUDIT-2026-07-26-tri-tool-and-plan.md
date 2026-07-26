# SYSTEM AUDIT 2026-07-26 — tri-tool forensics, LOC governance, and the forward plan

**HEAD `151e410d` · branch `dev` · working tree clean · 0 unpushed · frontend 166 suites / 1493 tests
GREEN · backend `/api/health/data` all 9 lanes `ok`, 0 alerts.**

Method: forensics-not-guessing + Jacobian lens. Every claim below has a probe behind it. Two of my
own instruments were invalid mid-audit and are marked as such — the corrections are in §2.

---

## 0. THE ONE-LINE VERDICT

The system is **healthy and shipping**, but **three AI tools are working the same repo from three
private memories**, so debt is re-discovered instead of retired, and the one governance gate that
would have stopped the frontend bloat **has never executed**. Those are the two roots. Everything
else is downstream.

---

## 1. TRI-TOOL FORENSICS — who did what, and what fell in the cracks

Stores located and decoded (recipe in memory `cross-tool-history-forensics-map-2026-07-26`):

### Claude Code — last 5 sessions (this repo)
| When | Session | Subject |
|---|---|---|
| 07-26 | `c06d8fd5` | this audit |
| 07-26 | `42d882bf` | scheduled brain-learning consolidation (automated) |
| 07-26 | `5d267325` | tides→rating-toggle merge; autonomous weather-sim bug hunt; light-mode marine particles |
| 07-26 | `23a73726` | rating-band paint-ahead on pan; wave-animation direction shift on rating toggle |
| 07-26 | `dc8e0fe8` | marine heatmap zoom-out clear; wind seam; pan-clearing of animations |

**Claude Code owns the marine/wind render engine.** 07-21→07-24 = the antimeridian arc + 429 breaker.

### Antigravity — last 5 trajectories (42 total, 06-07 → 07-24)
| When | Steps | Title |
|---|---|---|
| 07-24 | 348 | **System Audit and Debt Update** ← produced the SYSTEMWIDE AUDIT report |
| 07-14 | 289 | Raw Surf Forensic System Audit |
| 07-13 | 459 | Replacing Website Brand Color |
| 07-13 | 245 | Auditing Computer Performance |
| 07-12 | 309 | malware issues on www.raw.surf |

**Idle since 07-24 (out of credits).** Its marine/weather work ended **06-22**.

### Codex — last 2 sessions (26 total; the rest are June)
07-24 (18 MB) and 07-25 (5 MB). Codex consumed Antigravity's audit as a pasted attachment, then
shipped **~20 commits on 07-25**: private media, guardian media controls, public-storage contract,
feed/comment/ORM fixes, GIF migration. **Codex owns security + social/app surface.**

### ⚠️ THE CRACKS (things no single tool knows)
1. **Antigravity's 07-24 debt bank (DEBT-BOLA-01 … DEBT-OBS-06) is not in Claude Code memory
   and not in the repo.** It lives in a Codex attachment file. It is being re-derived every audit.
2. **A face-recognition feature exists only in Antigravity** — `Facial Recognition Implementation
   Plan` (873 steps) + `Sorting Surf Photos via Face Recognition` (584 steps), both 06-28. No git
   trace, no memory entry. Either dead work or an unlanded feature; **needs a disposition decision.**
3. **Codex's 07-25 security work is absent from Claude Code memory** — real regression risk when CC
   next touches uploads/media.

**→ Fix: this file becomes the single in-repo ledger. All three tools read/write it.**

---

## 2. ⚠️ TWO INVALID INSTRUMENTS THIS PASS (corrections on the record)

- **`/api/weather/grid` without `domain`+`valid_time` returns a 422 body.** I parsed one and read
  "0 vectors", nearly filing a false EURO-outage finding. Correct probe:
  `?model=EURO&domain=marine&layer=waves&valid_time=<ISO>&bbox=…` → **546 vectors,
  `euro_marine_waves_global_mid_*`, `is_estimated:false`.** EURO marine is **fine**.
- **`/api/health/data` lane `source` describes the EXTENSION TAIL, not the lane.** `EURO/marine`
  reports `source:"gfs_estimated_fallback"` with `verdict:"ok"` — which reads as "EURO is running on
  GFS." It isn't. Near-hours serve real EURO products; only the >240 h tail is GFS-derived (by
  design). **This is a reporting-ambiguity defect, not a data outage** — see FE-3.

---

## 3. LOC AUDIT — and its actual root

**Rule:** ≤800 LOC. **Result: 0 backend Python violations, 13 frontend JS violations.**

### Why the asymmetry (the Jacobian variable)
| | local hook | CI on **push** | CI on **PR** | outcome |
|---|---|---|---|---|
| Python | ✅ `.git/hooks/pre-commit` (**`.py` only**) | ✅ `ci.yml` → `backend-file-size-check` (`working-directory: backend`, strict) | ✅ `loc-check.yml` | **0 over** |
| JS | ❌ none | ❌ **none — `ci.yml` has no frontend size job** | ✅ `loc-check.yml` | **13 over** |

`loc-check.yml` fires **only `on: pull_request`**. The workflow is **push-direct-to-dev** (verified:
`unpushed: 0`, HEAD==origin/dev, no PRs). **⇒ the frontend gate has never run once.**
The debt isn't 13 careless files — it's one missing trigger.

### The 13 (all in `frontend/src/components/map/` — the documented regression minefield)
`WebGLMarineEngine.js` **3844** (4.8×) · `WebGLMarineLayer.js` 1221 · `WeatherEngine.js` 1116 ·
`WebGLMarineMaskRenderer.js` 1098 · `MapWebGL.js` 1097 · `WebGLWindEngine.js` 1095 ·
`WebGLWindShaders.js` 1029 · `WebGLMarineParticleShaders.js` 978 · `useMarineDataFetcherCore.js` 966 ·
`MapWeatherControls.js` 957 · `openMeteoProtocol.js` 943 · `useMarineOrchestrator.js` 908 ·
`OceanMask.js` 905

### ⚠️ Python is AT the cap — live hard gate
`backend/services/weather_pipeline/scheduler.py` = **exactly 800**. The hook blocks at `>800`, so it
accepts **zero** added lines: any weather-sim scheduler change must ship with a split in the same
commit. Warning zone: `store.py` 781, `scheduler_helpers.py` 774, `content_mgmt.py` 772, `feed.py`
770, `admin_ops.py` 763. **Never `--no-verify`.**

---

## 4. OPEN DEBT — consolidated from all three tools

| ID | Sev | Source | Item | Status |
|---|---|---|---|---|
| **GOV-01** | **P0** | this audit | Frontend LOC gate never fires (PR-only trigger) | ROOT, unfixed |
| **BOLA-01** | **P0** | AG 07-24 | 219/930 routes lack tenancy/ownership guards; 15 are financial/booking | open (CLAUDE.md certifies only the routes touched in the 07-25 release) |
| **SIM-01** | **P1** | CC memory | `weather_sim_mcp.py` `quality_score` is **height-blind** — omits `swell_h`; 0.0 ft rates "Epic" 85 | open |
| **SIM-02** | **P1** | CC memory + re-verified today | Sim MCP's 3 tools have 3 sources of truth; `get_surf_spots` returned orientations **270/280/260 ⇒ fell back to MOCK** despite `dev.db` present | re-confirmed 07-26 |
| **SIM-03** | **P1** | CC memory | `simulate_weather_change` mutates module-level `MOCK_SPOTS`, no reset/TTL, last-write-wins; DB write is never read back | open |
| **SIM-04** | **P2** | CC memory | `caller_role="admin"` is a caller-asserted string, not auth | open (sandbox only) |
| **MAR-01** | **P1** | CC 07-24 | Marine activation **9511 ms** to first paint; **world grid fetched TWICE** (broken dedup after `41addb91` flipped `region_id`) | measured n=1, unfixed |
| **MAR-02** | **P1** | CC 07-24 + AG DEBT-CACHE-03 | GLOBAL 181×83 grid resident at z6.0 close zoom | reproduced, unfixed |
| **PERF-02** | **P2** | AG 07-24 | Wind particle re-seed blink on pan >25% tile width (`WebGLWindEngine.js:582`) | open |
| **UX-04** | **P2** | AG 07-24 | `useMarineOrchestrator.js:272` `setMarineData(null)` on deactivate → toggle blink | open; no reactivation regression test |
| **OBS-06** | **P2** | AG 07-24 + §2 | `/status` hardcodes `stale_products_count:0`/`healthy`; health lane `source` mislabels EURO | open |
| **A11Y-01** | **P2** | CLAUDE.md mandate | map dir: 70 `aria-*`, only **5 `role=`**, keyboard handlers in **2 files**; 2 div-with-onClick | improving (41→70 aria) but `role`/keyboard ~flat |
| **THEME-05** | **P3** | AG 07-24 | `WindColorRamp.js` duplicates ramp logic per theme | open |
| **FEAT-01** | **?** | AG only | Face-recognition photo sorting — 1457 steps of planning, zero git trace | **needs disposition** |

Plus the standing backlog in `standing-context-guards-landmines` (z9 clamping A/B, sheltered-water
exposure model, external uptime probe, reseed blink, colormap v5 eyeballs, ICON far-hour mid tail,
CORS-on-error).

---

## 5. BEST-PRACTICE GAP ANALYSIS (vs Surfline / Windy / Windguru, 2026)

Raw Surf already **matches or beats** the field on the hard part: multi-model (GFS/ICON/EURO)
switchable marine + wind on a GPU-native animated map, 14-day horizon, precomputed ratings, radar
with advection. That is Windy-class rendering with Surfline-class rating intent.

**Real gaps, ranked by user-visible value:**
1. **Nearshore/bathymetry transform is the moat and it's half-built.** Surfline's differentiator is
   its nearshore model — deep-water swell → actual breaking height at *this* spot. Raw Surf has
   `surf=true` (bathymetry surf-transform) plumbed through `/grid` and a `surf_rating.py`, but the
   **sheltered-water/intracoastal exposure model is still an open backlog item**, and the sim MCP's
   rating is height-blind. **Closing this is worth more than any new layer.**
2. **No observed data anywhere in the rating.** Competitors anchor on buoys (NDBC) and cams. Raw Surf
   is 100% model. One NDBC buoy-nearest-spot overlay would give a truth anchor and a cheap
   credibility win — and would let you *measure* forecast skill, which nobody in the category shows.
3. **No forecast-skill / confidence surface.** You run three models; the disagreement between them is
   free information (Windguru's whole pitch). Showing model spread as a confidence band is a
   differentiator you're already paying the data cost for.
4. **Tide is being merged into the rating glyphs** (in flight, session `5d267325`) — right call;
   tide-aware rating is table stakes at Surfline.
5. **Accessibility is below industry baseline** — 5 `role=` attributes and keyboard support in 2
   files across the map surface. This is also legal exposure for a consumer app.

Sources: [surfertoday](https://www.surfertoday.com/surfing/the-best-surf-forecasting-websites-and-apps) ·
[lazysurfer 2026 rankings](https://lazysurfer.app/compare/best-surf-forecasting-app-2026.html) ·
[Surfline](https://apps.apple.com/us/app/surfline-wave-surf-reports/id393782096)

---

## 6. PLAN OF ACTION

Sequenced so each step de-risks the next. Weather sim first, per your call.

### STEP 0 — stop the bleed (½ day, do first)
- **GOV-01**: add `push: branches:[dev]` to `loc-check.yml` **with a baseline allowlist** of the 13
  current paths + line counts. Fail only on a *new* file crossing 800 or an existing violator getting
  *longer*. Turns the gate on without going red.
- **Pre-split `scheduler.py`** (800/800) before any sim work touches it — otherwise every weather-sim
  scheduler commit is blocked.
- Land this ledger in-repo; point CLAUDE.md at it as the single debt source.

### STEP 1 — WEATHER SIM CLOSE-OUT (the focus)
Ordered by leverage:
1. **SIM-01 height-blind rating** — the sim rates a flat ocean "Epic". This is the single wrongest
   thing in the sim. Fix `quality_score` to include `swell_h`; unit-test the anchors already in
   memory (FL 2–3 ft clean = FAIR).
2. **SIM-02/03 source-of-truth collapse** — make all three MCP tools read one store; kill the
   silent `except: return []` that masks DB failure as "no rows"; add reset/TTL so a sim isn't
   permanent. Today's probe (orientations 270/280/260) proves it's still on mock.
3. **MAR-01 activation latency** — 9.5 s to first paint with the world grid fetched **twice**. The
   duplicate fetch is a correctness defect independent of timing. Fix the dedup that `41addb91`
   broke; then run `activationlab.js` **≥5× per leg** and compare medians (n=1 is not a result).
4. **MAR-02 global grid resident at close zoom** — the `gwid` skip, caller-aware so the 429-cooldown
   fallback still works (that conflict is the known landmine).
5. **UX-04 deactivation retain** + the missing reactivation regression test.
6. Then **P7/P12/P14** from the master audit to actually close it.

Every item: instrument → kill-switch → unit + live A/B → prove. Marine visual protocol applies
(zoom in/out across all layers, rating ON *and* OFF, capture *during* the gesture).

### STEP 2 — security (parallel, Codex's lane)
**BOLA-01**: the 15 financial/booking path-param routes first. This is P0 and older than everything
else here.

### STEP 3 — the moat
Nearshore/sheltered-water exposure model (backlog ②) + one NDBC buoy anchor. This is where the
product wins.

### STEP 4 — burn down
13 LOC violators worst-first, but **only behind the ratchet and only with the marine test suite
green each split**. `WebGLMarineEngine.js` at 3844 is the most dangerous file in the repo to touch —
it is not a refactor, it is instrumented surgery.

### Decisions I need from you
- **FEAT-01**: face-recognition photo sorting — resurrect, or formally kill? 1457 steps of Antigravity
  planning are sitting unlanded.
- **Antigravity credits**: it's been idle since 07-24. Renew, or consolidate onto CC + Codex?
