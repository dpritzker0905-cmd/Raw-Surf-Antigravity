/**
 * Wind bench, ANATOMY mode page half (bundled into map.js by ../build.js through map-entry.js; never part of the app).
 *
 * "What IS a streak, at each wind speed, in each theme?" The owner, 2026-10-12, watching dark beside light and beach: "lighter moving
 * air/wind in dark mode is almost transparent, or even smaller animations than in beach or light mode. You need to really compare
 * deeply each aspect". The other modes read a streak one way each (the light it adds, its lift, its cover) and as medians over a
 * view that mixes every speed. This reads every aspect the eye uses, by speed, on a speed ramp (../ramp-fixture.js: the wind blows
 * due north and a column of the picture is one speed over land and over sea):
 *
 *   colour   the field under the marks (L*, C*, hue) and a mark against it: the median mark pixel and the CORE (the top tenth of the
 *            band's mark pixels by lift): dL, and the chroma it shows. A core that keeps the field's chroma is the colour made
 *            lighter (the field shows through it); one that loses it is white laid over the colour;
 *   size     the BODY of a streak (pixels at least half the core's lift): its length along the wind and its width across it, CSS px;
 *            and the whole mark's length, tail included (every pixel the particles moved by more than MARK dE76);
 *   amount   cover (the share of the surface a mark touches), body (the share in a streak's bright body), and streaks met per
 *            1000 CSS px walked along the wind.
 *
 * A MARK pixel is one the particles moved by more than MARK dE76 against the field-only frame of the same camera and tiles (map mode's
 * definition, ../style.js). Read at device resolution, on `samples` frames `gap` apart after `warm` frames, medians over the frames.
 * anatomyRun({ theme, z, lng, lat, levers, bands, samples, gap, warm, res, seed }) -> { theme, z, dpr, bands: [{ speed, land, sea }] }
 */
