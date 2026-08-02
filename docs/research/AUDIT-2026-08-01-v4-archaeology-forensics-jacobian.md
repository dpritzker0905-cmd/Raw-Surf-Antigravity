# Audit v4 — Archaeology · Forensics · Jacobian

**Date:** 2026-08-01 · **Measured at:** HEAD `61b08a26`+ (a concurrent session was committing throughout)
**Mode:** READ-ONLY. No functional code altered. Per BRAIN_RULES §Sentinel, **no permanent write-action
has been taken and none will be without your explicit "Proceed."**

**BRAIN STATUS** [Check] — forecast accuracy + simulation; no branding surface touched.
**SPINE STATUS** [Check] — §Weather-Sim operating rule honoured: *map, compare to stable commits, find
the exact mismatch* — no rewrite proposed.
**LIMB STRATEGY** [Action] — MCP-first attempted per §1/§21 (see §1 below), then direct forensics +
a 6-agent parallel archaeology sweep over 2,861 commits, adversarially verified.

**Predecessors:** v1 (CPU ranking — wrong) · v2 (Jacobian — corrected 3 recorded figures) ·
v3 (forensic mutation testing — 10/12 caught, 2 gaps named).

---

## §0 — THE META-FINDING: staleness is the dominant defect class, and it is measured

90 days of commit subjects, self-declared defect words:

| class | count | class | count |
|---|---|---|---|
| **stale** | **65** | silently | 6 |
| revert | 37 | blind | 6 |
| regression | 33 | drift | 6 |
| | | ran nowhere / fabricated / clobber | 5 |

**"Stale" is not one topic.** It spans `fix(marine)` 9 · `fix(map)` 6 · `fix(wind)` 5 ·
`docs(handoff)` 5 · `fix(weather)` 4 · `fix(ratings)` 2 · plus admin, profile, feed, scheduler,
geometry, tests — **12+ distinct subsystems**, covering caches, UI state, tests, docs and handoffs.
One commit is literally *"docs(handoff): correct two stale facts."*

⭐ **The Jacobian variable at the system level is not a physical input — it is the FRESHNESS OF
WHATEVER DESCRIBES THE SYSTEM.** Every audit in this series has been forced to correct a description
that had moved:

| description | what it said | measured truth |
|---|---|---|
| Jacobian memory | shore normal = 6.0 / 23.6 pts | **7.4 / 28.1** (it measured swell misalignment) |
| Jacobian memory | offshore Hs = 0.0 pts | **+2.4…+3.0** since `RATING_LOCAL_SIZE` flipped |
| sim memory | "the sim still doesn't gate" | **it gates** (`#13`) |
| CLAUDE.md | sim is "height-blind" | delegates to production since the `sim_rating` extraction |
| **BRAIN_RULES §Project files** | *"focus on `b5bbaa7d` and `f5f6a3d` to audit changes"* | those are **1,907 and 1,942 commits** behind HEAD (2026-05-26/27) |
| ECMWF Confluence | wave stream "not applicable for AIFS" | live endpoint returns **200** |
| the queue | multiple items OPEN | several **closed at HEAD** (§4) |

⇒ The highest-leverage systemic fix is not a physics change. It is **making the descriptions
self-invalidating** — every one of the above is a fact a machine could have re-derived.

---

## §1 — Both MCP code-graph servers mandated by BRAIN_RULES are DEAD

BRAIN_RULES §1 and §21 require MCP-first code discovery and an explicit initialization check. I ran it:

| server | state | evidence |
|---|---|---|
| **codebase-memory-mcp** | **index EXISTS, every query fails** | `list_projects` → `C-Users-dprit-Raw-Surf`, **34,128 nodes / 74,917 edges / 68 MB**. `index_status`, `get_architecture`, `search_graph` all → `"project not found or not indexed"` **for the exact name it just returned** |
| **trevec** | **index intact, FTS corrupted** | `reindex` → 2,558 files unchanged, 0 parsed. `search_code` / `get_context` → `MCP error -32603: FTS search failed` |

⛔ A 68 MB knowledge graph that answers no query, and a semantic index whose search is broken.
**Every agent operating under BRAIN_RULES has been silently falling back to grep while believing it
had a code graph.** This is this repo's own coverage class — *a resource picked with no requirement
that it CONTAIN what it covers, degrading silently* — applied to the tooling layer itself.
★ Also: `trevec repo_summary` requires Pro and is unavailable; BRAIN_RULES lists it as a primary tool.

---

## §2 — ⛔⛔ THE HEADLINE DEFECT: a FOURTH forecast path, live, violating the cardinal rule

