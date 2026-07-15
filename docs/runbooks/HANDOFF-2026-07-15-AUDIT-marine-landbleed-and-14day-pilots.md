# HANDOFF + HARD AUDIT — 2026-07-15 — marine land-bleed + 14-day fine pilots

**For a fresh context.** This is an *audited* handoff: every plan below was re-verified against the
code (forensics), against external best practice (how earth.nullschool / Windy / the wave models
actually work), and through the Jacobian lens (which coupled root has the leverage). Two of my own
prior plans were found **wrong or incomplete** by the audit — that's the point of the exercise; they
are corrected here. dev HEAD at write ≈ `b373672b`, all pushed, Netlify+Render redeploying.

---

## 0. SHIPPED THIS SESSION (all verified; these HOLD UP under audit)

| Commit | What | How verified | Audit verdict |
|---|---|---|---|
| `2f2f1bb4` | `__SHARPEN_TRACE__` instrument + live-tunable SWR ladder (byte-identical default) | FE tests; inert | ✅ sound (no behavior change) |
| `df6bc189` | **Root A** — resolver Step-1&2 drops a stale coarse dynamic-cache tile when a finer covering regional exists (redirect-to-fine, NOT §0n reject→global_mid) | live curl on Render | ✅ sound |
| `7696f0dc` | **Band loads on toggle** — flavor-mismatch added to `bypassDedupe` (surf toggle fired 0 fetches before) | **live dev map**: band paints ~1.4s, 0 idle spin | ✅ sound |
| `70d062a4` | **Revert Root B** — the 15→22° mid-ceiling; its own mid tile floated as the zoom-out RECTANGLE | **live dev map**: reproduced the rectangle with the flag, gone at default | ✅ sound (revert of my own regression) |
| `b373672b` | **14-day fine pilots Phase 1** — GFS flagship coasts (FL/SoCal) 8d→14d, worldwide stays 8d | backend tests; horizons externally verified (below) | ✅ sound |

**REVERTED (my regression, do not resurrect):** lowering the coarse-crest suppression zoom-floor
7.0→0.0 to kill the land-bleed. It suppressed ALL zoomed-out crests → killed the animated field the
user tuned. See §2 for why suppression is the wrong layer.

---

## 1. THE HARNESS (use it — this was the session's real unlock)

