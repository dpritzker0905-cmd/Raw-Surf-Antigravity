// THE INFOBOX READS THE FRAME THE MAP DRAWS (2026-11-23, SOTA-GAP inspection finding 10; ownFrameReadout.js, DARK behind
// REACT_APP_INFOBOX_OWN_FRAME). Offline only: the SPA under AB_BASE, our own GFS pressure frames from the local fixture CDN
// (raster-lab/own_frames_fixture.js --serve), every /api/weather ask answered 404 by a local stub, Open-Meteo hosts ABORTED (the
// .om path never draws), the live API host never reached (ab_lib's route + host audit).
// Per point: pressure on (drawn from our frames), the infobox opened through the app's own setter, then for each hour in HOURS the
// wheel moves there and the probe waits until the frame on screen is the one asked for and the card is stable. It records the card's
// Pressure row (its text and accessible name), the shown frame path, and the SAME frame's value at the point decoded HERE, in Node,
// from the fixture's bytes (gunzip, RSWF header, byte-shuffled u16 plane, bilinear on the cell-centre lattice): an independent
// reader of what the GPU was given. Check: the card's hPa == round(frame value).
//   AB_BASE=http://127.0.0.1:<spa> OWN_CDN=http://127.0.0.1:<cdn>/ FIXTURE_DIR=<dir> OUT=<file.json> node scn_infobox_own_frame.js
// Env: POINTS (lat:lng;..., default 18:-70 the tight tropical low, 52:-40 the subpolar low, 28:-40 the subtropical high),
// HOURS (default 0,9,24), THEME (dark), VP (desktop|phone), STABLE (1000 ms), WIN (20000 ms).
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('scn_infobox_own_frame is offline only');
const { AB_BASE, OWN_CDN, FIXTURE_DIR, OUT } = process.env;
if (!AB_BASE || !OWN_CDN || !FIXTURE_DIR || !OUT) throw Error('AB_BASE, OWN_CDN, FIXTURE_DIR and OUT are required');
const POINTS = (process.env.POINTS || '18:-70;52:-40;28:-40').split(';').map((p) => { const [lat, lng] = p.split(':').map(Number); return { lat, lng }; });
const HOURS = (process.env.HOURS || '0,9,24').split(',').map(Number);
const THEME = process.env.THEME || 'dark';
const PHONE = process.env.VP === 'phone';
const STABLE = +(process.env.STABLE || 1000);
const WIN = +(process.env.WIN || 20000);
const WHEEL = '[role="slider"][aria-label*="timeline wheel"]';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The fixture frame's value at (lat, lng), decoded independently of the app (the RSWF layout own_frames_fixture.js writes). */
function frameValueAt(rel, lat, lng) {
  const buf = zlib.gunzipSync(fs.readFileSync(path.join(FIXTURE_DIR, rel)));
  const cols = buf.readUInt16LE(8); const rows = buf.readUInt16LE(10); const dataAt = buf.readUInt32LE(20);
  const west = buf.readDoubleLE(24); const south = buf.readDoubleLE(32); const east = buf.readDoubleLE(40); const north = buf.readDoubleLE(48);
  const scale = buf.readDoubleLE(80); const offset = buf.readDoubleLE(88); const n = cols * rows;
  const val = (c, r) => { const k = r * cols + c; const code = buf[dataAt + k] | (buf[dataAt + n + k] << 8); return code === 0 ? null : code * scale + offset; };
  const dLon = (east - west) / (cols - 1); const dLat = (north - south) / (rows - 1);
  const fx = (lng - west) / dLon; const fy = Math.min(Math.max((lat - south) / dLat, 0), rows - 1);
  const x0 = Math.floor(fx); const tx = fx - x0; const c0 = ((x0 % cols) + cols) % cols; const c1 = (c0 + 1) % cols;
  const y0 = Math.min(Math.floor(fy), rows - 2); const ty = fy - y0;
  const q = [val(c0, y0), val(c1, y0), val(c0, y0 + 1), val(c1, y0 + 1)];
  if (q.some((v) => v == null)) return null;
  return (q[0] * (1 - tx) + q[1] * tx) * (1 - ty) + (q[2] * (1 - tx) + q[3] * tx) * ty;
}

const READ = () => {
  const t = window.__RAW_OWN_RASTER__ || {};
  const ov = document.querySelector('[data-testid="forecast-overlay"]');
  const rows = ov ? [...ov.querySelectorAll('[role="listitem"]')].map((x) => ({ aria: x.getAttribute('aria-label') || '', text: x.textContent.trim() })) : [];
  const p = rows.find((r) => /^Pressure/.test(r.aria));
  return { overlay: !!ov, shown: t.shown && t.shown.path, want: t.want && t.want.path, pressure: p || null, rows: rows.map((r) => r.aria).slice(0, 8) };
};
function keyRun(from, to) {
  const d = to - from; const keys = [];
  for (let i = 0; i < Math.floor(Math.abs(d) / 24); i++) keys.push(d > 0 ? 'PageUp' : 'PageDown');
  for (let i = 0; i < Math.abs(d) % 24; i++) keys.push(d > 0 ? 'ArrowRight' : 'ArrowLeft');
  return keys;
}