`GET /api/surf-conditions` → `routes/surf_spots/conditions.py:20` → `services/surf_conditions.py`
(445 lines, serving **29 named spots**).

What it does, verified line by line:
* fetches **open-meteo directly** (`"source": "open-meteo"`) — its own ingestion path
* takes `wave_height_m` straight from the marine `heights` array (**offshore significant wave height**)
* `result["wave_height_ft"] = meters_to_feet(wave_height_m)` (`:275`)
* `grep -n "estimate_surf|surf_point|resolve_surf_geometry|surf_height_m"` → **NO MATCHES.**
  It never calls the canonical chain.

This violates the CLAUDE.md cardinal rule verbatim — *"NEVER report marine `point.speed` as the surf
height"* — and its second clause, *"⛔ Do not add a second forecast path 'just for this screen'."*
It is the **same defect that shipped the offshore number at the spot hub for months**, still live at a
different route, and a **fourth** ingestion path beside the direct-GRIB pipeline.

**Measured error it ships** (1.8 m / 13 s sea, its own `SPOT_COORDINATES`):

| spot | shows | truth (breaking) | error |
|---|---|---|---|
| Pipeline | 5.9 ft | **9.0 ft** | **−34.1%** |
| Mavericks | 5.9 ft | 8.8 ft | −32.7% |
| Jeffreys Bay | 5.9 ft | 8.5 ft | −30.2% |
| Bells | 5.9 ft | 7.6 ft | −22.8% |

Range **−34.1% … −22.8%**, median −34.1%, across 12 sampled of 29.
⚠️ **Honest correction to the received wording:** at *this* sea state every sampled spot
**under-reports**. CLAUDE.md's "signed both ways (−18.7% … +92.7%)" describes the range across
*states*, not this one. Do not quote my numbers as bidirectional.

### 2.1 ✅ Reachability RESOLVED — it is user-visible, in the post composer
`CreatePostModal.js:96` and `useCreatePostActions.js:182` both call it. `CreatePostModal.js` then
**auto-fills the user's session form**:

```js
const { data: d } = await apiClient.get(`/surf-conditions`, {params:{latitude, longitude, spot_name}});
if (d.wave_height_ft) setWaveHeightFt(d.wave_height_ft.toString());
...
setConditionsSource('auto'); toast.success('Conditions auto-filled! Feel free to adjust.');
```

⇒ Every auto-filled session report is stamped with an **offshore** height presented as the surf they
rode — roughly **a third low** at the sea state measured.

### 2.2 ⛔ AND THE ESCALATION I NEARLY SHIPPED — the calibration loop is **CLEAN**
I traced this toward "the forecast is calibrating against itself" and **that is FALSE.** The chain
breaks at the table boundary, verified:
* `report_calibration.py:239` reads **`surf_log_entries`** (`select=spot_id,session_date,session_time,wave_height,conditions_rating`).
* `CreatePostModal` writes **`posts`** — a different table (`models/posts.py:62`), and it *does*
  persist `conditions_source ∈ {auto, manual, edited}`, so autofilled rows stay distinguishable.
* `SurfLog.js:250` — the page that writes `surf_log_entries` — takes Wave Height as a **plain manual
  text input** (`placeholder="3-5ft"`) and calls `/surf-conditions` **nowhere**.

⇒ **The observation channel that calibrates the forecast is human-typed and uncontaminated.** The
defect is real but **contained to the post composer's autofill**. Recording this because the
false version is far more alarming than the true one.

*(An agent also claimed this module has "ZERO tests of any kind" — **refuted**: `test_surf_conditions_post_menu_iter195.py`
and `test_session_metadata_iter196.py` reference it. The composition defect stands; the coverage claim does not.)*

---

## §3 — The ensemble is REAL, and priced in the app's own units

### 3.1 v3's #1 UNVERIFIED item is now CLOSED
v3 found `ifs/waef` (50-member ensemble wave) on the free endpoint but could not verify the values.
I closed it **without a decoder**, by parsing the GRIB2 packing metadata — which is exactly what would
expose an all-null field:

```
Section 5: npoints = 665,628   bits/value = 16   (0 would mean a CONSTANT field)
Section 6: bitmap present, 665,628 ocean points of a 1440x721 grid
Section 7: 718,180 bytes packed
members: 50 distinct (1..50)   params: 13 (incl. all six period bands h1012..h2530)
member payloads for swh / h1417 / h2125: 3 of 3 sampled are BYTE-DISTINCT -> real spread
```

⇒ **A genuine, populated, 50-member ensemble with real member-to-member variance.**

