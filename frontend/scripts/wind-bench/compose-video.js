#!/usr/bin/env node
/**
 * Wind bench: several motion-run.js runs played side by side as ONE WebM (VP8), for the eye.
 *
 *   node scripts/wind-bench/compose-video.js <out.webm> <cols> <pane css width> <fps> <loops> <title> <label>=<run name> [...]
 *
 * Each pane shows the centre of its run's frames (out/motion/<run name>/fNNN.jpg, one a 60 Hz tick), cropped to 3:2, under its label.
 * Real time at fps 60. The encoder is the ffmpeg Playwright installs (no system ffmpeg on the bench machines).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { FRONTEND } = require('./build');
const { serveDir } = require('./serve');
const [, , OUT, COLS, PANE_W, FPS, LOOPS, TITLE, ...CELLS] = process.argv;
const BENCH = __dirname;
const FF_ROOT = path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), '.cache'), 'ms-playwright');
const FF = (fs.existsSync(FF_ROOT) ? fs.readdirSync(FF_ROOT) : []).filter((d) => /^ffmpeg-/.test(d)).map((d) => path.join(FF_ROOT, d, process.platform === 'win32' ? 'ffmpeg-win64.exe' : 'ffmpeg-linux')).find((p) => fs.existsSync(p));

(async () => {
  if (!FF) throw new Error('no Playwright ffmpeg found under ' + FF_ROOT + ' (npx playwright install ffmpeg)');
  const outDir = path.join(BENCH, 'out');
  const cells = CELLS.map((c) => { const i = c.indexOf('='); return { label: c.slice(0, i), run: c.slice(i + 1) }; });
  const N = Math.min(...cells.map((c) => fs.readdirSync(path.join(outDir, 'motion', c.run)).filter((f) => /^f\d+\.jpg$/.test(f)).length));
  const cols = Number(COLS), pw = Number(PANE_W), ph = Math.round(pw * 2 / 3), rows = Math.ceil(cells.length / cols), gap = 8, head = TITLE ? 40 : 0, cap = 26;
  let W = cols * pw + (cols + 1) * gap, H = head + rows * (ph + cap + gap) + gap; W += W % 2; H += H % 2;
  fs.writeFileSync(path.join(outDir, 'motion', 'compose.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#14171c"><canvas id="c"></canvas></body></html>');
  const server = await serveDir(outDir, undefined, {});
  const { chromium } = require(path.join(FRONTEND, 'node_modules', 'playwright'));
  const browser = await chromium.launch({ headless: true });
  const frames = [];
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(`http://127.0.0.1:${server.address().port}/motion/compose.html`);
    await page.evaluate(([w, h]) => { const c = document.getElementById('c'); c.width = w; c.height = h; }, [W, H]);
    for (let i = 0; i < N; i++) {
      const url = await page.evaluate(async ([cs, idx, o]) => {
        const c = document.getElementById('c'), ctx = c.getContext('2d');
        ctx.fillStyle = '#14171c'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#e6e9ee'; ctx.textBaseline = 'middle';
        if (o.title) { ctx.font = '600 19px system-ui, sans-serif'; ctx.fillText(o.title, o.gap + 2, o.head / 2 + 2); }
        for (let k = 0; k < cs.length; k++) {
          const im = new Image();
          await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('no frame ' + cs[k].run + ' ' + idx)); im.src = '/motion/' + cs[k].run + '/f' + String(idx).padStart(3, '0') + '.jpg'; });
          const x = o.gap + (k % o.cols) * (o.pw + o.gap), y = o.head + o.gap + Math.floor(k / o.cols) * (o.ph + o.cap + o.gap);
          ctx.font = '600 15px system-ui, sans-serif'; ctx.fillStyle = '#e6e9ee'; ctx.fillText(cs[k].label, x + 2, y + o.cap / 2);
          const sw = im.width, sh = Math.round(im.width * 2 / 3), sy = Math.round((im.height - sh) / 2);
          ctx.drawImage(im, 0, sy, sw, sh, x, y + o.cap, o.pw, o.ph);
        }
        return c.toDataURL('image/jpeg', 0.92);
      }, [cells, i, { cols, pw, ph, gap, head, cap, title: TITLE }]);
      frames.push(Buffer.from(url.split(',')[1], 'base64'));
    }
  } finally { await browser.close(); server.close(); }
  const input = Buffer.concat(Array.from({ length: Number(LOOPS) || 1 }, () => Buffer.concat(frames)));
  const r = spawnSync(FF, ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-avioflags', 'direct', '-fpsprobesize', '0', '-probesize', '32', '-analyzeduration', '0', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', 'pipe:0',
    '-an', '-c:v', 'vp8', '-b:v', '6M', '-qmin', '4', '-qmax', '28', '-r', String(FPS), OUT], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || '').toString().slice(0, 400));
  console.log('wrote', OUT, fs.statSync(OUT).size, 'bytes ·', N, 'frames x', LOOPS, 'loops at', FPS, 'fps ·', W, 'x', H);
})().catch((e) => { console.error(e.stack || e.message); process.exitCode = 2; });