(async () => {
  const stub = http.createServer((req, res) => { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"detail":"offline stub"}'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const out = { env: { AB_BASE, OWN_CDN, POINTS, HOURS, THEME, phone: PHONE, startedUtc: new Date().toISOString() }, sessions: [] };
  try {
    for (const pt of POINTS) {
      const { browser, page, log } = await L.launch(PHONE
        ? { port: stub.address().port, width: 390, height: 844, dpr: 3, contextOptions: { isMobile: true, hasTouch: true } }
        : { port: stub.address().port, width: 1280, height: 800 });
      await page.route(/open-meteo/, (route) => route.abort());   // the .om path is never drawn or fetched here
      await page.addInitScript(({ cdn, theme }) => { window.__RAW_STATIC_FRAMES_BASE__ = cdn; try { localStorage.setItem('raw-surf-theme', theme); } catch (e) { /* */ } },
        { cdn: OWN_CDN, theme: THEME });
      const rowsOut = [];
      let bundle = null;
      try {
        await L.openMap(page);
        bundle = await page.evaluate(() => { const s = [...document.scripts].map((x) => x.src).find((x) => /\/main\.[0-9a-f]+\.js/.test(x)); return s ? s.split('/').pop() : null; });
        await L.jump(page, pt.lng, pt.lat, 4);
        await sleep(2000);
        await page.evaluate(() => window.toggleLayer('pressure'));
        await page.waitForFunction(() => { const t = window.__RAW_OWN_RASTER__ || {}; return !!(t.shown && t.want && t.shown.path === t.want.path); }, null, { timeout: 60000 });
        await page.evaluate((p) => window.setLongPressLocation && window.setLongPressLocation({ lat: p.lat, lng: p.lng }), pt);
        await page.waitForSelector('[data-testid="forecast-overlay"]', { timeout: 15000 }).catch(() => null);
        await sleep(1500);
        for (const h of HOURS) {
          const from = await page.evaluate((sel) => { const w = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); return w ? +w.getAttribute('aria-valuenow') : 0; }, WHEEL);
          await page.locator(WHEEL).filter({ visible: true }).first().focus();
          for (const k of keyRun(from, h)) { await page.keyboard.press(k); await sleep(40); }
          const t0 = Date.now(); let last = null; let key = ''; let since = t0; let settled = null;
          while (Date.now() - t0 < WIN) {
            await sleep(100);
            const s = await page.evaluate(READ);
            const k = JSON.stringify([s.shown, s.want, s.pressure && s.pressure.aria]);
            if (k !== key) { key = k; since = Date.now(); }
            last = s;
            if (s.shown && s.shown === s.want && Date.now() - since >= STABLE) { settled = since - t0; break; }
          }
          const frame = last && last.shown ? frameValueAt(last.shown, pt.lat, pt.lng) : null;
          const cardHpa = last && last.pressure ? (/(\d{3,4}) h(Pa|ectopascals)/.exec(last.pressure.aria + ' ' + last.pressure.text) || [])[1] : null;
          const row = { hour: h, settledMs: settled, shown: last && last.shown, card: last && last.pressure, frameHpa: frame == null ? null : +frame.toFixed(2),
            cardHpa: cardHpa == null ? null : +cardHpa, rows: last && last.rows };
          row.match = row.cardHpa != null && frame != null && row.cardHpa === Math.round(frame);
          rowsOut.push(row);
          if (process.env.SHOT_DIR) {   // the card itself, per theme / viewport (three themes, desktop and phone)
            fs.mkdirSync(process.env.SHOT_DIR, { recursive: true });
            const shot = path.join(process.env.SHOT_DIR, `own-frame-${THEME}-${PHONE ? 'phone' : 'desktop'}-${pt.lat}_${pt.lng}-h${h}.png`);
            const ov = page.locator('[data-testid="forecast-overlay"]').filter({ visible: true }).first();
            await ov.screenshot({ path: shot }).catch(() => page.screenshot({ path: shot }));
            row.shot = shot;
          }
          console.log(`${pt.lat},${pt.lng} h${h}: card ${row.cardHpa ?? JSON.stringify(row.card && row.card.text)} | frame ${row.frameHpa} | ${row.match ? 'MATCH' : 'no match'} | ${row.shown}`);
        }
      } catch (e) {
        rowsOut.push({ error: String(e && e.message || e).slice(0, 300) });
      } finally {
        out.sessions.push({ point: pt, bundle, rows: rowsOut, errors: log.errors.slice(0, 5) });
        fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
        await browser.close();
      }
    }
  } finally {
    stub.close();
  }
  const all = out.sessions.flatMap((s) => s.rows.filter((r) => r.hour !== undefined));
  out.summary = { rows: all.length, match: all.filter((r) => r.match).length, noCardValue: all.filter((r) => r.cardHpa == null).length };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('summary', JSON.stringify(out.summary));
})().catch((e) => { console.error('FAIL', e.stack); process.exitCode = 1; });
