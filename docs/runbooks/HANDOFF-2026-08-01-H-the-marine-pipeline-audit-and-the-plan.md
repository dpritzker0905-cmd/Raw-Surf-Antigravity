# HANDOFF 2026-08-01-H — the marine pipeline, audited three times, and the plan that survived

**Read first:** `memory/THE-MARINE-PIPELINE-AND-ENGINE-how-it-actually-works-2026-08-01.md` (the new
marine spine) → `memory/standing-work-rules-user-mandate.md` →
`memory/THE-SURF-FORECAST-SCIENCE-canonical-chain.md` → `START-HERE-2026-08-01-THE-ONE-QUEUE.md`.
**Predecessors this continues:** `-F` (the sim reads the served curve), `-G` (the ranker I missed).

Branch `dev` = `origin/dev` = **`84b0174d`**. CI green: composition guard suite **96 files / 1096
passed / 0 failed**. Render `autoDeploy: yes` on `dev` — every push is live within ~3 min. The
concurrent session's 12 files remain uncommitted and untouched; **stage BY PATH.**

---

## 0. WHY THIS HANDOFF EXISTS

A discussion about "the state-of-the-art path forward" produced **four confident, wrong claims from
me in a row**, each corrected by a measurement that took under two minutes:

| # | I claimed | measurement said |
|---|---|---|
| 1 | "You are not on direct GRIB — everything is Open-Meteo" | `provider` is a DISPATCH KEY; you ARE on direct NOAA/DWD/ECMWF GRIB |
| 2 | "ECMWF partitions may exist via Open-Meteo" | all-null on every path; the old memory was right |
| 3 | "`upstream_provider` is hardcoded wrong" | the runtime overrides it correctly; only the static config is stale |
| 4 | "Period is not in the GPU texture path" | it is — in a **different module** than the one I grepped |

★★★ **Every one was "read one file or one field, then generalise."** The plan below is therefore
written so that **each step carries its own verification measurement** instead of inheriting a
conclusion. That property matters more than the ordering.

---

## 1. WHAT WAS ESTABLISHED, WITH PROOF

All measured live against production on 2026-08-01. The full detail is in the marine spine memory;
this is the short form a planner needs.

**Feeds.** GFS → NOAA byte-range GRIB2 (`ncep_gfswave025`, all 4 layers). ICON → DWD GWAM
(`dwd_gwam`; **no `swell_2` — 0 cells at every tier**, an honest upstream absence). EURO → ECMWF
Open-Data GRIB for `waves` only; **`swell_1/swell_2/wind_waves` from Copernicus CMEMS.**
⚠️ All three direct paths **fall back to Open-Meteo on failure**, and it is **UNVERIFIED** whether
`upstream_provider` changes when they do.

**EURO is the only internally-incoherent model, and it cannot be fixed by changing feeds** —
ECMWF WAM has no partitions to fetch, on any path. **Owner decision: CMEMS stays.** Two consequences
labelling does not fix: EURO's swell layers serve **10° global cells at every tier** (while EURO
`waves` resolves regionally), and **EURO `swellAvailFrac` = 0** so the dominant-swell stamp never
fires for EURO — correctly, but it should be *stated* rather than look like a bug.

**The GPU texture** (`WebGLMarineTextureEncoder.js`, **not** `WebGLMarineEngine.js`):
`R/G` = unit direction, `B` = height/10 (**saturates 10 m**), `A` = period/20 (**saturates 20 s**).
Both ceilings are reachable in real surf. The scale constants are **1 encode ↔ 5 decode across 3
files**. There are **two** wave textures — animation (honest height) and score (rating) — so `B`
means different things depending which you sampled.

**The rating lane is three-model** (`SPOT_RATINGS_PRECOMPUTE_MODELS: 'GFS,EURO,ICON'`), which makes
EURO's split material: it would feed the observation gate, which licenses good/epic on ≥2 models
agreeing.

**`SURF_PARTITIONS` costs 4×** point resolutions (median ~0.4 s each) on a 1-CPU box with a
three-incident melt history. The instruction is already written in its docstring: *"Turn it on in
the PRECOMPUTE first and measure"*, *"IF YOU ENABLE IT, ENABLE IT EVERYWHERE."*

---

## 2. THE PLAN — ordered by (surfer value ÷ risk), each step with its own proof step

### 1. PERIOD + ENERGY — split by risk, ship as two items
Research is unambiguous that height alone is the wrong headline: wave energy flux (`P ∝ H²T`) is the
domain standard, and surfers filter on period (~10–13 s groundswell threshold).

* **1a. Infobox / data fields — genuinely free.** The JS data model already carries `period`
  (`backendWeatherServiceClient.js:550`). Show **height + period + energy + direction, per train**.
  No engine work, no new fetch, no new mask. **Ship this alone first.**
