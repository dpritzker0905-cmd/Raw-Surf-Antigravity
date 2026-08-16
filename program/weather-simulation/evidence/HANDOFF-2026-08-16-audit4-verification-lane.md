# HANDOFF — Audit 4.0 independent-verification lane (2026-08-16, session end)

**Written so the next session can continue without rereading this one.** Branch
`claude/halo-audit31-lane`, worktree `.claude/worktrees/halo-lane`. **Three commits on top of the
pushed `7becd023`, NONE pushed:** `19e8c197` (slot-ceiling fix + planner property suite) →
`37f265bf` (AV-01a overlay truth gate, heatmap+wash) → `1d31e15b` (WS-CAN-0076 runner + armed-off
workflow) → this commit (handoff + hunt script + partial hunt evidence).
Companion docs: `AUDIT-4.0-CLAUDE-INDEPENDENT-VERIFICATION-2026-08-15.md` + `…-manifest….json`
(**UNTRACKED in the MAIN worktree** — sweep risk `aa305291`; commit them from an authorized lane).

---

## 0. THE LIVE SITUATION — owner reports, end of session

1. **"The land coastal halo is still persisting."** Received AFTER all of: the mask-family
   planner (`7becd023`), the wash min-combine, the SAFE_DEGRADED clip, AND (locally only) the
   truth gate. **Unreproduced and unattributed this session — the #1 open item.** See §2a for
   the exact disambiguation-first procedure and the Jacobian shortlist of still-fail-open faces.
2. **"You need to seed auth."** Owner instruction, recorded. Reading: the surface the owner
   watches (very likely the DEPLOYED dev alias) is auth-gated, and the harness must gain
   storage-state seeding — this is EXACTLY runbook option A
   (`docs/runbooks/RUNBOOK-2026-08-15-halo-optical-promotion-gate.md`): an owner-provisioned test
   account → one interactive Playwright login → `storageState.json` → `ZL_STORAGE_STATE=<path>`
   in zoomlab/halo-isolate/hunt. **Ask the owner for the test-account credentials or the saved
   storageState file; that unblocks the deployed-optical gate (AV-08) at the same time.**
3. **The webpack error popup is FIXED** — root cause was a stale 1.5 GB webpack persistent cache
   (`frontend/node_modules/.cache`, `default-development`) in this worktree; the two
   `om_reader_wasm.web.wasm` errors ("conflicting asset info" / "invalid weak map key") vanished
   after `rm -rf frontend/node_modules/.cache` + server restart. Post-fix compile: **1 warning, 0
   errors**. If it ever recurs: clear the cache first, only then suspect mixed-tree resolution.

**CRITICAL SURFACE FACT for interpreting the owner's halo report:** the dev alias deploys
`origin/dev` = `7becd023` — it has the planner + wash fix + clip but **NOT the truth gate**
(`37f265bf` unpushed). The local worktree server (port 3013, launch entry `frontend-halo-lane`)
has everything. If the halo shows on 3013 too, no shipped-vs-unshipped confusion exists; if only
on the alias, the truth gate is a candidate differentiator and the push/PR decision matters.

---

## 1. What this lane PROVED and SHIPPED this session (receipts committed)

