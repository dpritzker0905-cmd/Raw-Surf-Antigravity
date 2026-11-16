# 2026-11-16: the client-flip precondition for 0.125-deg raster sets (Opus, Move 3; the director, from frame-carry's #956)

## 07:05Z: what the code does today (`dev`, read only)

- `ownRasterLayer.uploadField` uploads each decoded frame as ONE R32F texture of the field's full size, `texImage2D(..., gl.R32F,
  field.cols, field.rows, ...)`, with NO `MAX_TEXTURE_SIZE` check. Only the downscale tiles (`uploadDzTile`) read the limit
  (`st.maxTex`, fallback `dzFail('too_large')`).
- Residency is capped by COUNT: `RESIDENT_MAX = 6` frames, `evictOne()` past it. At 0.25 deg (720 x 361 x 4 B = 1 MB) that is ~6 MB.
- A 0.125-deg global field is 2880 x 1441: 16.6 MB per R32F texture, ~100 MB at 6 resident, and 2880 exceeds the 2048 that WebGL2
  guarantees (many phones report 4096; some 2048).

## 07:10Z: pre-registration (before any code); applies to EVERY 0.125-deg raster set (ICON precip, temperature, cloud)

No client flip of any 0.125-deg set until all of this passes. The change under test:
- **Fit:** read `MAX_TEXTURE_SIZE` once per layer; a field wider or taller than it is drawn by TILING (split into textures each within
  the limit, sampled as one field) or, if tiling is unavailable, DOWNSAMPLING by whole factors until it fits, with the drawn
  resolution stated in the status words.
- **Budget:** residency is capped by BYTES per layer (`RESIDENT_BYTES_MAX`, 48 MB per layer, registered now), evicting the oldest
  until under it; the count cap stays as an upper bound.
- Kill: `window.__RAW_DISABLE_RASTER_TEX_FIT__` (today's single full-size upload and count cap).

**Gates (all must pass):**
- **T1, limited device:** with `MAX_TEXTURE_SIZE` forced to 2048 in the page (an instrument override of `getParameter`), a 2880 x 1441
  field draws with 0 GL errors and no lost context; the tiled path's sampled values are identical to the field at the same points
  (byte-equal read-back at fixed probe points); a downsampled path is labelled.
- **T2, budget:** over a 30-step scrub of a 0.125-deg set, the layer's resident texture bytes never exceed 48 MB (sampled every frame
  from the layer's own accounting), and the 0.25-deg sets keep their 6 resident frames (no regression).
- **T3, phone:** phone profile (390 x 844, dpr 3, 4x CPU), a 20-step scrub of a 0.125-deg set vs the same set at 0.25 deg (today):
  key-to-shown p95 <= 1.5x the 0.25-deg p95; main-thread long tasks over 50 ms reported per step; 0 context losses. Offline lab only,
  the census load-void rule applies (calibration bar 1.25x the run's lowest), quiet window or a hosted runner.
- **T4, unit:** Jest pins the fit decision (fits / tiles / downsamples at limits 2048, 4096, 8192), byte-based eviction, the kill's
  off path; mutants that skip the size check or count frames instead of bytes fail.

## 07:30Z: amendment by the director, before any code ran: default ON on T1 + T2 + T4; T3 added when a 0.125-deg set is published

The director: build now (it is on the critical path for ICON precip, temperature and cloud, and it guards today's sets against an
unchecked upload). The default goes ON once T1, T2 and T4 pass; T3 (the phone) is run when a 0.125-deg set is published. Disclosed here.
**Built:** downsampling only (no tiling): a field over the limit is drawn at every k-th node (k the smallest whole factor that fits; a
wrapping grid keeps an exact wrap), with words in the status line ("<layer> drawn at 1/k detail: this device's graphics limit"); the
readout and the blend's grid match keep the full field. The byte cap is 48 MB per layer; when only protected frames remain over it, a
running value blend gives way (a hard cut) so its source frame can be freed. The one existing test that counted synchronous reads now
expects two (the link status, and `MAX_TEXTURE_SIZE` once per layer, as the registration states).
**Design correction found by a test (07:45Z), before any gate run:** with fields above 0.125 deg, the two frames that can never be
evicted (shown and wanted) could exceed the 48 MiB cap on their own. Each frame is now also kept within `FRAME_BYTES_MAX` = 48 MiB / 3,
so shown + wanted + a running blend's source always fit; a 0.125-deg frame (15.8 MiB) still fits whole. The blend give-way written
first could then never trigger and was removed (dead code).

## 08:00Z: results. T1 and T2 in a REAL page (the advisor's condition), T4 in Jest; T3 owed

`frontend/scripts/offline-backend/scn_raster_texfit.js`: the app's own `ownRasterLayer.js` (no imports) loaded as an ES module into
headless Chromium with a REAL WebGL2 context (ANGLE SwiftShader: software GL, device limit 8192), driven as MapLibre does (onAdd,
prerender, render). Every GL call the layer makes is followed by a real `gl.getError()`; only the limit READ is forced.
Raw `scratchpad/m3/texfit.json`.

| arm | limit the code reads | GL calls | GL errors | context lost | drawn | peak resident | over 48 MiB |
|---|---|---|---|---|---|---|---|
| T1 (fit ON) | 2048 (forced) | 101 | **0** | no | 1440 x 721 (factor 2) | 3.96 MiB | 0 of 2 samples |
| T2 (fit ON, 30-step scrub, 2 frames a step) | 8192 (device) | 1,694 | **0** | no | full (factor 1) | **47.49 MiB** | **0 of 60** |
| kill | 2048 (forced) | 101 | 0 | no | 2880 x 1441 (full) | 15.83 MiB | 0 of 2 |

- **T1 PASS, T2 PASS** as registered, on a real context. T4 PASS (Jest; mutants fail). T3 (phone) owed before any 0.125 client flip.
- The kill arm shows what the forced read cannot: the real device's limit is 8192, so the full upload succeeds here; on a real 2048
  device that upload is the error this change prevents. A real low-limit device was not available.
- SwiftShader is software GL; a phone GPU was not measured.

**Limits (the advisor's red-team), stated:**
1. Downsampling only (the registration preferred tiling): on a 2048-limit device every 0.125-deg set is drawn at 0.25 deg, with words.
2. The downsample is a POINT sample (every k-th node): for rain it can miss a shower the full field shows; a k x k mean would match the
   set's area-mean meaning (a follow-up; the point sample is what T1's byte-equal check verifies today).
3. With the fit ON, today's sets also read `MAX_TEXTURE_SIZE` once per layer per context: one synchronous `getParameter`, at the
   first upload, never per frame; not separately timed on a phone.
4. T3 stays owed before any 0.125-deg client flip.

## 08:16Z: CORRECTION of two headers in this log (clock estimates, not readings; the advisor and the `verify` check)

- The header "07:30Z: amendment by the director, before any code ran" is wrong: that section was written into commit `b9b160796`
  at 07:14:40Z. The director's "build it now" message (the amendment) reached this session at **07:05Z** (02:05 EST).
- The header "08:00Z: results" is wrong: the real-page run happened at about 07:51Z and was committed in `7a4ead94d` at **07:52:37Z**.
- **What git can and cannot show.** On THIS branch the registration text, the amendment and the first code share ONE commit
  (`b9b160796`, 07:14:40Z), so their order here is my statement, not something git shows. The registration WAS committed alone
  first, on another branch: `726038a3b` on `opus/scrub-render-census` at 07:05:02Z (2026-11-16T02:05:02-05:00), before any code,
  the 07:10Z-headed section copied here verbatim. (Its own "07:10Z" header is also later than that commit, by the same mistake.)
  The amendment reached me at 07:05Z, the same minute; it is recorded only by the 07:14:40Z commit.
- Next time: the registration is committed alone on the PR's own branch first, and every header time is read from the clock.