★ **Actionable constraint discovered:** data-representation template is **5.42 = CCSDS/AEC**, not
simple packing. Any ingest needs ecCodes built with `libaec`. `pygrib`'s bundled wheel has it; a hand
decoder does not (see §6.1 — mine failed on exactly this).

### 3.2 ⭐ What it is worth, in LEVELS
The sim answers with one number. If members disagree on Hs by a realistic operational margin, the
user's *answer* changes — measured end-to-end through the real chain (1.8 m / 14 s / 6 kt):

| spread | spots spanning >1 LEVEL | worst case |
|---|---|---|
| **±10%** | **2 of 4** | Trestles `good → epic` |
| **±20%** | **3 of 4** | Cocoa `good → epic` |
| **±30%** | **4 of 4** | Trestles **`fair_good → good → epic`** (3 levels) |

⇒ **At day-2/3 lead the deterministic number is not distinguishable from a 2–3 LEVEL range.** That is
the product value of going probabilistic, stated in the units the app already ships.

---

## §4 — Archaeology yield (6 parallel diggers, 2,861 commits, 48 candidate findings)

Reported as **agent-measured**; I independently re-verified the highest-impact ones and mark the
outcome. Everything else is a lead, not a fact.

### ✅ Independently CONFIRMED by me
* **§2's fourth forecast path** — confirmed line-by-line and quantified.
* **Staleness class** (§0) — reproduced across 12+ subsystems.

