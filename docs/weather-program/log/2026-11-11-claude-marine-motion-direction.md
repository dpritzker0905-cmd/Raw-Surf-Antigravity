# 2026-11-11 · claude-marine-motion-direction · why the marine animations look like they oppose each other

Owner report (David, 2026-11-11, relayed by the coordinating session): "I'm seeing opposing wave animations in all the marine
layers, unless that is part of the animation's design, to create a moving effect?"

Scope: diagnosis only. No shader, encoder, flag or served number changed. Evidence is the shader text at `dev` `472b384f7`,
one offline Jest suite (`frontend/src/components/map/marineMotionDirection.test.js`, 36 tests, all green), and one offline
normalizer probe (synthetic points, backend venv; no network). No live backend call. Researcher's evidence base and checklist:
PR #786, `log/2026-11-11-haiku-marine-motion-evidence.md` (+ addendum `2ac746e86`). Census of `WAVES_ANIM_DOMINANT_SWELL`: PR #792
(Opus lead), cited, not re-run here.

## Verdict

**Not a sign error. The direction chain is correct for every source and layer: crests, bands, foam and drift all travel toward
FROM + 180°.** What reads as opposing motion is **by design, but it reads badly**. The orbital pitch (`__RAW_ORBITAL_PITCH__` = 2.5 px,
on by default since 2026-07-01) sways each dash forward under a crest and backward under a trough. The dash's own drift is only
0.03-0.5 px/s, smaller than the sway's 0.7-2 px/s peak. So at any moment about 41-49% of the dashes on screen are moving against
the swell, beside the bright ones moving with it. This happens in every marine layer, because it is engine-level. A second,
smaller cause is real physics and affects only the `waves` layer. With `WAVES_ANIM_DOMINANT_SWELL` = 1 (the repo variable since
2026-07-13), that layer follows the dominant swell partition wherever it carries ≥ 35% of the energy. Elsewhere it keeps the
total direction. So neighbouring cells can show different directions (PR #792: median turn 6°, p90 33°, max 130°), and this
layer can differ from `wind_waves` over the same water. This cannot explain "all layers": `swell_1`, `swell_2` and `wind_waves`
are untouched by the flag.

## 1. Every moving element (shader math as written)

Notation: `p` = Mercator position (x east, **y south**), `dir` = the decoded heading after `waveVec.y = -waveVec.y`, `m` =
`u_motion_scale` (0.56 at z ≤ 3 → 1.0 at z ≥ 7), `θ_j` = the CPU-integrated class phase, `θ_j += m·dt / max(2, T_j)`, dt
clamped to 0.25 s (`crestLocalPhase.stepCrestPhase`).

| # | Element (file) | Math | Driving field | Convention | Screen direction for FROM 270° (expect: east) | Intended? |
|---|---|---|---|---|---|---|
| 1 | Dash drift (ADVECT_FS + RK2 midpoint) | `offset = waveVec·min(H,3)·0.1/cos(lat)·u_speed_scale·boost`; `pos += offset` per **frame** | the layer's u/v (texture RG), height | u/v = toward (−h sin d, −h cos d); y negated for Mercator | **east** ✓ (test §3) | yes; slow: 0.03 px/s at z3, 0.35-0.54 px/s at z ≥ 6 |
| 2 | Dash orientation (DRAW_VS) | `pixelDelta = (dir.x·M0 + dir.y·M1)·viewport`; the quad's long axis is ⟂ `waveDir` | same u/v | same | dash ⟂ east, leading side east ✓ | yes |
| 3 | Heading jitter (DRAW_VS) | static per-dash rotation ±0.26 rad (±15°) | particle hash | – | east ±15°, never reversed ✓ | yes (breaks the lattice) |
| 4 | Wave-train band / period cue (DRAW_VS, `crestLocalPhase.js`, ON) | `band = 1 − smoothstep(0.08, 0.30, |fract(s·F_j − θ_j) − 0.5|)`, `s = (p − c)·dir0`; alpha × mix(0.25, 1, band) | u/v + peak period T (bank 4-22.6 s), `F ∝ 1/T²` | crest = fixed phase, θ grows ⇒ s grows ⇒ moves +dir | **east** ✓ (test §3: phase falls with time, rises along +dir, 8 frames each, all four compass points) | yes; 8-19 px/s; speed ∝ T (the period cue) |
| 5 | Foam roll (DRAW_FS) | `rollFront = fract(v_phase)`, `waveLocal = −acrossCrest·0.5 + 0.5`; front at waveLocal = rollFront | band phase | v_phase falls ⇒ front moves to +acrossCrest = +waveDir (fixed 2026-06-29) | **east** ✓ | yes |
| 6 | **Orbital pitch (DRAW_VS)** | `pixel0 += waveDir · sin(2π·phase) · 2.5 px · dpr` | band phase | velocity ∝ −cos(2π·phase): **+ under the crest (phase 0.5), − under the trough (phase 0)** | **east under bright crests, WEST under dim troughs** | by design (water orbit) — **the counter-motion** |
| 7 | Foam-noise scroll (DRAW_FS) | `foamNoise(alongCrest·8 − v_phase·0.3, …)` | band phase | along the crest (sideways) | north/south shimmer inside the dash | yes; lateral, not opposing |
| 8 | Rating-band shimmer (HEATMAP_FS, surf mode only) | `0.05·sin(520(x+y) − 1.4t) + 0.03·sin(900y + 0.9t)` | none (time only) | ripple 1 travels SE, ripple 2 travels N: 135° apart | independent of the swell | decorative; does counter-move, but only in the rating band |
| 9 | Heatmap wash | static per frame (directional lighting is a fixed NW light) | – | – | none | – |

Dark, light and beach use the same DRAW_VS/ADVECT_FS math. Theme changes only colours (DRAW_FS palette branches), so the
directions above hold in every theme. Desktop and mobile share the same shaders.

## 2. Physics conventions (checklist items 1, 2, 13)

- **Sources.** GFS-Wave (WVDIR/SWDIR/DIRPW), ECMWF (`mwd`), DWD GWAM/ICON (`mwd`/`mdts`/`mdww`) and Copernicus
  (`VMDR`, `VMDR_SW1/SW2/WW`) are all read as raw degrees. No source applies a 180° offset anywhere on the decode path: `grep`
  found no `+ 180` on any direction in the fetchers or the normalizer. Every builder of u/v uses the one formula
  `u = −h sin d, v = −h cos d` (d = FROM): `normalizer.py` (all layers and partitions), `consensus_product.py`,
  `far_edge_bridge.py`, `estimator.py`, and both client fallbacks (`WebGLMarineTextureEncoder.js`, `marineFramePack.js`).
  Pinned by text in test §1. The offline harness's synthetic store is the only `+h sin d` writer. The binary frame carries that
  as `uv_convention` 1, and the client honours it (`marineFramePack`: `sign = uvConvention === 1 ? 1 : −1`).
- **Checked against an independent FROM reference, not by rule.** This answers the researcher's H1/H2 ("check the decoder offset
  against metadata"). I did not open the GRIB/netCDF attributes this session. But NDBC buoy MWD is FROM by definition, and the
  program's live buoy skill grades our served direction against it: direction MAE 24.1° GFS, 23.7° EURO, 28.1° ICON at +24 h,
  n ≈ 2,100-2,400 per lane (SCOREBOARD row 2026-10-17 23:20Z). A reversed source would score ~150°+. So GFS, EURO and ICON are
  empirically FROM, applied once. **Copernicus is not in that skill lane: OPEN.** Its CF standard name
  `sea_surface_wave_from_direction` (researcher, PUM snippet) agrees with the code's FROM treatment. Only a buoy-graded row would
  close it.
- **Per partition.** `swell_1`, `swell_2` and `wind_waves` are separate normalizer products. Each stamps its own partition's
  direction with the same formula.
- **Wrap and missing.** FROM 360 and 359.99 pack bytes identical to FROM 0. FROM 45 travels SW and FROM 225 travels NE (test §2).
  **Finding (characterised, not fixed):** in `packStaticFrame`, a NaN direction on a valid height packs as FROM 0 (travels
  south). It is reachable only when the frame's direction plane is absent, because the u16 direction plane has no missing code.
  It is not the owner's symptom. Spread: the shader has no directional-spread term beyond the ±15° jitter.
- **Screen.** Mercator y grows south, and the decode negates the geographic v once per pass: advect, draw, and the RK2
  midpoint (pinned). A north-up camera then maps FROM 270 to +x (east), FROM 0 to south, FROM 90 to west and FROM 180 to north on
  screen (test §3).

## 3. Bug vs design vs perception

| Hypothesis | Result |
|---|---|
| H1 FROM used as TO | **Rejected.** Every path converts FROM to toward once (test §1-3; buoy MAE ~24°). |
| H2 180° applied twice / never | **Rejected** for GFS, EURO and ICON (buoy-graded). Copernicus: no offset in code, CF name FROM; buoy row OPEN. |
| H3 aliasing / wagon-wheel | **Rejected for playback.** Band step per frame = m·dt/T ≤ 0.25/4 = 1/16 of a set, even at the 0.25 s clamp and the shortest class. The drift and sway steps are sub-pixel. On scrub, the band phase is recomputed from θ (bounded), not advected through hours. |
| H4 a texture not advected by the field | **Partly.** Foam noise scrolls sideways along the crest. The rating shimmer (surf mode) runs two ripples 135° apart, unrelated to the swell. Neither is "all layers". |
| H5 partition mismatch | **Contributes in `waves` only:** `WAVES_ANIM_DOMINANT_SWELL` = 1. The probe below shows the stamp keeps the correct sign. The disagreement is between fields, and between stamped and unstamped neighbours. |
| H6 c vs c_g | Speeds, not directions. Bands are the crest motion: c-like, ∝ T via `waveSetFreq`. Dashes drift at a height-capped rate that is neither c_g nor Stokes drift. See checklist 6. |
| **Orbital pitch counter-motion** | **The cause in every layer.** Characterised in test §4. |

Numbers (test §4, `MOTION_TABLE=1`; CSS px/s at 60 fps; a 1400 px wide view):

| z | T s | H m | lat | dash drift | sway peak | band | share of cycle a dash moves backward |
|---|---|---|---|---|---|---|---|
| 3 | 12 | 2 | 35 | 0.027 | 0.74 | 7.9 | 0.49 |
| 6 | 12 | 2 | 35 | 0.352 | 1.22 | 13.1 | 0.41 |
| 9 | 12 | 2 | 35 | 0.377 | 1.31 | 14.0 | 0.41 |
| 9 | 8 | 3 | 20 | 0.541 | 1.96 | 9.3 | 0.41 |
| 12 | 16 | 1.5 | 35 | 0.273 | 0.98 | 18.7 | 0.41 |

The drift is per frame and the sway per second, so at 30 fps on a phone the drift halves while the sway does not. The backward
share then rises toward 0.45-0.49 (test §4). Physically, the pitch is right: water under a crest moves forward and water
under a trough moves back. But the eye tracks the dashes, which are discrete objects with first-order motion. It does not track
the band, which is only an envelope moving across near-static carriers. So the dim trough dashes read as a second wave train
running the other way. This is the "one dominant motion per field" rule of flow visualisation, broken: van Wijk 2002 (IBFV) and
Laramee et al. 2004 (survey) advect every visible texel by the one field. earth.nullschool and windy-style GPU particles move
each particle monotonically along the field and never oscillate it. The researcher's §3 has the citations. The
isoluminance note in D-036 (Lindsey & Teller 1990) is related, because the backward dashes are also the low-contrast ones.

**`WAVES_ANIM_DOMINANT_SWELL` probe** (normalizer, synthetic points, flag 0 vs 1). Swell FROM 0/90/180/270 at 0.9 of a 1 m
total FROM 45. With the flag off, the waves layer travels 225° (the total) every time. With it on, it travels 180/270/0/90°,
which is FROM + 180 every time: the sign is correct. In a two-cell case, the total is FROM 90 and the swell is FROM 270 at 0.8
of the total in cell A and at 0.5 in cell B. Cell A stamps (travels 90°). Cell B stays below the 0.35 energy gate and keeps the
total (travels 270°). So adjacent cells of one layer run head-on. That is the flag's real-but-local contribution to the
opposing motion. The §5i coherence gate defers stamping where partition availability is mixed, but it does not smooth the
energy-gate edge. PR #792 measures how often the flag turns the direction: 60.5% of spot-hours, p90 33°, 44 of 1,116 rows ≥ 45°.

## 4. Recommended smallest fix (not implemented here)

1. **Primary (client visual, ships ON):** set the orbital pitch to zero by default, with the kill switch
   `window.__RAW_DISABLE_ONE_WAY_CRESTS__ = true`. Setting it restores the 2.5 px sway. It is one value in
   `NATURAL_ANIM_DEFAULTS` (`marineEngineDecisions.js`), plus `MarineAnimTuner` keeps its slider. Every dash then moves only
   forward (the drift), and the band and foam roll still carry the orbit and period cue. Test §4 flips: no row has a backward share.
   An alternative that keeps a pitch cue: make the sway one-sided, as a forward surge under the crest and a hold in the trough.
   But any periodic offset returns somewhere, and the trough dashes stay visible at alpha 0.25, so zero is the honest choice.
   **No served number moves.**
2. **Secondary (rating band, surf mode):** drop ripple 2, or make both ripples travel one way. Kill switch
   `__RAW_DISABLE_ONE_WAY_SHIMMER__`.
3. **`WAVES_ANIM_DOMINANT_SWELL`:** it moves the served spot-rating `swell_from` (normalizer COUPLING note), so any change ships dark
   under D-001/D-065 on the owner's word. Smallest option: smooth the 0.35 energy gate, using a weight ramp instead of a step, so
   stamped and unstamped neighbours blend instead of meeting head-on. Owner's call; PR #792 has the census.

Before shipping (1): side-by-side moving clips, today against pitch 0, from the offline harness (log 2026-10-16) in dark, light
and beach, desktop and phone frame, per the owner's "watch the model first" rule.

## 5. Checklist (#786, 14 items): covered vs open

| # | Item | Status |
|---|---|---|
| 1 | One convention, applied once per source | **Covered** for GFS/EURO/ICON (code + buoy MAE); Copernicus code-checked, buoy row **open** |
| 2 | Each partition moves along its own TO | **Covered** (normalizer per product; flag stamps `waves` only, sign verified) |
| 3 | Synthetic test within 10° over 8+ frames, every theme | **Covered** offline, on the JS mirrors and the real packStaticFrame (exact, not just within 10°; 8 frames; four compass points + diagonals). Themes share the math. **Open:** a rendered (GPU) capture |
| 4 | Per-frame step < λ/4 | **Covered:** the band steps ≤ 1/16 set per frame; the drift and sway steps are sub-pixel |
| 5 | One dominant motion per field | **Fails today** (orbital pitch; rating shimmer). Fix (1)/(2) |
| 6 | Crests at c, particles at c_g / Stokes, named | **Open.** Bands ∝ T (c-like, scaled per view); the dash drift is a height-capped visual rate, neither c_g nor Stokes, and the code does not name it. Deep water only: the shader uses no depth |
| 7 | Direction not by colour alone | Covered by motion + dash orientation; no change |
| 8 | Reduced motion respected | **Covered** for the drift (×0.15 under `prefers-reduced-motion`). **Open:** the band, foam roll and sway are NOT damped; they use `u_motion_scale`, not `_rmScale` |
| 9 | Before/after screenshots | **Open** (no fix implemented) |
| 10 | D-065 if a served number moves | The fix (1)/(2) moves none; (3) would, so it ships dark |
| 11 | Depth-aware dispersion or "deep water only" | **Open:** deep water only, unlabelled |
| 12 | Particle velocity named | **Open** (as 6) |
| 13 | 0/360 wrap, spread, missing tested | Wrap **covered**; missing **characterised** (NaN packs as FROM 0); spread **open** |
| 14 | Phone frame rate measured | **Open.** The analytic 30 fps case is covered (drift halves, sway does not). No device measurement |

Not verified: GRIB/netCDF attribute text (by metadata), any live render, the reference viewers by screenshot.