| Commit | What | Proof |
|---|---|---|
| (verification, no commit) | Codex Audit 4.0's dirty-tree caveat CLOSED at unit+pixel level | 112/112 @ clean `7becd023` (=origin/dev tip); all 5 Codex hashes MATCH tracked files; 3 zoomlab populations re-derived EXACT; shaderlab rerun all-OK at `19e8c197` |
| `19e8c197` | Marine raster slots (`{waves,swell_1,swell_2,wind_waves}-slot-N-layer`) can no longer be crowned CEILING → planner/slot-batch oscillation closed; fixpoint now a 300-permutation seeded PROPERTY with a non-vacuity floor; LANDUSE_CLASS↔landuseKeywords and the 4096/340 pair both get executable cross-pins | red→green: 3/6 failed pre-fix with the exact predicted move pair; 8 suites/118 green after |
| `37f265bf` | **AV-01a OVERLAY TRUTH GATE** — `_overlayMaskTruthBox` now reaches the GPU (`resolveOverlayTruthUv` → `u_overlayTruth_*`); the overlay may speak ONLY inside its truth rect on the heatmap program (main + wash); pad-ring texels are semantically inert there; fail-open everywhere (kill `__RAW_DISABLE_OVERLAY_TRUTH_GATE__`, identity check for the baseCrispMask fallback, GL zero-default) | shaderlab S8 red (ring paints, content-flip moves ALL 262,144 px) → green (ring silent, diff CONTAINED [58,62,453,447], non-vacuity control); committed `evidence/shaderlab-2026-08-16/truth-gate-{red-pregate,green}/`; 9 suites/133 tests; engine ratchet EXACTLY 3207; **live-sighted**: `overlayTruthGate {enabled:true, min:[0.25,…], max:[0.75,…], locationActive:true}` — the 50%-pad arithmetic confirms itself |
| `1d31e15b` | **WS-CAN-0076 RUNNER** (`backend/scripts/run_nearshore_validation.py`) + armed-off hourly workflow (`nearshore-validation.yml`) + 5 tests; exit contract 0/1/2 (int only), 404-vs-infra discrimination, spot-hours vs STATION-hours honesty, no .env | first full graded cycle committed (`evidence/scientific-validation/nearshore-first-graded-run-2026-08-16.json`): live 7 / dead404 13 / infra 0, 17 spot-hours = 7 station-hours, wall 5.9 s, **bias NEGATIVE at all 7 stations (−0.03…−0.42 m)** — accrue, do NOT tune from one cycle |
| this commit | mount-permutation-hunt script + 2 captured BAD permutations (partial) | §2c |

Also live-sighted on the running app this session: `washOverlayMode {replace:false,
baseGlobalDense:true}`, planner repairing a naturally-broken mount (`maskFamilyOrder {moved:2,
ceiling:'waterway'}` — a real basemap ceiling, not a slot), realized family subsequence canonical
with a legal landuse interleave.

---

## 2. OPEN IN THIS CONTEXT — each with the exact next action

### 2a. THE PERSISTING HALO (owner-reported; unattributed) — do this FIRST
1. **Disambiguate the surface**: ask/have the owner confirm WHERE (dev alias vs local). In
   parallel, reproduce locally: server `preview_start {name:"frontend-halo-lane"}` (port 3013;
   entry added to `.claude/launch.json` this session — **that edit is uncommitted in the MAIN
   repo**), then drive the historical band: center `[-80.2, 28.33]`, the z 6.7→8.3 ladder, 60 s+
   settle discipline, light AND beach themes (light hid it before).
2. **Read the six telemetry channels at the band before any lever**: `coverageTerminal`,
   `heatmapGate.{resident,coarse}` (gate/clip values + location activity), `overlayMask`
   (`on` vs `reason` — the `ovlOn` trap), `washOverlayMode`, `overlayTruthGate`,
   `maskFamilyOrder`. They name which defenses are even engaged in the frames that show the band.
