/**
 * MIRROR PROBE: what a viewer's eye is given by a wind picture, read from the pixels themselves, frame by frame.
 *
 * It runs in ANY page: the deployed app (pasted into the console, or through a browser connector) and the wind bench (mirror-run.js
 * feeds it motion-run.js's frames). Same code, same numbers: that is the point. Every earlier instrument read the bench only, and two
 * looks the bench passed were rejected on the owner's screen (DECISIONS D-020, D-021; D-022 was found with this one).
 *
 * It does not read the engine's tables or uniforms. It watches consecutive frames of a crop and keeps, per pixel, its darkest moment
 * (the GROUND: a light-adding streak never darkens it), its lightest moment (a streak's CORE), and its mean and spread over time.
 *
 *   window.__mirrorProbe.capture({ frames, size, at })            -> Promise<stats>   a live canvas (canvas.captureStream, so it
 *                                                                                     works whatever preserveDrawingBuffer is)
 *   window.__mirrorProbe.fromImages(urls, { size, at })           -> Promise<stats>   saved frames, in order
 *
 * Lightness is CIELAB L* (D65) and luminance Y is linear, both from sRGB bytes. What the columns mean is beside each in summary().
 */
(function (root) {
  var LIN = new Float32Array(256), i;
  for (i = 0; i < 256; i++) { var c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  function lab(r, g, b) {
    var R = LIN[r], G = LIN[g], B = LIN[b];
    var X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047, Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B,
      Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883, fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz), Y];
  }
  function median(a) { if (!a.length) return null; var s = Float64Array.from(a).sort(), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function quant(a, q) { if (!a.length) return null; var s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }
  function r1(x) { return x == null ? null : Math.round(x * 10) / 10; }
  function r3(x) { return x == null ? null : Math.round(x * 1000) / 1000; }
  function mapCanvas(doc) { return doc.querySelector('canvas.maplibregl-canvas') || doc.querySelector('canvas.mapboxgl-canvas') || doc.querySelector('canvas'); }

  /** The per-pixel record of a W x H crop over a run of frames: add(RGBA bytes) each frame, then summary(). */
  function watch(W, H, visited) {
    visited = visited || 3;   // L* a pixel must rise above its ground to count as reached by a streak
    var n = W * H, Lmin = new Float32Array(n).fill(1e9), Lmax = new Float32Array(n).fill(-1e9), sum = new Float64Array(n), sum2 = new Float64Array(n),
      minRGB = new Uint8Array(n * 3), maxRGB = new Uint8Array(n * 3), prev = new Float32Array(n), got = 0, absd = 0;
    return {
      add: function (d) {
        var ad = 0, p = 0, k;
        for (k = 0; k < n; k++, p += 4) {
          var Y = 0.2126729 * LIN[d[p]] + 0.7151522 * LIN[d[p + 1]] + 0.072175 * LIN[d[p + 2]], L = 116 * f(Y) - 16;
          if (L < Lmin[k]) { Lmin[k] = L; minRGB[k * 3] = d[p]; minRGB[k * 3 + 1] = d[p + 1]; minRGB[k * 3 + 2] = d[p + 2]; }
          if (L > Lmax[k]) { Lmax[k] = L; maxRGB[k * 3] = d[p]; maxRGB[k * 3 + 1] = d[p + 1]; maxRGB[k * 3 + 2] = d[p + 2]; }
          sum[k] += L; sum2[k] += L * L; if (got) ad += Math.abs(L - prev[k]); prev[k] = L;
        }
        if (got) absd += ad / n;
        got++;
      },
      summary: function () {
        var groundL = [], peakL = [], stepAll = [], stepSeen = [], weber = [], gC = [], sC = [], hueTurn = [], excess = [], spread = [], k;
        var reach3 = 0, reach6 = 0, reach10 = 0, lit = 0, pictureL = 0, gMean = 0, iMean = 0, gVar = 0, iVar = 0;
        for (k = 0; k < n; k++) { gMean += Lmin[k]; iMean += prev[k] - Lmin[k]; }
        gMean /= n; iMean /= n;
        for (k = 0; k < n; k++) {
          var st = Lmax[k] - Lmin[k], mean = sum[k] / got, sd = Math.sqrt(Math.max(0, sum2[k] / got - mean * mean));
          groundL.push(Lmin[k]); peakL.push(Lmax[k]); stepAll.push(st); excess.push(mean - Lmin[k]); spread.push(sd); pictureL += mean;
          gVar += (Lmin[k] - gMean) * (Lmin[k] - gMean); iVar += (prev[k] - Lmin[k] - iMean) * (prev[k] - Lmin[k] - iMean);
          if (st >= visited) reach3++; if (st >= 6) reach6++; if (st >= 10) reach10++;
          if (prev[k] - Lmin[k] >= visited) lit++;
          if (st >= visited) {
            var g = lab(minRGB[k * 3], minRGB[k * 3 + 1], minRGB[k * 3 + 2]), s = lab(maxRGB[k * 3], maxRGB[k * 3 + 1], maxRGB[k * 3 + 2]);
            stepSeen.push(st); weber.push((s[3] - g[3]) / Math.max(1e-4, g[3]));
            var cg = Math.hypot(g[1], g[2]), cs = Math.hypot(s[1], s[2]); gC.push(cg); sC.push(cs);
            if (cg > 4 && cs > 4) { var dh = Math.abs(Math.atan2(s[2], s[1]) - Math.atan2(g[2], g[1])) * 180 / Math.PI; hueTurn.push(dh > 180 ? 360 - dh : dh); }
          }
        }
        var groundTexture = Math.sqrt(gVar / n), streakTexture = Math.sqrt(iVar / n), gL = median(groundL), pL = pictureL / n;
        return {
          frames: got,
          // THE GROUND (each pixel's darkest moment) and THE PICTURE (its mean over time): `lift` is how far the streaks raise the
          // whole picture above its ground. A lift far above dark's is the white burying the colour field (D-022).
          groundL: r1(gL), groundC: r1(median(gC)), pictureL: r1(pL), lift: r1(pL - gL),
          // A STREAK'S CORE against the ground under that same pixel: its lightness, how far it steps, and the colour it keeps
          peakL: r1(median(peakL)), step: r1(median(stepSeen)), stepP90: r1(quant(stepSeen, 0.9)), stepAllPx: r1(median(stepAll)),
          weber: r3(median(weber)),          // (Y streak - Y ground) / Y ground in linear luminance: the contrast a thin line is seen by
          streakC: r1(median(sC)), kept: median(gC) > 1 ? r3(median(sC) / median(gC)) : null, hueTurn: r1(median(hueTurn)),
          // HOW MUCH OF THE VIEW the streaks hold
          reach: r3(reach3 / n), reach6: r3(reach6 / n), reach10: r3(reach10 / n),   // share of pixels a streak reached in the run
          cover: r3(lit / n),                // share lit at one instant (the last frame)
          excess: r1(median(excess)),        // median over pixels of the mean L* above its ground: the "silk" between heads
          // MOTION ENERGY
          flicker: r3(absd / Math.max(1, got - 1)),   // mean |change in L*| a pixel a frame
          spread: r1(median(spread)),                 // median over pixels of the spread of L* over time
          // FIGURE AGAINST CLUTTER: the streak layer's texture at one instant over the map's own texture
          streakTexture: r1(streakTexture), groundTexture: r1(groundTexture), overClutter: r3(streakTexture / Math.max(0.05, groundTexture)),
        };
      },
    };
  }

  /** @param {object} o  frames (120), size (crop edge in DEVICE px, 360), at ([x, y] 0..1: where the crop sits), visited (L*, 3) */
  function capture(o) {
    o = o || {};
    var frames = o.frames || 120, at = o.at || [0.5, 0.5], cv = o.canvas || mapCanvas(document);
    if (!cv) return Promise.reject(new Error('mirror probe: no canvas'));
    var W = Math.min(o.size || 360, cv.width), H = Math.min(o.size || 360, cv.height), sx = Math.round((cv.width - W) * at[0]), sy = Math.round((cv.height - H) * at[1]);
    var stream = cv.captureStream(60), video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.srcObject = stream;
    var c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    var ctx = c2.getContext('2d', { willReadFrequently: true }), rec = watch(W, H, o.visited), got = 0, t0 = null, t1 = null;
    return video.play().then(function () {
      return new Promise(function (resolve, reject) {
        var guard = setTimeout(function () { reject(new Error('mirror probe: the canvas presented ' + got + ' of ' + frames + ' frames in 20 s')); }, 20000);
        function step(now, meta) {
          ctx.drawImage(video, sx, sy, W, H, 0, 0, W, H);
          rec.add(ctx.getImageData(0, 0, W, H).data);
          if (t0 === null) t0 = meta.mediaTime; t1 = meta.mediaTime; got++;
          if (got < frames) video.requestVideoFrameCallback(step); else { clearTimeout(guard); resolve(); }
        }
        video.requestVideoFrameCallback(step);
      });
    }).then(function () {
      stream.getTracks().forEach(function (t) { t.stop(); });
      var s = rec.summary();
      s.fps = t1 > t0 ? r1((got - 1) / (t1 - t0)) : null; s.crop = [sx, sy, W, H]; s.canvas = [cv.width, cv.height]; s.css = [cv.clientWidth, cv.clientHeight]; s.dpr = root.devicePixelRatio;
      return s;
    });
  }

  /** Saved frames (URLs, in order), a crop of `size` px at `at`: the same record as capture(). */
  function fromImages(urls, o) {
    o = o || {};
    var at = o.at || [0.5, 0.5], rec = null, ctx = null, W = 0, H = 0, sx = 0, sy = 0, c2 = document.createElement('canvas');
    function one(k) {
      if (k >= urls.length) { var s = rec.summary(); s.crop = [sx, sy, W, H]; return s; }
      return new Promise(function (resolve, reject) { var im = new Image(); im.onload = function () { resolve(im); }; im.onerror = function () { reject(new Error('mirror probe: no frame ' + urls[k])); }; im.src = urls[k]; })
        .then(function (im) {
          if (!rec) {
            W = Math.min(o.size || 360, im.naturalWidth); H = Math.min(o.size || 360, im.naturalHeight);
            sx = Math.round((im.naturalWidth - W) * at[0]); sy = Math.round((im.naturalHeight - H) * at[1]);
            c2.width = W; c2.height = H; ctx = c2.getContext('2d', { willReadFrequently: true }); rec = watch(W, H, o.visited);
          }
          ctx.drawImage(im, sx, sy, W, H, 0, 0, W, H);
          rec.add(ctx.getImageData(0, 0, W, H).data);
          return one(k + 1);
        });
    }
    return one(0);
  }

  root.__mirrorProbe = { capture: capture, fromImages: fromImages, watch: watch, lab: lab, mapCanvas: mapCanvas, version: 2 };
})(typeof window !== 'undefined' ? window : globalThis);