const MARK = 4;
const LIN = new Float32Array(256).map((_, i) => { const v = i / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
const med = (a) => { if (!a.length) return null; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
const pct = (a, q) => { if (!a.length) return null; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const r1 = (x, d = 1) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(d));

module.exports = function makeAnatomyRun(h) {
  const { state, ensureMap, idle, newEngine, disposeEngine, clearLevers, landMaskSettled, animate, animateEach, readCanvas, coastSync, settledWaterMask, WIND_ID, mute, speedAt } = h;

  /** L*, a*, b* of every pixel of a canvas read. */
  function labOf(px, n) {
    const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    for (let k = 0, p = 0; k < n; k++, p += 4) {
      const R = LIN[px[p]], G = LIN[px[p + 1]], Bl = LIN[px[p + 2]], fy = f(0.2126729 * R + 0.7151522 * G + 0.072175 * Bl);
      L[k] = 116 * fy - 16; A[k] = 500 * (f((0.4124564 * R + 0.3575761 * G + 0.1804375 * Bl) / 0.95047) - fy); B[k] = 200 * (fy - f((0.0193339 * R + 0.119192 * G + 0.9503041 * Bl) / 1.08883));
    }
    return { L, A, B };
  }

  return async function anatomyRun(cfg) {
    const map = await ensureMap(cfg.theme), dpr = state.dpr;
    state.active = false;
    clearLevers(); Object.assign(window, cfg.levers || {});
    coastSync(map, cfg.theme);
    mute.syncWindBasemapMute(map, cfg.theme, false, WIND_ID);
    map.jumpTo({ center: [cfg.lng, cfg.lat], zoom: cfg.z });
    await idle(map);
    try {
      const wet = await settledWaterMask(map);
      mute.syncWindBasemapMute(map, cfg.theme, true, WIND_ID);
      await idle(map);
      state.active = true;
      newEngine(2, cfg.seed);
      const field = await animate(map, cfg.frames || 120), { W, H } = field, n = W * H, landMask = await landMaskSettled(), F = labOf(field.px, n);
      const nb = cfg.bands || 12, K = cfg.samples || 8, gap = cfg.gap || 10, warm = cfg.warm || 180;
      const cell = () => ({ px: 0, marks: 0, body: 0, fL: [], fC: [], fa: [], fb: [], dL: [], C: [], coreDL: [], coreC: [], coreL: [], bodyLen: [], tailLen: [], width: [], per1000: [], cover: [], bodyShare: [] });
      const acc = Array.from({ length: nb }, () => [cell(), cell()]);
      const x0 = (b) => Math.floor(W * b / nb), x1 = (b) => Math.floor(W * (b + 1) / nb);
      for (let b = 0; b < nb; b++) for (let y = 2; y < H - 2; y += 4) for (let x = x0(b) + 1; x < x1(b) - 1; x += 4) { const i = y * W + x, c = acc[b][wet[i] ? 1 : 0]; c.fL.push(F.L[i]); c.fa.push(F.A[i]); c.fb.push(F.B[i]); }
      newEngine(cfg.res || 384, cfg.seed);
      const lift = new Float32Array(n), M = new Uint8Array(n);
      const measure = (px) => {
        const P = labOf(px, n);
        for (let k = 0; k < n; k++) { const dl = P.L[k] - F.L[k], da = P.A[k] - F.A[k], db = P.B[k] - F.B[k]; lift[k] = dl; M[k] = dl * dl + da * da + db * db > MARK * MARK ? 1 : 0; }
        for (let b = 0; b < nb; b++) {
          const xa = x0(b) + 1, xb = x1(b) - 1;
          for (const s of [0, 1]) {
            const c = acc[b][s], lifts = [], chroma = [], Ls = [];
            let px_ = 0, marks = 0;
            for (let y = 2; y < H - 2; y += 2) for (let x = xa; x < xb; x += 2) {
              const i = y * W + x;
              if (wet[i] !== s) continue;
              px_++;
              if (!M[i]) continue;
              marks++; lifts.push(lift[i]); chroma.push(Math.hypot(P.A[i], P.B[i])); Ls.push(P.L[i]);
            }
            if (px_ < 400) continue;
            c.px += px_; c.marks += marks; c.cover.push(marks / px_);
            if (marks < 40) { c.per1000.push(0); c.bodyShare.push(0); continue; }
            const top = pct(lifts, 0.9), coreIdx = lifts.map((v, j) => (v >= top ? j : -1)).filter((j) => j >= 0), coreLift = med(coreIdx.map((j) => lifts[j])), bodyT = 0.5 * coreLift;
            c.dL.push(med(lifts)); c.C.push(med(chroma)); c.coreDL.push(coreLift); c.coreC.push(med(coreIdx.map((j) => chroma[j]))); c.coreL.push(med(coreIdx.map((j) => Ls[j])));
            // along the wind (the ramp blows due north: up the screen, down the read-back's rows): runs of the body, and of the whole mark
            let walked = 0, bodies = 0, bodyPx = 0;
            for (let x = xa; x < xb; x += 3) {
              let run = 0, tail = 0;
              for (let y = 1; y < H - 1; y++) {
                const i = y * W + x, on = wet[i] === s;
                if (on) walked++;
                const isBody = on && M[i] && lift[i] >= bodyT, isTail = on && M[i];
                if (isBody) { run++; bodyPx++; } else if (run) { if (run >= 2) { c.bodyLen.push(run / dpr); bodies++; } run = 0; }
                if (isTail) tail++; else if (tail) { if (tail >= 2) c.tailLen.push(tail / dpr); tail = 0; }
              }
            }
            c.per1000.push(walked ? bodies / (walked / dpr) * 1000 : 0); c.bodyShare.push(walked ? bodyPx / walked : 0);
            for (let y = 2; y < H - 2; y += 3) {   // across the wind: the body's width
              let run = 0;
              for (let x = xa; x < xb; x++) { const i = y * W + x; if (wet[i] === s && M[i] && lift[i] >= bodyT) run++; else if (run) { c.width.push(run / dpr); run = 0; } }
            }
          }
        }
      };
      await animateEach(map, warm + (K - 1) * gap + 1, (i) => { if (i >= warm && (i - warm) % gap === 0) measure(readCanvas(map).px); });
      state.active = false; disposeEngine();
      const speeds = Array.from({ length: nb }, (_, b) => {
        const x = W * (b + 0.5) / nb, v = [];
        for (let y = 8; y < H - 8; y += 24) { const ll = map.unproject([x / dpr, (H - 1 - y) / dpr]), s = speedAt(ll.lng, ll.lat); if (s != null && Number.isFinite(s)) v.push(s); }
        return r1(med(v));
      });
      const out = (c) => {
        if (c.fL.length < 200 || !c.cover.length) return null;
        const a = med(c.fa), b = med(c.fb), fC = Math.hypot(a, b);
        return { n: c.px, field: { L: r1(med(c.fL)), C: r1(fC), h: Math.round((Math.atan2(b, a) * 180 / Math.PI + 360) % 360) },
          cover: r1(med(c.cover), 3), body: r1(med(c.bodyShare), 3), per1000: r1(med(c.per1000)),
          mark: c.dL.length ? { dL: r1(med(c.dL)), C: r1(med(c.C)) } : null,
          core: c.coreDL.length ? { dL: r1(med(c.coreDL)), C: r1(med(c.coreC)), L: r1(med(c.coreL)), dC: r1(med(c.coreC) - fC) } : null,
          bodyLen: r1(med(c.bodyLen)), bodyLen90: r1(pct(c.bodyLen, 0.9)), tailLen: r1(med(c.tailLen)), tailLen90: r1(pct(c.tailLen, 0.9)), width: r1(med(c.width)) };
      };
      return { theme: cfg.theme, z: cfg.z, dpr, landMask, samples: K, glError: state.gl.getError() || 0, bands: acc.map((c, b) => ({ speed: speeds[b], land: out(c[0]), sea: out(c[1]) })) };
    } finally {
      state.active = false; disposeEngine(); clearLevers();
      coastSync(map, cfg.theme);
      mute.syncWindBasemapMute(map, cfg.theme, false, WIND_ID);
    }
  };
};