3. **Jacobian shortlist of faces still fail-open (in priority order):**
   - **Particles/crests (AV-04, untouched by design)**: draw+advect consult NO coverage state and
     NO truth gate; survival is edge-texel-content-dependent (P2/P3, clean-SHA proven). Crest
     dashes over coastal land ARE a halo face. Lever: crest kill (`__RAW_CREST_LAND_THRESH__=9`)
     A/B at the band.
   - **Style `ocean-mask-buffer` band (H4's LAST LEG — never captured live)**: canonical order
     deliberately keeps buffer above the field; if its styling reads as "a halo around coastal
     areas," that is a STYLE question, not a GPU one. Lever:
     `map.setLayoutProperty('ocean-mask-buffer','visibility','none')` A/B (halo-isolate leg L5
     pattern).
   - **Base-mask CLAMP flood outside the terminal state**: the clip fires ONLY in
     `retry_exhausted` with `__mb` identity; unknown/retry/covered render fail-open. A wrong-but-
     covering mask has NO defense.
   - **Legacy-1024 wash REPLACE**: `resolveWashOverlayMode` needs width ≥4096 for min-combine; if
     the wash's own mask at the band is the 1024 legacy world mask, REPLACE persists BY DESIGN.
     Check `washOverlayMode` + `maskId {dims}` at the band.
   - **Truth-gate open cases**: baseCrispMask fallback and any non-viewport overlay leave the
     gate open (correct fail-open, but the ring can speak in those frames).
   - **Not on the shipped alias at all**: the truth gate itself (`37f265bf` unpushed).
4. Only after a lever isolates the face: symptom-specific fix, with a shaderlab/live A/B pair.

### 2b. COMMIT ARCHAEOLOGY (owner-requested this session; NOT STARTED)
Build the full halo regression↔fix timeline with a Jacobian column (which input dimension each
fix changed, which face it silenced, whether later refuted). Commands:
`git log --all -i --grep="halo" --oneline` · `git log --all -i --grep="mask\|overlay\|coast" --oneline` ·
`git log -S "CLAMP_TO_EDGE" --oneline` · `-S "u_dataMaskGate"` · `-S "overlayBasemapWaterOnMask"` ·
`-S "_overlayMaskBounds"` · `-S "repositionLanduse"`. Known anchors to seed the table: `25fd7c18`
(gate fix whose mechanism was REFUTED 08-15 — pixel-inert), the 2026-07-04 overlay/wash REPLACE
introduction, 2026-07-15 `computeWideOverlayMode` dense-base, 2026-07-17 inland ORDER PIN,
2026-07-21 gate + SDF, `f3fe2c85` (WS-CAN-0061 insertion point), `e88b0f68` (anchor refusal),
`aa026f7f→7becd023` (this arc), `37f265bf` (truth gate). Deliverable: a table in evidence/ +
which faces have NEVER had a closing fix (expect: particles, style-buffer styling, base-clamp
outside terminal).

### 2c. THE MOUNT-PERMUTATION HUNT (AV-05) — interrupted, partial yield preserved
- Script: `frontend/scripts/mount-permutation-hunt.js` (committed this commit). Run:
  `node scripts/mount-permutation-hunt.js <outdir>` with the 3013 server up; ~24 trials ≈ 25-40
  min; it was killed by the session exit after ~3 trials.
- **Partial yield (committed, `evidence/mount-hunt-2026-08-16-partial/`): 2 unique BAD
  permutations from natural mount variance with the planner disabled** — both the
  lakes/rivers/parks-under-fill class (`inland_water<fill`, `inland_waterway<fill`,
  `landuse<fill`, `national-park<fill`, `waterway<fill`), i.e. the owner's 08-15 symptom
  reproduced live. **In NEITHER do buildings/roads sit below the fill** — Codex's MC4-05
  objection stands; buildings attribution still needs either a rarer permutation, the
  pass-isolation legs at a BAD permutation (leg list in the audit report §6), or a non-z-order
  mechanism (paint/opacity mutation, contrast loss).
- Remaining: finish the hunt (incl. the planner-ON control phase: pass = exactly one permutation
  hash + `moved:0`), then the leg ladder if any buildings-below-fill permutation appears.
- If run against a DEPLOYED alias: needs the auth seeding from §0.2.

### 2d. Smaller opens created or left this session
- **zoomlab live ladder on the truth-gate build** (the AV-01a live leg): not run. Command in
  AUDIT-3.1 §Still-open #1, against 3013.
- **`.claude/launch.json`** in the MAIN repo: modified (added `frontend-halo-lane`, port 3013),
  uncommitted — commit or revert deliberately, don't let it ride into someone else's commit.
- **Main-repo untracked deliverables** (audit report + manifest): commit from an authorized lane.
- **MEMORY.md** compacted 21.3→19.6 KB; harness hook wants ≤17.1 KB; its own governance says 18.
  The remaining cut needs a downstream-coverage-verified pass (rules in INDEX-defect-classes.md).
- **ESLint warning** `createTexture` unused in the engine (pre-existing, 3rd of the original 3).
- **`marineCoverageContract.test.js:152`** hardcodes the managed-uniform census (`toBe(2)`) — I
  did NOT touch it; my setter caches its own locations so the number is still 2, but the exact-
  count assertion is the documented census defect shape.
- **Hunt screenshots pre-cache-clear**: the first 2 perm PNGs were captured while the wasm
  overlay existed — the script removes full-viewport iframes, so they are clean, but re-verify
  before using them as optical evidence.

---

## 3. OPEN FROM PREVIOUS CONTEXTS (the deep dig — verified sources)

**Rendering / mask family:**
- **AV-04 / MC4-07 — particles**: no coverage-state, no truth gate, no clip in draw/advect;
  edge-texel-content-dependent survival. Needs its own design (ribbon endpoints re-sample the
  mask; ring-fill adds a second bounds pair). The likeliest unclosed halo face.
- **AV-10 / MC4-02 — no INVALID state anywhere**: RGBA8 `.r` 0/64/255; all masks
  CLAMP_TO_EDGE+LINEAR, base samples unguarded. Phase: validity channel (`.a` is free) or NEAREST
  validity texture + 1-texel INVALID border.
- **MC4-05 — buildings/roads pass attribution** (§2c).
- **MC4-08 — no deploy-grade optical/GPU matrix**: SwiftShader-only. Blocked on auth (§0.2) —
  which the owner may have just unblocked.
- **MC4-03 residue**: the 4096/340 literals still live in 3 source copies (now behaviorally
  cross-pinned at `19e8c197`, deletable only after AV-01 covers the wash fully + parity).
- **AV-06**: `scripts/layer-order-probe.js` still uses the custom-layer-blind `getStyle().layers`
  + a 3-term landuse regex; `repositionLanduse`'s landuse-raising arm is dead code under the
  canonical order; `mapUtils.js:438-441` duplicates STRUCTURAL semantics.
- **AV-07 / MC4-12 — flag combinatorics**: 20+ mask/wash/coverage kills, untested pairs;
  `__RAW_DOWNGRADE_COVER_FRAC__` one lever with per-site defaults 0.6 (6 sites) vs 0.8 (3);
  `__RAW_DISABLE_MASK_DELIVERED_COVER__` silently collapses the machine; a totally-failing
  planner is silent except a stale breadcrumb.
- **Fog blank at the 2 widest zooms** (pre-existing queue item, untouched).
- **Antimeridian**: `resolveDeliveredCoverage` wrap-naive (untested either way); dispose nulls
  bounds but not the truth box.

**Science / forecast:**
- **Arm the nearshore lane**: needs `19e8c197..` merged to `dev` (default branch) for the cron to
  exist, then repo var `NEARSHORE_VAL_ENABLED=1` (owner). Until then: manual dispatch only.
  **Pair-table hard-refusal clock: ~2026-11-13** (90 days from 08-15; warn starts at 75).
- **Partitions are ingested but flag-dark everywhere** (`SURF_PARTITIONS=0` in all three lanes;
  `ECMWF_PERIOD_BANDS` off) — flip only with ledger evidence, all lanes together.
- **Ensemble**: only ECMWF waef swh ×5 members feeding a self-declared-uncalibrated
  `forecast_confidence`.
- **Band/glyph two-populations (QUEUE E#1)**: band reads 2.3-2.7× ABOVE glyph, per-cell
  composition is the cause, sub-term not isolated — **tune neither lane**; dead zone 9.5-40°
  is an owner call (`__RAW_RATING_SPAN_FADE_HI__=40`).
- **Mid-range height still reads high** (uncancelled input-compression error; ERA5-gated).
- **L-2 second half**: `local_size_gonogo.py` raises `SystemExit("<string>")` at 5 infra sites
  (:99,:105,:113,:121,:158) — exit 1 masquerading as a calibration verdict. My runner implements
  the correct contract; the census script itself is still wrong. One-line-per-site fix.
- **`python-upgrade-readiness`**: never executed, 6× `continue-on-error: true` — make it run or
  retire it (the one item the 08-14 census produced).
- **WS-CAN-0017 remaining links** (end-to-end checksum, re-validation on restore); **WS-CAN-0029**
  (freshness_sec).
- **Skill gate arms 2026-08-22** (accuracy pages the owner; +24h deficit had WIDENED, "narrowing"
  refuted). **Heartbeat URL · cross-fall sampling · ft/m infobox** — standing clocks.
- **3 scheduled lanes red with CORRECT gates** (parity=tide waiver · census=ERA5 ordering ·
  zoomlab=coverage-arrival race) — do not widen any of them.

**Owner-decision queue (consolidated):**
1. **Auth/test account for the optical gate** (§0.2 — possibly just granted in spirit).
2. **Push/PR decision for `19e8c197`+`37f265bf`+`1d31e15b`+this commit** — the lane PR is open;
   pushing the branch updates it; merging deploys the backend (runner + workflow) and arms
   nothing (workflow is armed-off). ⚠️ Every push to `dev` itself is a production backend deploy.
3. `NEARSHORE_VAL_ENABLED=1` repo variable (after merge).
4. `SURF_CAP_SEAM_MONOTONE` flip — three lanes together, with the census (MC-01/WS-CAN-0072).
5. Production frontend unfreeze (**WS-CAN-0039**) — still the largest single derivative on the
   board; `dev→main` PR #8 was open and a promotion PR was in flight this session (CI green).
6. Floors from CI's post-push reading (D-5). 7. `run_time` display half stays blocked by
   WS-CAN-0005's staged plan (owner-facing steps 3-4). 8. Band-fade dead zone. 9. Rotate the
   `BRAIN_RULES.md` committed API key. 10. Prod-DB seeded `dev-mock-user-id` admin row; unfreeze
   prod Netlify.

**Environment hazards for the next session (unchanged but re-verified this session):**
concurrent sessions share the main tree and `dev` (`git commit -o <paths>` only; a push ships
EVERYONE's commits); `gracious-cannon` worktree is dirty with another lane's backend work — do
not touch; forecast-cache JSONs in the main tree are not ours, never stage; local python is
3.14 vs CI/prod 3.12 (banner prints on every pytest run — believe it); Windows stdout is cp1252
(ASCII-only prints); `trevec`/codebase-memory never self-refresh (pair misses with a positive
control).

---

## 4. Recommended order for the next session (Jacobian-ranked)

1. **§2a halo attribution** — it is the owner-visible defect and every lever + telemetry channel
   is already built. Expect particles or the style buffer.
2. **§2b archaeology table** — cheap, owner-requested, and it will name any face that has never
   had a closing fix (input to 1).
3. **Auth seeding** (owner-provided storageState) → deployed-alias leg of 1 + optical gate.
4. **Finish the hunt + control phase** (§2c); pass-isolation legs if a buildings-below-fill
   permutation ever appears.
5. **AV-04 particle validity adoption** (likeliest true fix for 1; design constraints already
   written down).
6. Merge/arm decisions (owner) → nearshore accrual starts counting.

*Everything in §1 is proven and committed on the lane branch; nothing this session pushed,
deployed, or touched `dev`/`main`/another lane's files.*
