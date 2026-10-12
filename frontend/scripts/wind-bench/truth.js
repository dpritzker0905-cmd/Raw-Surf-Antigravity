/**
 * Wind bench, TRUTH mode's statistics: what the wind's streaks do to the picture, measured against the TRUE ground.
 *
 * The true ground of a crop is the SAME crop drawn with the colour field alone (a motion-run.js run with `"res": 2`: a 2 x 2 particle
 * pool). Every other gauge in this bench guesses the ground from the picture itself: the mirror probe takes each pixel's darkest
 * moment, which reads a theme whose trails DARKEN the field low and a theme whose trails never leave it high, both at once
 * (LESSONS L-V73). Here nothing is guessed: per pixel and frame, d = L*(with streaks) - L*(field alone).
 *
 * Pure functions over RGBA bytes, no DOM and no dependency: Jest reads this file (src/components/map/windBenchTruth.test.js) and
 * truth-run.js loads the same file into a page, which decodes the saved frames (lossless PNG crops at device resolution).
 * Lightness is CIELAB L* (D65), luminance Y is linear, both from sRGB bytes; `lab` is the bench's usual conversion.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.__windTruth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const lstarOfY = (Y) => 116 * f(Y) - 16;
  const lumOf = (r, g, b) => 0.2126729 * LIN[r] + 0.7151522 * LIN[g] + 0.072175 * LIN[b];
  /** [L*, a*, b*, Y] of sRGB bytes. */
  function lab(r, g, b) {
    const R = LIN[r], G = LIN[g], B = LIN[b], Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
    const fx = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047), fy = f(Y), fz = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz), Y];
  }
  const enc = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10), r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  const sorted = (a) => Float32Array.from(a).sort();
  const median = (a) => { const s = sorted(a); return s.length ? s[s.length >> 1] : null; };
  const quantile = (a, q) => { const s = sorted(a); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };

  /**
   * THE TRUE GROUND of a W x H crop: add(RGBA) each frame drawn with the field alone, then done().
   * Y and L are the mean in LINEAR light (what a still eye is given); `byte` is the mean of the stored bytes, three a pixel, for
   * the composite's own arithmetic (the canvas blends bytes, it knows nothing of linear light: lawFit below).
   */
  function ground(W, H) {
    const n = W * H, sR = new Float64Array(n), sG = new Float64Array(n), sB = new Float64Array(n), sByte = new Float64Array(n * 3);
    let frames = 0;
    return {
      add(d) {
        for (let k = 0, p = 0; k < n; k++, p += 4) {
          sR[k] += LIN[d[p]]; sG[k] += LIN[d[p + 1]]; sB[k] += LIN[d[p + 2]];
          sByte[k * 3] += d[p]; sByte[k * 3 + 1] += d[p + 1]; sByte[k * 3 + 2] += d[p + 2];
        }
        frames++;
      },
      done() {
        if (!frames) throw new Error('the ground has no frame');
        const Y = new Float32Array(n), L = new Float32Array(n), byte = new Float32Array(n * 3);
        let mL = 0, mY = 0, mr = 0, mg = 0, mb = 0;
        for (let k = 0; k < n; k++) {
          const R = sR[k] / frames, G = sG[k] / frames, B = sB[k] / frames;
          Y[k] = 0.2126729 * R + 0.7151522 * G + 0.072175 * B; L[k] = lstarOfY(Y[k]); mL += L[k]; mY += Y[k]; mr += R; mg += G; mb += B;
          byte[k * 3] = sByte[k * 3] / frames; byte[k * 3 + 1] = sByte[k * 3 + 1] / frames; byte[k * 3 + 2] = sByte[k * 3 + 2] / frames;
        }
        mY /= n;
        let varY = 0; for (let k = 0; k < n; k++) varY += (Y[k] - mY) * (Y[k] - mY);
        const rgb = [enc(mr / n), enc(mg / n), enc(mb / n)], c = lab(rgb[0], rgb[1], rgb[2]);
        return { W, H, n, frames, Y, L, byte, meanL: mL / n, meanRGB: rgb, chroma: Math.hypot(c[1], c[2]), texture: mY > 0 ? Math.sqrt(varY / n) / mY : 0 };
      },
    };
  }

  /**
   * EVERY PIXEL AND FRAME AGAINST THE TRUE GROUND: add(RGBA) each frame drawn with the streaks, then summary().
   * `near` (L*, default 1.5) is how close to the field counts as back at it; `reached` (default 3) how far over it counts as lit.
   */
  function watch(g, opts) {
    const o = Object.assign({ near: 1.5, reached: 3 }, opts || {}), n = g.n;
    const minD = new Float32Array(n).fill(1e9), maxD = new Float32Array(n).fill(-1e9), maxY = new Float32Array(n), prev = new Float32Array(n);
    let sum = 0, pos = 0, neg = 0, over3 = 0, over6 = 0, over10 = 0, under15 = 0, under3 = 0, near = 0, flick = 0, rmsL = 0, rmsY = 0, frames = 0, litR = 0, litG = 0, litB = 0, litN = 0;
    return {
      add(d) {
        if (d.length !== n * 4) throw new Error(`a frame of ${d.length / 4} pixels against a ground of ${n}`);
        let s1 = 0, s2 = 0, y1 = 0, y2 = 0, ad = 0;
        for (let k = 0, p = 0; k < n; k++, p += 4) {
          const Y = lumOf(d[p], d[p + 1], d[p + 2]), L = lstarOfY(Y), dd = L - g.L[k];
          sum += dd; if (dd > 0) pos += dd; else neg += dd;
          if (dd >= 3) over3++; if (dd >= 6) over6++; if (dd >= 10) { over10++; litR += LIN[d[p]]; litG += LIN[d[p + 1]]; litB += LIN[d[p + 2]]; litN++; }
          if (dd <= -1.5) under15++; if (dd <= -3) under3++; if (Math.abs(dd) < o.near) near++;
          if (dd < minD[k]) minD[k] = dd; if (dd > maxD[k]) { maxD[k] = dd; maxY[k] = Y; }
          s1 += dd; s2 += dd * dd; const ry = Y / Math.max(1e-4, g.Y[k]) - 1; y1 += ry; y2 += ry * ry;
          if (frames) ad += Math.abs(L - prev[k]); prev[k] = L;
        }
        rmsL += Math.sqrt(Math.max(0, s2 / n - (s1 / n) * (s1 / n))); rmsY += Math.sqrt(Math.max(0, y2 / n - (y1 / n) * (y1 / n)));
        if (frames) flick += ad / n; frames++;
      },
      summary() {
        if (!frames) throw new Error('no frame was watched');
        const N = n * frames, web = [];
        let back = 0, reached = 0;
        for (let k = 0; k < n; k++) {
          if (minD[k] < o.near) back++;
          if (maxD[k] >= o.reached) { reached++; web.push((maxY[k] - g.Y[k]) / Math.max(1e-4, g.Y[k])); }
        }
        const lit = litN ? lab(enc(litR / litN), enc(litG / litN), enc(litB / litN)) : null;
        return {
          size: [g.W, g.H], frames, groundL: r1(g.meanL), groundC: r1(g.chroma), groundRGB: g.meanRGB, groundTexture: r3(g.texture),
          lift: r1(sum / N),                       // mean L* over the true ground, every pixel and frame
          added: r1(pos / N), taken: r1(neg / N),  // its two parts: the light the streaks add, and the light they take
          over3: r3(over3 / N), over6: r3(over6 / N), over10: r3(over10 / N),   // share of pixel-instants 3 / 6 / 10 L* or more OVER the field
          under15: r3(under15 / N), under3: r3(under3 / N),                     // share 1.5 / 3 L* or more UNDER it
          atField: r3(near / N),                   // share within `near` L* of it: back at the field
          back: r3(back / n),                      // share of PIXELS that came back to the field (or under it) at least once in the run
          reach: r3(reached / n),                  // share of pixels a streak reached at all
          darkest: r1(median(minD)), darkestP10: r1(quantile(minD, 0.1)),       // a pixel's darkest moment against the field: median, and the deepest tenth
          lightest: r1(median(maxD)), lightestP90: r1(quantile(maxD, 0.9)),     // a pixel's lightest moment against it: a streak's core
          weber: r3(web.length ? median(web) : 0),                              // (Y at the core - Y of the field) / Y of the field, pixels a streak reached
          rmsL: r1(rmsL / frames), rmsContrast: r3(rmsY / frames),              // the pattern the streaks draw at an instant: sd of d, and the same in linear light over the field's luminance
          flicker: r3(frames > 1 ? flick / (frames - 1) : 0),                   // mean |change in L*| a pixel a frame
          litLC: lit ? [r1(lit[0]), r1(Math.hypot(lit[1], lit[2]))] : null,     // the L* and chroma of the pixel-instants 10 L* or more over the field
        };
      },
    };
  }

  /** TWO RUNS FRAME FOR FRAME: add(RGBA of a, RGBA of b) each frame pair, then summary(). CIE76 a pixel; `step` thins the pixels read. */
  function differ(step) {
    const st = Math.max(1, step || 1);
    let mean = 0, worst = 0, max = 0, over1 = 0, over2 = 0, px = 0, frames = 0;
    return {
      add(A, B) {
        if (A.length !== B.length) throw new Error('two frames of different sizes');
        let s = 0, cnt = 0;
        for (let p = 0; p < A.length; p += 4 * st) {
          const a = lab(A[p], A[p + 1], A[p + 2]), b = lab(B[p], B[p + 1], B[p + 2]), d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          s += d; cnt++; if (d > max) max = d; if (d > 1) over1++; if (d > 2) over2++;
        }
        const m = s / cnt; mean += m; if (m > worst) worst = m; px += cnt; frames++;
      },
      summary() {
        if (!frames) throw new Error('no frame pair was compared');
        return { frames, mean: r3(mean / frames), worstFrame: r3(worst), max: r1(max), over1: +(over1 / px).toFixed(4), over2: +(over2 / px).toFixed(4) };
      },
    };
  }

  /**
   * THE BARE CANVAS'S CLAMP (LESSONS L-V72): a frame saved from a see-through canvas, read UN-premultiplied. Where a channel was brighter
   * than the alpha the wind had left, the encoder stored 255 and the pixel laid over black reads the alpha, not the colour.
   * add(RGBA, un-premultiplied) each frame, then summary(). A frame the corrected bench saved is opaque: seeThrough 0.
   */
  function clamp() {
    let n = 0, see = 0, clamped = 0, aMin = 255, frames = 0;
    return {
      add(d) {
        for (let p = 0; p < d.length; p += 4) { n++; if (d[p + 3] < aMin) aMin = d[p + 3]; if (d[p + 3] < 255) { see++; if (d[p] === 255 || d[p + 1] === 255 || d[p + 2] === 255) clamped++; } }
        frames++;
      },
      summary() { return { frames, alphaMin: r3(aMin / 255), seeThrough: r3(see / Math.max(1, n)), clampedOfAll: r3(clamped / Math.max(1, n)), clampedOfSeeThrough: r3(clamped / Math.max(1, see)) }; },
    };
  }

  /**
   * THE COMPOSITE'S LAW, READ OFF THE SCREEN. SCREEN_FS lays the trail buffer over the ground in one of two ways, and both are
   * members of one family. With c the buffer's colour, b its strongest channel and g the ground, a channel at a time (all 0 to 1):
   *
   *     screen - g  =  p x (b c - b^2 g)  -  q x b' (1 - b') g          b' = min(1, b / level)
   *
   * The first term is LIGHT: the buffer's colour at full brightness, laid at alpha b^2. The second is a VEIL: a black of alpha
   * q b' (1 - b'), nothing at an empty texel and nothing at a full one, strongest at half strength.
   *   dark's branch (the buffer's colour at alpha b x opacity):                 p = q = opacity, level 1
   *   the glow branch (the colour at full brightness at alpha b^2 x opacity):   p = opacity, q = 0
   * add(RGBA of the screen, RGBA of the trail buffer) each frame, then summary(): p and q by least squares over every channel of
   * every pixel-instant that holds ink, the fit's RMS residual in 8-bit levels, and each pure law at its own best strength.
   * `empty` is the RMS distance of the screen from the ground where the buffer is empty: 0 says the two crops are the same pixels.
   * `check: [p, q]` also counts the pixel-channels a GIVEN law explains to within `tol` levels (`obeys`, a share): the map draws its
   * own lines and names ABOVE the wind, and a pixel under one obeys no law of the wind's (over land a fit is pulled by them).
   */
  function lawFit(g, opts) {
    const o = Object.assign({ level: 1, check: null, tol: 1.5 }, opts || {}), n = g.n;
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0, yy = 0, N = 0, e2 = 0, eN = 0, xd = 0, xdy = 0, frames = 0, obeys = 0;
    return {
      add(screen, trail) {
        if (screen.length !== n * 4 || trail.length !== n * 4) throw new Error('the screen, the trail buffer and the ground are not one crop');
        for (let k = 0, p = 0; k < n; k++, p += 4) {
          const c0 = trail[p] / 255, c1 = trail[p + 1] / 255, c2 = trail[p + 2] / 255, b = Math.max(c0, c1, c2);
          if (b === 0) { for (let j = 0; j < 3; j++) { const e = screen[p + j] - g.byte[k * 3 + j]; e2 += e * e; eN++; } continue; }
          const bn = Math.min(1, b / o.level), veil = bn * (1 - bn);
          for (let j = 0; j < 3; j++) {
            const gk = g.byte[k * 3 + j] / 255, c = j === 0 ? c0 : (j === 1 ? c1 : c2), y = screen[p + j] / 255 - gk;
            const x1 = b * c - b * b * gk, x2 = -veil * gk, x = b * (c - gk);
            a11 += x1 * x1; a12 += x1 * x2; a22 += x2 * x2; b1 += x1 * y; b2 += x2 * y; yy += y * y; xd += x * x; xdy += x * y; N++;
            if (o.check && Math.abs(y - o.check[0] * x1 - o.check[1] * x2) * 255 <= o.tol) obeys++;
          }
        }
        frames++;
      },
      summary() {
        if (!N) return { frames, n: 0, p: null, q: null, rms: null, dark: null, glow: null, empty: eN ? r3(Math.sqrt(e2 / eN)) : null };
        const det = a11 * a22 - a12 * a12, lone = !(det > 1e-12 * Math.max(1, a11 * a22));   // no veil in the data at all (every texel full): fit the light alone
        const p = lone ? b1 / a11 : (b1 * a22 - b2 * a12) / det, q = lone ? 0 : (a11 * b2 - a12 * b1) / det;
        const res = (ss) => r3(Math.sqrt(Math.max(0, ss) / N) * 255);
        const opD = xd > 0 ? xdy / xd : 0, opG = a11 > 0 ? b1 / a11 : 0;
        return {
          frames, n: N, p: r3(p), q: r3(q), level: o.level,
          rms: res(yy - 2 * p * b1 - 2 * q * b2 + p * p * a11 + 2 * p * q * a12 + q * q * a22),
          dark: { opacity: r3(opD), rms: res(yy - 2 * opD * xdy + opD * opD * xd) },     // the buffer's colour at alpha b x opacity
          glow: { opacity: r3(opG), rms: res(yy - 2 * opG * b1 + opG * opG * a11) },     // the colour at full brightness at alpha b^2 x opacity
          empty: eN ? r3(Math.sqrt(e2 / eN)) : null,
          obeys: o.check ? r3(obeys / N) : null,
        };
      },
    };
  }

  /** What a composite draws, a channel at a time (bytes in, bytes out): the family above. The tests' and the log's own arithmetic. */
  function composite(groundRGB, trailRGB, p, q, level) {
    const c = trailRGB.map((v) => v / 255), b = Math.max(c[0], c[1], c[2]), bn = Math.min(1, b / (level || 1));
    return groundRGB.map((gb, j) => { const gk = gb / 255; return Math.round(255 * Math.min(1, Math.max(0, gk + p * (b * c[j] - b * b * gk) - q * bn * (1 - bn) * gk))); });
  }

  return { lab, lstarOfY, lumOf, ground, watch, differ, clamp, lawFit, composite };
});
