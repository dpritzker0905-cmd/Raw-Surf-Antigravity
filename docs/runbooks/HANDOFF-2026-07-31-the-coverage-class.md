# HANDOFF 2026-07-31 — the COVERAGE class: the halo and the direction swap are one bug shape

**Read with `START-HERE-2026-08-01-the-direction-arc.md` (the direction arc) and
[[standing-work-rules-user-mandate]] rules 9-15.** Branch `dev`. Two user-reported symptoms
investigated here; **neither is fixed** — both are measured, attributed, and localised.

---

## 0. ★★★ THE ONE SENTENCE
**Both symptoms are the same shape: a RESOURCE (land mask / grid tier) is selected without a hard
requirement that it CONTAIN the current viewport, so zooming OUT can swap in something SMALLER than
the view — and the engine already knows it, but has no path to fetch a covering one.**

## 1. THE HALO — user: "zoom out from 8.18 to 8.03 and the land band halo returns; gone again by 6.74; but zoom way out and back in and it's covered"

### MEASURED LIVE (preview, GFS/Waves, centre −80.25,28.35)
| zoom | viewport lng | mask bounds | engine verdict |
|---|---|---|---|
| **8.18** clean | −81.29 … −79.21 | **−94,12,−64,44** (30°×32°) | `reason:"off"`, overlayCoversView **true**, baseCoversView **true** |
| **8.03** halo | −81.62 … **−78.79** | **−83,26,−79,31** (4°×5°) | `reason:"coverage_gap"`, both **false**, `bounds:null` |

★★★ **THE MASK SHRANK AS THE VIEWPORT GREW.** At 8.03 the mask's east edge (**−79**) sits INSIDE
the viewport's east edge (**−78.79**), so land is no longer clipped at meter truth and the coarse
path paints the halo. Widening the view must never narrow the mask.

⚠️ **PATH-DEPENDENT — this is why it "fixes itself".** A later pass at the same z7.53/z6.74 held
mask `−84,24,−76,32` and reported `reason:"off"` (covered, no halo). The mask you get depends on
the zoom HISTORY, not the zoom. ⇒ **any repro must record the zoom PATH, and a settled screenshot
at one rung proves nothing.**

### ⛔ PRIOR ART — THIS WAS DIAGNOSED AND DEFERRED, NOT MISSED
`WebGLMarineLayer.js:881` (2026-07-18): *"...uncovered the coastal mask halo (which forensics then
pinned to the overlay-mask **coverage_gap at z<8.5**, a separate class)."* The archive memory
carries it as **"⛔ still OPEN: the halo."** The user's band (6.74-8.03) sits inside z<8.5. ⇒ this
is a **known-open class resurfacing**, not a new regression — but it is now MEASURED, which it was
not before.

### WHERE IT LIVES
`WebGLMarineEngine.js:1308-1328` composes the verdict. The engine ALREADY computes
`_overlayCoversViewport` (:811) and `_mbCov` — **it knows it does not cover.** The failure is what
happens NEXT: it falls to the coarse path instead of fetching/retaining a covering mask.
⇒ **the Jacobian variable is not the threshold, it is the ACTION ON COVERAGE FAILURE.**
Telemetry: `__RAW_GPU__.overlayMask.{on,reason,overlayCoversView,baseCoversView,bounds}` and
`__RAW_GPU__.maskId.mb`.

## 2. THE DIRECTION SWAP — user: "correct direction around 7.53, zoom out and they swap"
### MEASURED
    z8.2    cellDeg 0.25 (REGIONAL)   arrow ~87°   == the marker ✓
    z7.53   cellDeg 2    (global_mid) arrow 303.1°
    z6.74   cellDeg 2    (global_mid) arrow 303.1°
⇒ **a ~216° reversal at the tier boundary.** This is **task #7** (the footprint defect): a 2° block
near a coast is mostly open water and its energy-weighted mean lands on the OFFSHORE-moving
windsea, while the beach cell is swell-dominated. Correct math, wrong footprint — see
`memory/THE-SURFER-FACING-ANIMATION-onshore-energy-science.md` for the fix rule (rank by ONSHORE
ENERGY FLUX, exclude offshore trains).
⚠️ **Do NOT "fix" this by widening the regional tier alone** — at wide zoom a 2° cell is legitimate;
what is wrong is WHICH TRAIN it reports, not its size.