Local `frontend-live` (localhost:3001) → `AuthContext.js:34` auto-creates a mock admin user in
`NODE_ENV=development`, so `/map` boots authenticated and points at the **Render backend for real
data**. Drive with the Browser pane; `window.map` / `__MARINE_ENGINE__` / `__RAW_FORENSIC__` /
`__SHARPEN_TRACE__` all present. ⚠️ dev bundle is CODE-SPLIT (marine fetcher in `…MapPage…chunk.js`,
not bundle.js); HMR unreliable for hook/engine modules → **hard-navigate after each edit**. ⚠️ ALWAYS
check `_waveData.waveGrid.hourOffset` before judging resolution — a stale scrubber at hour 60 mimics a
coarse-serving bug (it cost me a whole detour: at hour 0 ICON serves fine `13x17` 0.235° with correct
onshore direction; ICON's "coarse" was the scrubber past its 7-day fine horizon, not a bug).

---

## 2. AUDIT — CREST LAND-BLEED ON ZOOM-OUT (crests over continents)

### 2a. External best practice (proof we're not the first)
- **earth.nullschool / cambecc/earth** (the canonical GPU flow-particle map): the land mask is
  **re-rendered for the CURRENT view/projection at display resolution, every time the view changes** —
  it never reuses a stale mask. (Confirmed from the repo docs.)
- **Mapbox `webgl-wind`** (Agafonkin, the technique Raw-Surf descends from): particles reset/fade in
  **zero-velocity (no-data = land)** cells — data-value masking. Adequate only when the data grid
  resolves the coast.
- **Windy** masks waves to ocean per-view — and has its OWN "waves on land" forum reports, i.e. this
  is a genuinely hard problem even for the leader.
- **Takeaway:** the industry answer is *one mask, regenerated for the actual view*. Raw-Surf's bug is
  precisely the opposite — a stale REGIONAL mask reused at a GLOBAL view.

### 2b. Forensic root (proven in code + live)
At a global view the resident is coarse-global (37×17, ~9.73°/cell). The crest draw program binds
unit-4 to `overlayOn ? _overlayMaskTex : u_oceanMaskTexture` (`WebGLMarineEngine.js:1797`; heatmap
same at `:1552`). Live-proven: after a zoom-out the **viewport-truth overlay stays pinned to the last
regional viewport** (`_overlayMaskBounds` stuck at `-98,-44` while the viewport is the whole world),
so `overlayOn` stays **true**. In the shader the overlay is sampled only INSIDE `u_overlayBounds`;
OUTSIDE it, crests fall back to the coarse **37×17 grid dataMask** with `u_crestLandThreshold=0.5` →
particles survive in partial-water coastal cells → bleed over every continent. The heatmap COLOR uses
the same mask but bilinear-interpolates + fades, so it reads clean; the **discrete bright crests
bleed**. Clean-inside-box / bleed-outside — the exact live pattern. Also note: **there are NO Mapbox
custom layers in the style** — the marine WebGL renders on its own canvas ON TOP, so the OceanMask
FILL layer does not clip the crests (it's not in their compositing path).

Why the mask is stale: the **"MASK NO-DOWNGRADE RETAIN" guard** (`WebGLMarineTextureEncoder.js:
627-649`) deliberately keeps the dense regional base mask rather than rebuild a lower-density global
one (`cachedDensity > incomingDensity*1.5`). It exists to stop a mid-tier mask from replacing a crisp
fine mask mid-transition (the Bahamas / FL-z9 "waves over land" regressions — span<8). It optimizes
the close-zoom transition at the COST of the global-zoom bleed.

### 2c. ⚠️ AUDIT CORRECTION — my prior one-line fix was INCOMPLETE
My earlier note said "rebuild the base mask for global-span commits." **That alone does not work:**
the crests use the **overlay** (overlayOn=true), not the base `u_oceanMaskTexture`, so a fresh global
base mask is never sampled outside the overlay box. The real fix is **two coordinated changes, both
scoped to a coarse-global / global-span resident**:
  1. **Drop the stale overlay at global zoom** — force `overlayOn=false` (or clear `_overlayMaskBounds`)
     when the overlay does not cover the current viewport AND the resident is coarse-global, so the
     crests fall back to the base `u_oceanMaskTexture`.
  2. **Rebuild that base mask for global bounds** — a global-span (≥350°) exception to the no-downgrade
     retain (`:627-649`), so `u_oceanMaskTexture` covers the world (4096×2048 ≈ 10 km/texel — resolves
     continents; it need not resolve islands at a global view).
This is the earth.nullschool model (one view-scoped mask) applied within Raw-Surf's tiered system.

### 2d. Jacobian + risk verdict
Raw-Surf has THREE mask mechanisms (grid dataMask, base `_cachedMaskTex`, overlay `_overlayMaskTex`)
plus retain guards — all viewport/regional-scoped; the global-zoom case falls through all three. The
COMPLEXITY is the fragility. The `WebGLMarineTextureEncoder.js` retain block is the single most
regression-prone code in the app (its comments are a graveyard: Bahamas, FL z9-10.5, island-halo).
**The global-span exception is DISJOINT from those (they're span<8), so the scoped fix is low-collision
— but it MUST be verified at the FL/Bahamas close zooms + the mid→coarse transition, on the harness,
before commit.** Suppressing crests (my reverted attempt) treated the symptom at the wrong Jacobian
layer; the mask is the true variable. **Recommended:** do the 2-part scoped fix as a dedicated pass,
kill-switched, visually A/B'd at global + FL-close + mid-zoom + a mid-ocean (no-land) view.

---

## 3. AUDIT — 14-DAY FINE PILOTS

### 3a. Upstream horizons (externally verified — my ceilings were CORRECT)
- **GFS-Wave (NCEP):** hourly→120h, 3-hourly→**384h = 16 d**, 0.25°. (polar.ncep.noaa.gov)
- **DWD ICON GWAM:** **T+174h ≈ 7.25 d**, 0.25° (~28 km), 3-hourly. (dwd.de / metcheck GWAM 6-172hr)
- **ECMWF wave (IFS):** **240h = 10 d**. (windy.app / ECMWF)
So native fine to 14 d is **GFS-only**; ICON caps at 7 d, EURO at 10 d. Phase-1 (GFS flagship→14d) is
correct and sits inside the GFS ceiling. ✅

### 3b. ⚠️ AUDIT CORRECTION — do NOT fabricate an "estimated 0.25° tail"
My prior plan proposed an "estimated ICON 0.25° extension (persistence/blend)" to reach 14 d. Two
reasons to change course:
  - **Data-truth ethos:** inventing fine-scale (0.25°) detail 7 days past a model's skill is exactly
    the kind of fake truth the app's provenance HUD ("AUTHORITATIVE NATIVE" / "No Causal Layer
    Violations") exists to prevent. The coarse/mid estimated tails are defensible (coarse detail);
    fabricated FINE detail is not.
  - **Best practice** (research): the operational answer to "beyond a model's horizon" is **switch to /
    blend a model that natively covers it** — ECMWF-Mixed (what Windy Premium serves) blends ECMWF +
    25 models with bias correction to 14 d. The honest analogue here: for the ICON-7→14d and
    EURO-10→14d tail, **serve GFS's REAL native fine tiles (16 d) rather than an estimated same-model
    persistence.** This is simpler, honest, and matches the industry pattern.
**Revised Phase 2:** when the selected model's fine horizon is exceeded, fall the fine lane to **GFS
native fine** (labelled as such in provenance) — not a fabricated tail. Only if GFS also lacks it do
you drop to the honest coarse/mid tier.

### 3c. Phase-1.5 — ICON/EURO flagship (the multi-bbox constraint, unshipped)
ICON/EURO pilots use ONE whole-globe multi-bbox download per cycle (`fetch_{icon,euro}_marine_regions
(get_all_pilot_regions(),…)`) — all 10 regions share one horizon. Flagship-first there needs per-region
SAVE truncation (there is no `max_hours` param in `normalize_and_save_loop` today) OR a second
flagship-only fetch, else raising to native (7/10d) pushes all 10 regions and risks the ~165-min CI
budget. Helpers `is_flagship_pilot_region` / `flagship_pilot_days` (scheduler_helpers.py) are in place;
wire ICON→7d-flagship / EURO→10d-flagship via a truncation cap on `normalize_and_save_loop`. Verify a
real cron cycle's wall-time before widening worldwide.

---

## 4. OPEN BOARD (prioritized for long-term stability + success)

1. **Crest land-bleed — the 2-part scoped mask fix (§2c).** Highest user-visible value; medium risk
   (the retain minefield, but the global-span exception is disjoint from the known regressions).
   Do it on the harness with the A/B checklist in §2d; kill-switched.
2. **14-day pilots Phase 2 = GFS-native-fine tail (§3b)**, NOT a fabricated estimate. Then ICON/EURO
   flagship via multi-bbox truncation (§3c).
3. **Verify the GFS flagship→14d cron wall-time** on the next real cycle (`b373672b` is env-dialable
   via `GFS_MARINE_FLAGSHIP_FORECAST_DAYS` if it runs long).
4. Deferred from before: the SWR-ladder default flip (needs a live `sharpenMs` measurement via
   `__SHARPEN_TRACE__`); a11y panels keyboard; BOLA; public-bucket security debt.

---

## 5. STANDING LESSONS RE-CONFIRMED THIS SESSION
- **Verify on the rendered map, not just units/curl.** The rectangle, the band-toggle, and my crest
  regression were all only visible on the live map.
- **Fix the ROOT layer, not the symptom.** Suppressing crests (symptom) regressed; the mask (root) is
  the variable. The Jacobian lens names the right variable.
- **The mask/particle/retain system is the app's fragility core.** Every change there needs a
  multi-zoom visual A/B (global + close-FL + mid + mid-ocean) before commit.
- **Match the industry when you can** (earth.nullschool = one view-scoped mask; ECMWF-Mixed = blend
  real models, don't fabricate). We're not the first weather map.

## 6. REFERENCES (external, this audit)
- earth.nullschool source + mask approach — github.com/cambecc/earth ; earth.nullschool.net
- Mapbox WebGL wind particles (the canonical technique) — blog.mapbox.com/how-i-built-a-wind-map-with-webgl ; github.com/mapbox/webgl-wind
- Windy "waves on land" + particle contrast threads — community.windy.com
- GFS-Wave horizon/res — polar.ncep.noaa.gov/waves ; emc.ncep.noaa.gov wavemodels
- DWD ICON GWAM (T+174h, 0.25°) — dwd.de ICON wave legend ; metcheck GWAM
- ECMWF wave 240h / model-blend for extended range — windy.app ; ecmwf.int forecast-skill-horizon
- WebGL mask/filter best practices — MDN WebGL_best_practices ; webgl2fundamentals