* **1b. Heatmap display mode — shader work, treat as minefield.** The correct shape is **two
  orthogonal controls**: the existing layer toggle picks *which train*; a new display mode picks
  *which quantity* (Height / Period / Energy). Not a new "Period layer" — that would imply a
  separate product with its own mask, availability and provenance, recreating the problem.
  ⛔ **FIX THE CEILINGS FIRST or the Period view lies exactly where it matters.** That means all
  six constant sites, together (see the marine spine). Kill-switch + the zoom-burst protocol +
  check the throw-counter path; this lands in the 3,336-LOC engine.
  **Proof step:** encode a known 24 s / 12 m cell and assert it round-trips through the shader
  before building any UI.

### 2. PER-SITE REFRACTION OFFSETS — the largest measured accuracy term
Kr median 0.797, and the dominant component is a **site offset unknown at 1,763 of 1,773 spots**.
This is the real gap to Surfline LOTUS (high-res bathymetry + 35 years of observations retraining).
You are already building the 85-year history that feeds it.
⚠️ Literature caution, and it matches your own ERA5 finding: ML/statistical downscaling
**systematically underestimates coastal extremes** (yours: 30–32%). ⇒ **ML for the median,
instruments for the tail.** Never let a learned model set the big-day number.
**Proof step:** hold out a buoy-rich site, fit its offset from history, and score against
`validate_nearshore_transform.py` before generalising.

### 3. ONSHORE-ENERGY RANKING (`P·cos Δθ`) — the arrow
Independent of everything above. Rank trains by the onshore component of energy flux, exclude
offshore-moving trains, degrade to the total field where `shore_normal_deg is None`, and **name the
train the arrow is showing** — with multiple partitions the arrow becomes a choice, and an unnamed
choice reads as a bug.
⚠️ **#7 is DORMANT, NOT FIXED** (measured 2026-08-01): the reported ~216° tier flip does not
reproduce today (all six site×model pairs agree, |Δdir| 1.3–15.9°), but only because current seas
are swell-dominated. The mechanism is intact. **Do not close it on today's numbers.**

### 4. `SURF_PARTITIONS` — precompute first, measure the 4×
Follow the docstring, **not** the per-model gating I proposed in discussion (it contradicts the
recorded lane-axis instruction). Two measurements owed before any flip: the **actual precompute
cost**, and **what EURO's cross-model reconciliation does to a score**. Neither exists yet.

### 5. LABEL HYGIENE — cheapest, non-blocking, but it is what would have saved two of my four errors
Correct the stale `capabilities.py` `upstream_provider: "open-meteo"`; document `provider` as a
dispatch key at the point a reader meets it; add a guard tying `upstream_provider` ↔
`source_dataset`. **And answer the open question:** does `upstream_provider` change on Open-Meteo
fallback? If not, nothing distinguishes "direct worked" from "fell back."

**DROPPED:** "unify EURO's partition provenance." Upstream-impossible; owner has ruled CMEMS stays.

---

## 3. ALSO OPEN (from the queue, unchanged by this audit)

`#25` as the general INGEST hole-fill shape — **downgraded**, it repairs models that measure clean
(ICON 0 holes, GFS 1–3); GFS's own coarse holes are the part it would fix · `#22` three unnamed
`Height` labels (`forecastCardCompiler.js:387/479/564`) · `#11` halo · `#8` stale resident grid ·
`#15` ERA5 campaign (owner call) · `#28` four nameless buttons · `D §4e` named-exemplars probe lane.
**Debt:** 154 lint errors / 150 warnings (ratcheted, shrink-only) · wider backend suite ~62% skipped
· `WebGLMarineEngine.js` 3,336 LOC · `weather_sim_mcp.py` 789/800 · the a11y audit backlog.

**Running automatically:** the E#1 acceptance (`verify_point_spot_reference.py`) inside the
Calibration Census at `35 2,8,14,20` UTC — it voids itself by name until the precompute writes
`lat`/`lng` into the climatology blob, then verifies `/api/weather/point` serves the per-SPOT
reference. **Promote it to `--fail-on-mismatch` once a run prints PASS.**

⛔ **The owner must restart Claude Code** (not Claude Desktop) for the sim MCP server to pick up the
served-curve fix — the two apps spawn separate server processes, and an agent cannot restart the one
it is talking through.

---

## 4. THE HABIT THIS SESSION IS ACTUALLY ABOUT

★★★ **A single grep is a hypothesis, never a finding.** Four wrong claims, four two-minute
measurements. The cost of checking was always far below the cost of being wrong — and in three of
the four cases the correct answer was *already written down* in the code or in memory, and I had
read past it.
★★ **When a memory contradicts your reasoning, suspect the reasoning.** `"ECMWF has NONE"` was
right; I hedged against it and had to retract.
★ **State what would make a number wrong before quoting it.** The probe that read "no partitions at
every latitude" was measuring a flag, not the ocean — and its own uniformity was the tell.