### ⛔ Independently REFUTED by me
* *"4 of the 96 guard-suite files run ZERO tests, and still satisfy MIN_FILES=96."*
  **Measured: 97 guard files, 0 with zero `def test_`, and exactly 1 module-level skip
  (`test_weather_sim_mcp_server_startup.py`) — which the glob already excludes by name.**
  Does not reproduce. *(The count is 97, not 96, because the concurrent session's
  `test_spot_hub_local_size_reference.py` is now tracked — itself a staleness instance in ci.yml's floor.)*

### ⚠️ HIGH-VALUE LEADS — agent-measured, NOT yet re-verified by me
Listed because they are specific and cheap to check, **not** because they are established:
1. **`SURF_HEIGHT_H110` guard passes with the flag ON** — it asserts arithmetic on two functions, not
   the composition. Memory says flipping it alone = **+25.5% too high on every surface**.
2. **`SPOT_HUB_SURF_TRANSFORM` is a second, independent kill switch for the same transform** — so
   `SURF_TRANSFORM=0` (the documented kill switch) would not disable the hub.
3. **`WORLDWIDE_REGIONS_PER_CYCLE='2'` in `forecast-ingest.yml` is inert** — the same lane sets
   `INGEST_PILOTS='...'`, so rotation is delivered by the pilots workflow alone.
4. **The ledger auditor scores REVERTED commits as "shipped" — 9 confirmed** — corrupting the metric
   the queue treats as decisive.
5. **29 CI-orphan modules**: tests exist, are green locally, matched by **no** CI pattern — including
   `estimator.py` (652 lines, imported by `point_resolution`, `normalizer`, `lattice_fill`).
   Same class as the recorded `test_point_*` glob miss.
6. **`conditions_labels.py`** — the canonical size ladder ("Head High", "Overhead") — reportedly has
   no executing CI test.
7. **The Canaveral vortex has three occurrences**, each fix blind to the next resolution tier.
8. **4 guard test files deleted by reverts and never restored** — the reverts removed the instrument
   along with the change.
9. **`swell_exposure_fraction`** — a discovery gate written to reject named false positives, **wired
   to nothing**; same class as the recorded `komar_breaker_height` dead-code case.
10. **`main` is 978 commits / 30 days behind `dev`** while `netlify.toml` carries a production context.
11. **Zero classic TODO/FIXME markers in the entire forecast chain** — debt is recorded as prose and
    ⛔/⚠️ blocks. *A debt inventory built on TODO-grep would report this pipeline as debt-free.*

---

## §5 — The two-veto coupling (v3 §4.2 resolved)

v3 left open whether the map band's deliberate `break_depth_m` omission could bite. **Resolved: yes,
by construction, in a bounded window.**

`spot_size_climatology.MIN_SAMPLES = 12` — a cell with fewer than 12 samples returns **None**, and
`grid_size_climatology.reference_for` then falls back to the 8-neighbour mean, else **None**.
The band omits `break_depth_m` *because* it relies on that reference. **When the reference is None it
has neither, and both size vetoes go inert together.**

Measured `oversize_gate`:

| surf | ref=None, bd=None | ref=None, bd=11.1 | ref=0.8, bd=None |
|---|---|---|---|
| 4 m | **1.0000** | 1.0000 | 0.5800 |
| 6 m | **1.0000** | 1.0000 | 0.3000 |
| 8 m | **1.0000** | 0.8481 | 0.3000 |
| 10 m | 0.7667 | 0.5651 | 0.3000 |
| 30 m | 0.3000 | 0.3000 | 0.3000 |

⇒ **Exposure window ≈ 4–10 m breaking height (13–33 ft) at a low-climatology cell.** Measured at
Cocoa Beach 6.13 m: **46.6 `fair` with the depth vs 97.5 `epic` without.**
⚠️ **I overstated this in conversation** ("a 98 ft closeout paints epic") — at 30 m the gate **does**
engage (0.30 → `poor_fair`). The absolute fallback pair eventually bites. **The window is bounded.**

---

## §6 — My own errors (three, each caught by a control)

1. ⭐ **I hand-decoded GRIB2 assuming simple packing and produced confident garbage.** Every spot
   returned 0.004 m — exactly the reference value. **The control caught it**: spots on different
   oceans cannot share a value. Section 7 was 718 KB where 16-bit simple packing needs 1.33 MB.
   The template is **5.42 CCSDS/AEC**. All metre values I printed are **retracted**.
2. ⭐ **I overstated the §5 window** before testing the extreme (see above).
3. ⭐ **I nearly published two agent findings as fact.** One refuted outright (§4), one materially
   wrong on coverage (§2). ⇒ *A sub-agent's "measured" is a lead until you re-run it.*
4. ⭐⭐ **I nearly escalated §2 into "the forecast calibrates against itself."** The chain looked
   closed — autofill → session report → `report_calibration`. **It is not**: the calibrator reads
   `surf_log_entries`, the composer writes `posts`, and the Surf Log page takes wave height as a
   manual text field. I caught it by checking the one link I had assumed. **The alarming version of a
   finding is the one that most needs its last link verified.**

---

## §7 — Jacobian-ranked upgrade path

| # | Upgrade | Sensitivity (measured) | Uncertainty | Leverage |
|---|---|---|---|---|
| **U1** | **Route `/api/surf-conditions` through the canonical chain** | **−22.8…−34.1%** on displayed height at 29 spots | **live + user-visible** (post composer autofill); calibration loop clean | ★★★★★ |
| **U2** | **Ingest `ifs/waef`; make the sim answer with a distribution** | **2–3 LEVELS** at realistic spread | ensemble CONFIRMED real | ★★★★★ |
| **U3** | **Revive the two code-graph MCPs** (or delete them from BRAIN_RULES) | 0 forecast pts | every agent silently degraded | ★★★★ |
| **U4** | **Self-invalidating descriptions** — re-derive the facts in CLAUDE.md / queue / BRAIN_RULES in CI | 0 directly; gates everything else | **65 stale commits / 90 d** | ★★★★ |
| **U5** | Close the §5 coupling (pass `break_depth_m`, or floor the gate when ref is None) | +50.9 at Cocoa in-window | window bounded 4–10 m | ★★★ |
| **U6** | v3's S1/S2/S3 (NaN→`epic` guard · pin the geometry cache key · register the 5th surface) | latent | unpinned | ★★★ |
| **U7** | Verify §4's 11 leads | unknown until checked | agent-measured only | ★★★ |

**Sequencing.** U1 first — it is a live wrong number, and the smallest targeted fix (§Weather-Sim
rule: do not rewrite; route the existing call through `estimate_surf_at`). U3+U4 next: they are cheap
and they stop the class that produced most of this report. U2 is the product event and needs the
ensemble cost measured on the 1-CPU box before commitment (the recorded `SURF_PARTITIONS` lesson:
*"precompute first, measure"*).

---

## §8 — Limits

- ✅ **RESOLVED since drafting:** `/api/surf-conditions` reachability (user-visible, §2.1) and the
  calibration-loop question (clean, §2.2).
- **UNVERIFIED:** the 11 leads in §4 — agent-measured, not re-run by me.
- **NOT MEASURED:** what fraction of stored posts carry `conditions_source='auto'` — that sizes §2's
  actual footprint and is one Supabase query.
- **RETRACTED:** all decoded ensemble metre values (§6.1). Availability/structure stands; magnitudes do not.
- **NOT MEASURED:** ensemble ingest cost on the serve box — the deciding constraint for U2.
- The adversarial-verification phase of the workflow was still running at write time; §4's leads
  carry only their originating agent's evidence.
- A concurrent session committed 9× during this audit. All findings are read from committed HEAD;
  none depend on its 8 uncommitted files.
