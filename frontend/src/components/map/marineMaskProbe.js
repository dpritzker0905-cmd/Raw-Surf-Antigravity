// GPU MASK READ-BACK (maskFloodProbe.js diagnostic, 2026-07-07 — "innovate a better way to test"):
// sample the ACTUAL ocean-mask texel the shader used at each lng/lat by attaching the live mask
// texture to an FBO and readPixels (persistent texture; no draw-timing games, no preserveDrawingBuffer).
// Returns per-point { base, overlay, effective, src } as 0-255 red (≥128 = water). `effective`
// mirrors the shader's per-pixel selection (overlay REPLACE, z≥12 min-combine, or base) using the
// state stashed during the last draw. Dev tool only; no effect on rendering.
export function probeMarineMaskGPU(engine, points, glIn) {
  const gl = glIn || (typeof window !== 'undefined' && window.map && window.map.painter && window.map.painter.context && window.map.painter.context.gl);
  if (!gl || !Array.isArray(points)) return null;
  const ps = engine._probeState || {};
  const merc = (lat) => { const c = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180; return (1 - Math.log(Math.tan(c) + 1 / Math.cos(c)) / Math.PI) / 2; };
  const wrap = (lng, center) => { let p = lng; while (p - center > 180) p -= 360; while (p - center < -180) p += 360; return p; };
  const dimsForOverlay = (b) => {
    const span = (b.east < b.west) ? (b.east + 360) - b.west : b.east - b.west;
    let w = span < 10 ? 4096 : (span < 30 ? 2048 : 4096); if (w > 2048) w = 2048;
    // MID-ZOOM COASTAL CARVE (2026-07-21, user residual-fringe report): the regional min-combine
    // overlay spans ~0.5–3° across the halo band; at the flat 2048 cap that is ~56 m/texel and the
    // coast carve is soft, so the heatmap feather still rides a thin fringe onto land. Lift the cap to
    // 4096 (~28 m/texel) for that span band so the coast cuts crisply — matching the z>=12 look the
    // user confirmed clean. Deep-zoom (<0.35°, already fine at 2048) and world (≥30°, memory-bound)
    // spans are unchanged. Kill: __RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__ (restores the flat 2048 cap).
    if (!(typeof window !== 'undefined' && window.__RAW_DISABLE_MIDZOOM_OVERLAY_CARVE__ === true) &&
        span >= 0.35 && span < 6) w = 4096;
    return { w, h: w / 2 };
  };
  // Use only the read binding in WebGL2; FRAMEBUFFER would also overwrite the draw binding.
  const target = gl.READ_FRAMEBUFFER ?? gl.FRAMEBUFFER;
  const binding = gl.READ_FRAMEBUFFER_BINDING ?? gl.FRAMEBUFFER_BINDING;
  const prevFbo = gl.getParameter(binding);
  const fbo = gl.createFramebuffer();
  const readMany = (tex, b, dims, requested) => {
    const samples = requested.map(() => null);
    if (!tex || !b || !dims || !requested.length) return samples;
    const rows = new Map();
    requested.forEach(({ lng, lat }, index) => {
      const center = (b.west + b.east) / 2;
      const wW = wrap(b.west, center), wE = wrap(b.east, center), pl = wrap(lng, center);
      const mnX = (wW + 180) / 360, mxX = (wE + 180) / 360, mnY = merc(b.north), mxY = merc(b.south);
      if (mxX <= mnX || mxY <= mnY) return;
      const u = ((pl + 180) / 360 - mnX) / (mxX - mnX);
      const v = (merc(lat) - mnY) / (mxY - mnY);          // 0 = north (canvas top)
      if (u < 0 || u > 1 || v < 0 || v > 1) return;
      const tx = Math.max(0, Math.min(dims.w - 1, Math.round(u * (dims.w - 1))));
      const tyC = Math.max(0, Math.min(dims.h - 1, Math.round(v * (dims.h - 1))));
      const ty = dims.h - 1 - tyC;                          // mask uploaded UNPACK_FLIP_Y=true
      const row = rows.get(ty) || [];
      row.push({ tx, index }); rows.set(ty, row);
    });
    if (!rows.size) return samples;
    gl.bindFramebuffer(target, fbo);
    gl.framebufferTexture2D(target, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(target) !== gl.FRAMEBUFFER_COMPLETE) return samples;
    // Read the same exact texels in horizontal runs. Zoomlab's 200 points share five rows:
    // one read per row avoids 200 GPU/CPU round trips without dropping any ground truth.
    for (const [ty, row] of rows) {
      const first = Math.min(...row.map(p => p.tx)), last = Math.max(...row.map(p => p.tx));
      const bytes = new Uint8Array((last - first + 1) * 4);
      gl.readPixels(first, ty, last - first + 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      for (const { tx, index } of row) {
        const offset = (tx - first) * 4;
        samples[index] = { r: bytes[offset], b: bytes[offset + 2] };
      }
    }
    return samples;
  };
  const inBounds = (b, lng, lat) => {
    if (!b || lat < b.south || lat > b.north) return false;
    const c = (b.west + b.east) / 2, pl = wrap(lng, c), wW = wrap(b.west, c), wE = wrap(b.east, c);
    return pl >= wW && pl <= wE;
  };
  const baseTex = engine._cachedMaskTex, baseB = engine._cachedMaskBounds, baseD = engine._cachedMaskTexDims;
  const ovTex = engine._overlayMaskTex, ovB = engine._overlayMaskBounds, ovD = ovB ? dimsForOverlay(ovB) : null;
  // COARSE-BASE FALLBACK (2026-07-18 EVE-2): beyond the RESIDENT mask bounds both reads return
  // null, which callers (zoomlab's water ground truth) had to guess about — the ring-fill zone
  // read as "unknown/land" and could hide a real dead-ring finding there. The held coarse base
  // is world-covering with its own mask; sample it when the resident/overlay can't answer.
  const cb = engine._coarseBaseData;
  const cbTex = cb && cb.u_oceanMaskTexture, cbB = cb && cb.bounds;
  const cbD = (cb && cb.__maskCanvasDims) ? { w: cb.__maskCanvasDims.w, h: cb.__maskCanvasDims.h } : null;
  try {
    const bases = readMany(baseTex, baseB, baseD, points);
    const overlays = readMany(ovTex, ovB, ovD, points);
    const res = points.map(({ lng, lat }, index) => {
      const baseS = bases[index], ovS = overlays[index];
      const base = baseS ? baseS.r : null;
      const overlay = ovS ? ovS.r : null;
      let effective = base, src = 'base', effB = baseS ? baseS.b : null; // effB = the coast-SDF byte the shader uses
      if (ps.overlayOn && overlay != null && inBounds(ovB, lng, lat)) {
        if (ps.replace) { effective = overlay; effB = ovS.b; src = 'overlay_replace'; }
        else {
          effective = (base == null) ? overlay : Math.min(base, overlay);
          effB = (baseS && ovS) ? Math.min(baseS.b, ovS.b) : (ovS ? ovS.b : effB); // min-combine of two SDFs = more-land
          src = 'overlay_min';
        }
      }
      return { lng, lat, base, overlay, effective, src, effB };
    });
    const missing = res.filter(sample => sample.effective == null);
    const coarse = readMany(cbTex, cbB, cbD, missing);
    missing.forEach((sample, index) => {
      if (coarse[index] != null) {
        sample.effective = coarse[index].r; sample.effB = coarse[index].b; sample.src = 'coarse_base';
      }
    });
    return res;
  } finally {
    try { gl.bindFramebuffer(target, prevFbo); } finally { gl.deleteFramebuffer(fbo); }
  }
}
