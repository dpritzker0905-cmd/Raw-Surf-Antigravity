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