## 3. ⇒ THE FIX SHAPE (both symptoms)
1. **Coverage must be a REQUIREMENT, not an observation.** When `overlayCoversViewport` is false,
   the correct response is to fetch/keep a mask that covers — never to silently degrade. If none
   can be had, the halo must be made VISIBLY absent (no coarse paint) rather than wrong.
2. **A resource may never shrink as the viewport grows.** Assert it: `newMaskSpan >= viewportSpan`
   or keep the incumbent. This is the exact analogue of `shouldRejectResolutionDowngrade`, which
   already exists for GRIDS — **the mask lane has no equivalent guard.** ⇐ strongest lead.
3. Direction: the onshore-energy ranking (task #7), gated behind finding the partition-availability
   loss first (see the direction handoff §1).

## 4. ⚠️ HOW TO TEST THIS CLASS (it defeats the usual harness)
* **Record the zoom PATH.** Both symptoms are path-dependent; a settled rung reproduces neither
  reliably. Zoom 8.18 → 8.03 in ONE step to see the halo; a wide excursion first HIDES it.
* **Read the engine, not the pixels**, for attribution: `overlayMask.reason` names the cause
  (`off` / `coverage_gap` / `noncovering_drop` / `degraded_drop` / `world_grid` / `min_combine`).
  A screenshot tells you THAT it is wrong; `reason` tells you WHY.
* ⚠️⚠️ **Run ladders on port 3009 (`frontend-verify`), NEVER 3001** — 3001 is the preview pane's
  server and a headless ladder against it wedged the renderer unrecoverably on 2026-07-31.
* Existing instruments: `frontend/scripts/probe_marine_direction_ladder.js` (direction ∝ zoom),
  `probe_vortex_visual_ab.js` (burst + video A/B), `zoomlab.js` (coverage/clamp scenarios).
  **None of them currently record mask coverage** ⇒ the next instrument should walk a zoom PATH and
  log `overlayMask.reason` + `maskId.mb` + viewport bounds at every rung. That is ~20 lines on the
  direction ladder and it would have caught this class three sessions ago.

## 5. STATUS OF THE REST
✅ shipped tonight: partitions→rating (`7502cc4b`, flag OFF) · fabrication+laundering gated
(`81c7bcb5`) · the Canaveral vortex, BOTH mechanisms (`37b4a7ca` — `61426e3f` shipped only the
floor and the swirl survived) · LOC ratchet restored (`6cb252e9`).
⛔ open: the halo (this doc) · the direction swap / task #7 · stale resident grid on layer switch
(task #8) · no PERIOD layer (task #9) · infobox does not decompose (task #10).
### ⏳ THE ERA5 CAMPAIGN — CHECK THIS FIRST, IT MAY HAVE DIED WITH THE SESSION
Running at handoff: **pid 71096, started 22:49, ~19 h wall, 607 s CPU, 1,105 MB written ≈ 138 of
150 spots** (IO estimate — the log is unreadable, see below). It uploads **ONE inbox batch at the
very end**, so **nothing lands until it exits** and ~92 % complete is worth exactly as much as 0 %
if it dies.

⚠️⚠️ **IT IS A CHILD OF THE PREVIOUS SESSION'S SHELL AND MAY HAVE BEEN KILLED WITH IT.** First
action for the next context:

    Get-Process -Id 71096 -ErrorAction SilentlyContinue        # alive?
    # if gone, confirm whether the batch landed before re-running:
    cd backend; python scripts/era5_deepen_climatology.py --limit 150 --upload

**Re-running is always safe** — the resume filter skips spots already deepened in the blob OR
pending in the inbox, and it writes to the INBOX, never the blob (invariant 6). Nothing is lost;
you only re-pay CDS queue time for the unfinished remainder.

⚠️ **Run it with an APPEND REDIRECT, not a PowerShell pipe.** The scheduled task uses
`cmd >> <log> 2>&1` and is readable live; this session piped through `Out-File`, which buffers
until exit and made per-spot progress invisible for 19 hours (progress had to be inferred from
process IO counters).

⚠️ **CDS queueing makes this ~7× slower than the 32 s/spot the earlier research recorded** (~19 h
for 150 spots vs a predicted ~80 min). The low CPU-to-wall ratio confirms it is waiting, not
computing. ⇒ **a real planning input for the 4,000-spot expansion: at this rate the full catalogue
is weeks, so that lane needs CDS batching or a different sourcing strategy before it scales.**
⚠️ The scheduled task fires nightly at 21:30 and had `StopIfGoingOnBatteries=True` (fixed on both
tasks) — a KILLED run reads as a MISSED one; check `LastTaskResult`, not just the log.
