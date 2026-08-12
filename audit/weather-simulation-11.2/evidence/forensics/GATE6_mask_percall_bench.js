/**
 * DIRECT per-call cost of the mask pipeline — no division.
 *
 * Every figure I have quoted for `suppressShelteredWater` (~1.4 s) came from dividing a 30 s
 * profile total (2.9 s of getImageData) by two observed calls. That is an inference, and this
 * session has already produced one refutation (`286a4e6b`) built on exactly that kind of number.
 * ★ Do not optimise against a quantity obtained by division. Measure the call.
 *
 * Method: run the REAL `classifySheltered` source — extracted programmatically from
 * marineMaskShelter.js, never retyped — inside a real browser on a real canvas, at the dimensions
 * production actually uses (dsW capped at 1024). Breaks the call into its four parts so the
 * measurement says WHICH one to attack:
 *
 *     drawImage (downsample)  ->  getImageData (readback)  ->  classifySheltered (JS)  ->  stamp-back
 *
 * ⛔ POSITIVE CONTROL FIRST. The extracted function must reproduce the verdicts the committed jest
 * suite pins (narrow entrance suppresses, wide entrance does not). If extraction drifted, every
 * timing below describes something other than the shipped code, and the script refuses.
 *
 * Usage: HEADED=1 node GATE6_mask_percall_bench.js
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const req = createRequire(path.resolve(__dirname, '../../../../frontend/package.json'));
const { chromium } = req('@playwright/test');

const SRC = path.resolve(__dirname, '../../../../frontend/src/components/map/marineMaskShelter.js');

/** Extract a top-level `export function NAME(...) { ... }` by brace balance. No copy-paste. */
function extractFunction(source, name) {
  const start = source.indexOf(`export function ${name}(`);
  if (start < 0) throw new Error(`${name} not found in ${SRC}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i).replace(/^export\s+/, '');
}

const classifySrc = extractFunction(fs.readFileSync(SRC, 'utf8'), 'classifySheltered');

(async () => {
  const browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('about:blank');

  const out = await page.evaluate(({ classifySrc, }) => {
    // eslint-disable-next-line no-new-func
    const classifySheltered = new Function(`${classifySrc}; return classifySheltered;`)();

    // ---- POSITIVE CONTROL: the extracted function must match the pinned verdicts ----
    const fromRows = (rows) => {
      const h = rows.length, w = rows[0].length;
      const water = new Uint8Array(w * h);
      rows.forEach((r, y) => { for (let x = 0; x < w; x++) water[y * w + x] = r[x] === '~' ? 1 : 0; });
      return { water, w, h };
    };
    const NARROW = ['~~~~~###############','~~~~~###############','~~~~~###############','~~~~~###############',
      '~~~~~#####~~~~~~~###','~~~~~#####~~~~~~~###','~~~~~#####~~~~~~~###','~~~~~~~~~~~~~~~~~###',
      '~~~~~#####~~~~~~~###','~~~~~#####~~~~~~~###','~~~~~#####~~~~~~~###','~~~~~###############',
      '~~~~~###############','~~~~~###############'];
    const WIDE = ['~~~~~###############','~~~~~###############','~~~~~###############','~~~~~###############',
      '~~~~~#####~~~~~~~###','~~~~~~~~~~~~~~~~~###','~~~~~~~~~~~~~~~~~###','~~~~~~~~~~~~~~~~~###',
      '~~~~~~~~~~~~~~~~~###','~~~~~~~~~~~~~~~~~###','~~~~~#####~~~~~~~###','~~~~~###############',
      '~~~~~###############','~~~~~###############'];
    const n = fromRows(NARROW), d = fromRows(WIDE);
    const control = {
      narrow: classifySheltered(n.water, n.w, n.h, 1).count,
      wide: classifySheltered(d.water, d.w, d.h, 1).count
    };
    if (!(control.narrow > 0 && control.wide === 0)) {
      return { controlFailed: true, control };
    }

    // ---- the real pipeline at production dimensions ----
    // Source canvas: what the mask renderer hands in. Downsample: capped at 1024 wide.
    const SRC_W = 4096, SRC_H = 2048, DS_W = 1024, DS_H = 512;
    const src = document.createElement('canvas');
    src.width = SRC_W; src.height = SRC_H;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    // A coastline-ish field: land blobs over water, so the classifier does real work rather than
    // short-circuiting on a uniform grid.
    sctx.fillStyle = '#fff'; sctx.fillRect(0, 0, SRC_W, SRC_H);
    sctx.fillStyle = '#000';
    for (let k = 0; k < 400; k++) {
      const x = (k * 9973) % SRC_W, y = (k * 7919) % SRC_H;
      sctx.fillRect(x, y, 40 + (k % 120), 30 + (k % 90));
    }

    const ds = document.createElement('canvas');
    ds.width = DS_W; ds.height = DS_H;
    const dctx = ds.getContext('2d', { willReadFrequently: true });

    const REPS = 12;
    const t = { draw: [], read: [], classify: [], stamp: [] };
    let lastCount = 0;
    for (let r = 0; r < REPS; r++) {
      let a = performance.now();
      dctx.imageSmoothingEnabled = true;
      dctx.drawImage(src, 0, 0, DS_W, DS_H);
      let b = performance.now(); t.draw.push(b - a);

      a = performance.now();
      const img = dctx.getImageData(0, 0, DS_W, DS_H);
      b = performance.now(); t.read.push(b - a);

      const px = img.data;
      const size = DS_W * DS_H;
      const water = new Uint8Array(size);
      for (let i = 0; i < size; i++) water[i] = px[i * 4] >= 128 ? 1 : 0;

      a = performance.now();
      const res = classifySheltered(water, DS_W, DS_H, 1);
      b = performance.now(); t.classify.push(b - a);
      lastCount = res.count;

      a = performance.now();
      for (let i = 0; i < size; i++) {
        if (res.sheltered[i]) { px[i * 4] = 64; px[i * 4 + 1] = 64; px[i * 4 + 2] = 64; px[i * 4 + 3] = 255; }
        else px[i * 4 + 3] = 0;
      }
      dctx.putImageData(img, 0, 0);
      const c2 = src.getContext('2d', { willReadFrequently: true });
      c2.imageSmoothingEnabled = false;
      c2.drawImage(ds, 0, 0, SRC_W, SRC_H);
      b = performance.now(); t.stamp.push(b - a);
    }

    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    return {
      control, dims: { SRC_W, SRC_H, DS_W, DS_H }, reps: REPS, shelteredCount: lastCount,
      draw: med(t.draw), read: med(t.read), classify: med(t.classify), stamp: med(t.stamp),
      spread: {
        draw: [Math.min(...t.draw).toFixed(1), Math.max(...t.draw).toFixed(1)],
        read: [Math.min(...t.read).toFixed(1), Math.max(...t.read).toFixed(1)],
        classify: [Math.min(...t.classify).toFixed(1), Math.max(...t.classify).toFixed(1)],
        stamp: [Math.min(...t.stamp).toFixed(1), Math.max(...t.stamp).toFixed(1)]
      }
    };
  }, { classifySrc });

  await browser.close();

  if (out.controlFailed) {
    console.log('⛔ POSITIVE CONTROL FAILED — the extracted classifySheltered does not reproduce the');
    console.log('   pinned verdicts (narrow>0, wide=0). Got:', JSON.stringify(out.control));
    console.log('   Every timing would describe something other than the shipped code. Refusing.');
    process.exit(2);
  }

  const total = out.draw + out.read + out.classify + out.stamp;
  console.log(`positive control PASSED (narrow=${out.control.narrow} suppressed, wide=${out.control.wide})`);
  console.log(`dims: source ${out.dims.SRC_W}x${out.dims.SRC_H} -> downsample ${out.dims.DS_W}x${out.dims.DS_H}`
    + `   reps=${out.reps}   sheltered px=${out.shelteredCount}\n`);
  const row = (k, v) => console.log(`  ${k.padEnd(24)} ${v.toFixed(1).padStart(7)} ms  ${((v / total) * 100).toFixed(0).padStart(3)}%   `
    + `range ${out.spread[k.split(' ')[0]] ? out.spread[k.split(' ')[0]].join('-') : ''}`);
  row('draw (downsample)', out.draw);
  row('read (getImageData)', out.read);
  row('classify (JS)', out.classify);
  row('stamp (back to source)', out.stamp);
  console.log(`  ${'TOTAL per call'.padEnd(24)} ${total.toFixed(1).padStart(7)} ms`);
  console.log('\n★ Medians of ' + out.reps + ' reps. Compare against the ~1.4 s per call I had been quoting');
  console.log('  by DIVISION — if these disagree, the division was wrong, not this.');
})().catch((e) => { console.error('BENCH ERROR:', e.message); process.exit(1); });
