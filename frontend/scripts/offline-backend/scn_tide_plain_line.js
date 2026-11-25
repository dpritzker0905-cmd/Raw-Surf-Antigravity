// TIDE PLAIN LINE (2026-11-25, decision B on #1149): the tide shows a PLAIN number with a typographic minus and no datum name
// ("Tide −0.4 ft, falling"); the datum is said once per location in the infobox's info tip (TideDatumInfo.js). Offline only:
// ab_lib keeps the app's API host unreached, this file answers /api/weather/point-tide, /api/weather/spot-ratings and
// /api/surf-spots from page routes (an MLLW payload with a datum_info block and a NEGATIVE current height, and an MSL case), and
// every other /api/weather/* from a local 404 stub.
//
// Per case (mllw, msl) x theme (light, dark, beach) x viewport (desktop 1280x800, mobile 375x812), one fresh browser:
//   <case>-<theme>-<vp>-infobox-closed   the infobox tide readout, tip closed
//   <case>-<theme>-<vp>-infobox-open     the same with the tip open
//   <case>-<theme>-<vp>-marker           the Tide overlay markers
//   <case>-<theme>-<vp>-glyph-card       the spot-glyph card in Rating mode (stubbed spot-ratings carrying `tide`)
//   mobile only: <case>-<theme>-mobile-open-full (whole viewport, tip open)
// and tide-plain-line.json: texts read from the DOM, the open panel's box against the viewport / card / readout (overflow), and
// the keyboard check (Tab reaches the tip button, Enter opens, Escape closes and returns focus).
//
//   AB_BASE=http://127.0.0.1:<spa> OUT=<dir> node scn_tide_plain_line.js     Env: CASES (mllw,msl) THEMES (light,dark,beach) VIEWPORTS (desktop,mobile)
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ab_lib.js');

if (process.env.AB_LIVE === '1') throw Error('offline only');
const OUT = process.env.OUT || 'tide-plain-line-out';
const CASES = (process.env.CASES || 'mllw,msl').split(',');
const THEMES = (process.env.THEMES || 'light,dark,beach').split(',');
const VIEWPORTS = (process.env.VIEWPORTS || 'desktop,mobile').split(',');
const SUFFIX = process.env.SUFFIX || '';   // e.g. -v2: a re-run beside the first pass's files
fs.mkdirSync(OUT, { recursive: true });

// The datum_info block of tideDatum.test.js (Los Angeles gauge), with a real negative_note.
const BLOCK = {
  datum: 'MLLW', label: 'above MLLW', offset_m: 0.77, msl_minus_mllw_m: 0.851, mean_level_included_m: 0.081,
  source: 'gauge', source_label: 'NOAA CO-OPS gauge 9410660 Los Angeles (1.4 km)', epoch: '1983-2001',
  long_label: "Tide plus average sea-level rise, above MLLW (NOAA chart datum, 1983-2001 epoch). It includes the rise since the epoch (about 8 cm here, the 2016-2025 mean), so it reads that much above a NOAA tide table. It excludes today's ocean anomaly and storm surge, which can add tens of centimetres. Datum from NOAA CO-OPS gauge 9410660 Los Angeles (1.4 km).",
  negative_note: 'A negative number is a minus tide: water below mean lower low water. It is real, not an error.',
};

const now = Date.now();
const h0 = Math.floor(now / 3600e3) * 3600e3 - 6 * 3600e3;
// Falling through a NEGATIVE level around now: about -0.3 m (-1.0 ft) at the selected hour, so the line reads "−… ft, falling".
const level = (t, base) => Math.round((base - 0.3 * Math.sin((2 * Math.PI * (t - now)) / (12.42 * 3600e3))) * 1000) / 1000;
function payload(kind) {
  const base = kind === 'mllw' ? -0.3 : -0.35;
  const series = [...Array(78)].map((_, i) => { const t = h0 + i * 3600e3; return { t: new Date(t).toISOString().replace('.000', ''), h: level(t, base) }; });
  const events = [];
  for (let i = 1; i < series.length - 1; i++) {
    const [a, b, c] = [series[i - 1].h, series[i].h, series[i + 1].h];
    if (b > a && b >= c) events.push({ type: 'High', time: series[i].t, height_m: b });
    if (b < a && b <= c) events.push({ type: 'Low', time: series[i].t, height_m: b });
  }
  const common = { available: true, now: new Date(now).toISOString(), series, events, cell_km: 11,
    coverage: [{ start: series[0].t, end: series[series.length - 1].t }],
    provider: 'FES2022 (CNES; LEGOS, NOVELTIS, CLS via AVISO) + Copernicus Marine', source_url: 'https://doi.org/10.24400/527896/A01-2024.004' };
  return kind === 'mllw'
    ? { ...common, timezone: 'America/Los_Angeles', datum: 'MLLW', datum_info: BLOCK, source: 'model-mllw' }
    : { ...common, timezone: 'Europe/Paris', datum: 'MSL', datum_info: { datum: 'MSL', offset_m: 0 }, source: 'model-msl' };
}
// Spots 2-8 km apart so z11.5 shows them unclustered: Los Angeles (MLLW) and Hossegor (MSL).
const SITES = {
  mllw: { center: [-118.43, 33.87], zoom: 11.5, spots: [
    { id: 's1', name: 'El Porto', latitude: 33.8956, longitude: -118.4219 },
    { id: 's2', name: 'Hermosa Pier', latitude: 33.8622, longitude: -118.4016 },
    { id: 's3', name: 'Redondo Breakwater', latitude: 33.8443, longitude: -118.3952 }] },
  msl: { center: [-1.44, 43.67], zoom: 11.5, spots: [
    { id: 'f1', name: 'La Graviere', latitude: 43.6655, longitude: -1.4470 },
    { id: 'f2', name: 'Les Estagnots', latitude: 43.7050, longitude: -1.4290 },
    { id: 'f3', name: 'La Piste', latitude: 43.6390, longitude: -1.4500 }] },
};
// Rating rows carrying a tide the way the backend bakes it: MLLW display height -0.12 m (−0.4 ft) falling; MSL -0.25 m.
const ratingTide = (kind) => (kind === 'mllw'
  ? { height_m: -0.6, display_height_m: -0.12, datum: 'MLLW', datum_src: 'gauge', norm: 0.2, trend: 'falling' }
  : { height_m: -0.25, norm: 0.3, trend: 'rising' });
const ratings = (kind) => ({ source: 'live', spots: SITES[kind].spots.map((s, i) => ({ spot_id: s.id, score: 70 - 10 * i,
  level: ['good', 'fair', 'poor'][i] || 'fair', confidence: 'medium', surf_height_m: 1.2, period_s: 12, tide: ratingTide(kind),
  why: 'Offshore wind, mid tide' })) });

const stub = http.createServer((req, res) => { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"detail":"not served by this stub"}'); });
const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

// In-page measurement of the tip panel and its containers.
const MEASURE = () => {
  const box = (x) => { if (!x) return null; const b = x.getBoundingClientRect(); return { left: +b.left.toFixed(1), top: +b.top.toFixed(1), right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) }; };
  const btn = document.querySelector('[data-testid="tide-readout"] button[data-testid="tide-datum"]');
  const panel = document.querySelector('[data-testid="tide-readout"] [data-testid="tide-datum-tip"]');
  const readout = document.querySelector('[data-testid="tide-readout"]');
  const card = document.querySelector('[data-testid="forecast-overlay"]');
  const pb = box(panel); const cb = box(card); const rb = box(readout);
  const inside = (a, b) => !!a && !!b && a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
  const horiz = (a, b) => !!a && !!b && a.left >= b.left - 0.5 && a.right <= b.right + 0.5;
  const vp = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  return {
    viewport: { w: innerWidth, h: innerHeight }, docScrollWidth: document.documentElement.scrollWidth,
    pageHorizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    button: box(btn), buttonText: btn ? btn.textContent : null, ariaExpanded: btn ? btn.getAttribute('aria-expanded') : null,
    panel: pb, panelHidden: panel ? panel.hidden : null, panelText: panel ? panel.textContent : null,
    panelScrollOverflow: panel ? panel.scrollWidth > panel.clientWidth + 1 : null,
    readout: rb, card: cb, cardScroll: card ? { scrollW: card.scrollWidth, clientW: card.clientWidth, scrollH: card.scrollHeight, clientH: card.clientHeight } : null,
    panelInViewport: inside(pb, vp), panelInCard: inside(pb, cb), panelInCardHoriz: horiz(pb, cb), panelInReadoutHoriz: horiz(pb, rb),
    readoutInViewport: inside(rb, vp),
    // The card is a scroll region: a panel taller than its visible window cannot be read whole without scrolling.
    panelTallerThanCardWindow: !!pb && !!card && pb.height > card.clientHeight,
    panelHiddenBelowCardPx: pb && cb ? Math.max(0, +(pb.bottom - cb.bottom).toFixed(1)) : null,
  };
};

async function clickExact(page, text) {
  const loc = page.locator('button').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: 10000 });
  await loc.click({ timeout: 10000 });
}
async function wavesOn(page, mobile) {
  if (!mobile) { try { await clickExact(page, 'Waves'); return 'desktop-panel'; } catch (e) { /* fall through to the sheet */ } }
  await page.locator('button[aria-label="Weather layers"], button[aria-label="Expand weather controls"]').filter({ visible: true }).first().click({ timeout: 10000 });
  await page.waitForTimeout(800);
  await clickExact(page, 'Waves');
  await page.waitForTimeout(800);
  const close = page.locator('button[aria-label^="Close weather layers"]').filter({ visible: true }).first();
  if (await close.count()) await close.click({ timeout: 5000 });
  return 'sheet';
}
// A padded clip around an element, kept inside the viewport.
async function clipShot(page, selector, file, pad = 16, extra = null) {
  const b = await page.evaluate(({ sel, extraSel }) => {
    const els = [document.querySelector(sel)].concat(extraSel ? [...document.querySelectorAll(extraSel)] : []).filter(Boolean);
    if (!els.length) return null;
    const rs = els.map((e) => e.getBoundingClientRect());
    return { l: Math.min(...rs.map((r) => r.left)), t: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)), W: innerWidth, H: innerHeight };
  }, { sel: selector, extraSel: extra });
  if (!b) return { file: null, error: `no ${selector}` };
  const x = Math.max(0, b.l - pad); const y = Math.max(0, b.t - pad);
  const clip = { x, y, width: Math.min(b.W, b.r + pad) - x, height: Math.min(b.H, b.b + pad) - y };
  if (clip.width < 2 || clip.height < 2) return { file: null, error: 'empty clip', clip };
  await page.screenshot({ path: file, clip });
  return { file: path.basename(file), clip };
}

(async () => {
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  const port = stub.address().port;
  const results = {};
  for (const kind of CASES) for (const theme of THEMES) for (const vpName of VIEWPORTS) {
    const mobile = vpName === 'mobile';
    const tag = `${kind}-${theme}-${vpName}`;
    const ftag = `${tag}${SUFFIX}`;
    const site = SITES[kind];
    const r = (results[tag] = { case: kind, theme, viewport: vpName });
    const { browser, page, log } = await L.launch({ port, width: mobile ? 375 : 1280, height: mobile ? 812 : 800, dpr: mobile ? 2 : 1, gpu: false,
      contextOptions: mobile ? { isMobile: true, hasTouch: true } : {} });
    try {
      const asked = { pointTide: 0, spotRatings: 0 };
      await page.route(/\/api\/surf-spots(\?|$)/, (route) => route.fulfill(json(site.spots.map((s) => ({ ...s, is_active: true })))));
      await page.route(/\/api\/weather\/point-tide(\?|$)/, (route) => { asked.pointTide += 1; return route.fulfill(json(payload(kind))); });
      await page.route(/\/api\/weather\/spot-ratings(\?|$)/, (route) => { asked.spotRatings += 1; return route.fulfill(json(ratings(kind))); });
      await page.addInitScript((t) => {
        localStorage.setItem('raw-surf-theme', t); localStorage.setItem('__TIDE_OVERLAY__', 'true');
        localStorage.setItem('__SURF_MODE__', 'true'); window.__SURF_MODE__ = true;
      }, theme);
      await L.openMap(page);
      await L.jump(page, site.center[0], site.center[1], site.zoom);
      await page.waitForTimeout(2500);

      // (3) Tide overlay markers.
      try {
        await page.waitForSelector('[data-testid="tide-marker"]', { timeout: 20000 });
        await page.waitForTimeout(1200);
        r.marker = await page.evaluate(() => [...document.querySelectorAll('[data-testid="tide-marker"]')].map((m) => {
          const b = m.getBoundingClientRect();
          return { text: m.innerText.replace(/\s+/g, ' ').trim(), aria: m.getAttribute('aria-label'), inViewport: b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight,
            box: { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) } };
        }));
        r.markerShot = await clipShot(page, '[data-testid="tide-marker"]', path.join(OUT, `${ftag}-marker.png`), 40, '[data-testid="tide-marker"]');
      } catch (e) { r.marker = { error: String(e).slice(0, 200) }; }

      // (4) Glyph card in Rating mode: focus opens the same card as hover (works on touch too); desktop also hovers.
      try {
        const name = site.spots[0].name;
        const glyph = page.locator(`button[aria-label*="${name}"]`).first();
        await glyph.waitFor({ state: 'attached', timeout: 15000 });
        // wait for the rating to land (aria-label then carries the tide words)
        await page.waitForFunction((n) => { const b = [...document.querySelectorAll('button[aria-label]')].find((x) => x.getAttribute('aria-label').includes(n)); return b && /tide/i.test(b.getAttribute('aria-label')); }, name, { timeout: 15000 }).catch(() => {});
        if (mobile) await glyph.focus(); else await glyph.hover();
        await page.waitForTimeout(700);
        r.glyph = await page.evaluate((n) => {
          const b = [...document.querySelectorAll('button[aria-label]')].find((x) => x.getAttribute('aria-label').includes(n));
          const card = b && b.parentElement ? [...b.parentElement.querySelectorAll('div')].find((d) => /Tide /.test(d.textContent) && d.className.includes('bottom-full')) : null;
          const line = card ? [...card.querySelectorAll('div')].find((d) => /^\s*\S*\s*Tide /.test(d.textContent) && d.className.includes('text-sky-300')) : null;
          const cb = card && card.getBoundingClientRect();
          return { aria: b ? b.getAttribute('aria-label') : null, cardFound: !!card, tideLine: line ? line.textContent.trim() : null,
            cardText: card ? card.innerText.replace(/\s+/g, ' ').trim() : null,
            cardInViewport: cb ? cb.left >= 0 && cb.right <= innerWidth && cb.top >= 0 && cb.bottom <= innerHeight : null };
        }, name);
        await page.evaluate((n) => { const b = [...document.querySelectorAll('button[aria-label]')].find((x) => x.getAttribute('aria-label').includes(n)); if (b) b.setAttribute('data-scn-glyph', '1'); }, name);
        r.glyphShot = await clipShot(page, '[data-scn-glyph="1"]', path.join(OUT, `${ftag}-glyph-card.png`), 24, '[data-scn-glyph="1"] ~ div, [data-scn-glyph="1"] div.bottom-full');
        if (mobile) await page.evaluate(() => document.activeElement && document.activeElement.blur()); else await page.mouse.move(5, 400);
        await page.waitForTimeout(300);
      } catch (e) { r.glyph = { error: String(e).slice(0, 200) }; }

      // (1)/(2) Infobox: Waves on, a point placed through the app's own setter, the readout waited for.
      try {
        r.wavesVia = await wavesOn(page, mobile);
        await page.waitForTimeout(1000);
        const pt = { lat: site.spots[1].latitude, lng: site.spots[1].longitude };
        await page.evaluate((p) => window.setLongPressLocation && window.setLongPressLocation(p), pt);
        await page.waitForSelector('[data-testid="tide-readout"] [data-testid="tide-height"]', { timeout: 30000 });
        await page.waitForTimeout(1200);
        await page.evaluate(() => { const el = document.querySelector('[data-testid="tide-readout"]'); if (el) el.scrollIntoView({ block: 'nearest' }); });
        r.readout = await page.evaluate(() => {
          const ro = document.querySelector('[data-testid="tide-readout"]');
          const row = ro.querySelector('.flex');
          return { height: ro.querySelector('[data-testid="tide-height"]').textContent, line: row ? row.innerText.replace(/\s+/g, ' ').trim() : null,
            hasDatumWordInLine: row ? /MLLW|MSL|mean sea/i.test(row.textContent) : null, startsWithTypoMinus: /^−/.test(ro.querySelector('[data-testid="tide-height"]').textContent),
            hasAsciiHyphenMinus: /^-/.test(ro.querySelector('[data-testid="tide-height"]').textContent),
            // The readout's other number lines (next high / low, the MLLW-only MSL line) and any ASCII hyphen-minus left in them.
            nextLines: [...ro.querySelectorAll('div')].filter((d) => /^Next (high|low)/.test(d.textContent)).map((d) => d.textContent),
            mslLine: (ro.querySelector('[data-testid="tide-msl-line"]') || {}).textContent || null,
            asciiMinusLeft: [...ro.querySelectorAll('div')].filter((d) => /^Next (high|low)/.test(d.textContent) || d.getAttribute('data-testid') === 'tide-msl-line')
              .map((d) => d.textContent).filter((t) => /(^|\s)-\d/.test(t)),
            typoMinusCount: (ro.textContent.match(/−/g) || []).length };
        });
        r.closed = await page.evaluate(MEASURE);
        r.closedShot = await clipShot(page, '[data-testid="tide-readout"]', path.join(OUT, `${ftag}-infobox-closed.png`), 16, '[data-testid="forecast-overlay"]');

        // Keyboard: start at the card region, Tab until the tip button has focus.
        const kb = { tabs: null };
        await page.evaluate(() => { const c = document.querySelector('[data-testid="forecast-overlay"]'); if (c) c.focus(); });
        for (let i = 1; i <= 40; i++) {
          await page.keyboard.press('Tab');
          const on = await page.evaluate(() => { const a = document.activeElement; return !!a && a.getAttribute('data-testid') === 'tide-datum' && a.tagName === 'BUTTON'; });
          if (on) { kb.tabs = i; break; }
        }
        kb.reachedByTab = kb.tabs != null;
        if (kb.reachedByTab) {
          await page.keyboard.press('Enter'); await page.waitForTimeout(250);
          kb.afterEnter = await page.evaluate(() => { const b = document.activeElement; const p = document.getElementById(b.getAttribute('aria-controls')); return { ariaExpanded: b.getAttribute('aria-expanded'), panelHidden: p ? p.hidden : null }; });
          await page.keyboard.press('Escape'); await page.waitForTimeout(250);
          kb.afterEscape = await page.evaluate(() => { const b = document.querySelector('[data-testid="tide-readout"] button[data-testid="tide-datum"]'); return { ariaExpanded: b.getAttribute('aria-expanded'), focusOnButton: document.activeElement === b, infoboxStillOpen: !!document.querySelector('[data-testid="forecast-overlay"]') }; });
          await page.keyboard.press('Space'); await page.waitForTimeout(250);
          kb.afterSpace = await page.evaluate(() => { const b = document.querySelector('[data-testid="tide-readout"] button[data-testid="tide-datum"]'); return { ariaExpanded: b.getAttribute('aria-expanded') }; });
          kb.pass = kb.afterEnter.ariaExpanded === 'true' && kb.afterEscape.ariaExpanded === 'false' && kb.afterEscape.focusOnButton;
          // Tab from the open button INTO the panel (focusable when open), scroll it by keyboard, Escape from inside it.
          if (kb.afterSpace.ariaExpanded === 'true') {
            await page.keyboard.press('Tab'); await page.waitForTimeout(150);
            kb.tabIntoPanel = await page.evaluate(() => { const a = document.activeElement; const p = document.querySelector('[data-testid="tide-readout"] [data-testid="tide-datum-tip"]');
              return { focusOnPanel: a === p, activeTestId: a && a.getAttribute('data-testid'), panelTabIndex: p && p.getAttribute('tabindex'), panelRole: p && p.getAttribute('role'),
                panelLabel: p && p.getAttribute('aria-label'), scrollTop: p && p.scrollTop, scrollHeight: p && p.scrollHeight, clientHeight: p && p.clientHeight }; });
            await page.keyboard.press('End'); await page.waitForTimeout(300);
            kb.afterEndKey = await page.evaluate(() => { const p = document.querySelector('[data-testid="tide-readout"] [data-testid="tide-datum-tip"]'); return { scrollTop: p.scrollTop, atBottom: Math.abs(p.scrollTop + p.clientHeight - p.scrollHeight) <= 1 }; });
            await page.keyboard.press('Home'); await page.waitForTimeout(300);
            kb.afterHomeKey = await page.evaluate(() => { const p = document.querySelector('[data-testid="tide-readout"] [data-testid="tide-datum-tip"]'); return { scrollTop: p.scrollTop }; });
            await page.keyboard.press('Escape'); await page.waitForTimeout(250);
            kb.escapeFromPanel = await page.evaluate(() => { const b = document.querySelector('[data-testid="tide-readout"] button[data-testid="tide-datum"]'); return { ariaExpanded: b.getAttribute('aria-expanded'), focusOnButton: document.activeElement === b }; });
          }
          // Leave the tip OPEN (Enter on the focused button, as a user would) for the open-state measurement and screenshot.
          await page.keyboard.press('Enter');
        } else {
          await page.locator('[data-testid="tide-readout"] button[data-testid="tide-datum"]').click();
        }
        r.keyboard = kb;
        await page.waitForTimeout(400);
        // No manual scrolling: the open-state shot is where the app itself puts the panel (TideDatumInfo scrolls it into view on open).
        await page.waitForTimeout(300);
        r.open = await page.evaluate(MEASURE);
        r.openShot = await clipShot(page, '[data-testid="tide-readout"]', path.join(OUT, `${ftag}-infobox-open.png`), 16, '[data-testid="forecast-overlay"], [data-testid="tide-datum-tip"]');
        if (mobile) { await page.screenshot({ path: path.join(OUT, `${ftag}-open-full.jpg`), type: 'jpeg', quality: 70 }); r.openFull = `${ftag}-open-full.jpg`; }
        // The panel's own scroll: scroll it to the end and check its LAST characters are drawn inside the panel, the card's
        // visible window and the viewport.
        r.panelScroll = await page.evaluate(() => {
          const p = document.querySelector('[data-testid="tide-readout"] [data-testid="tide-datum-tip"]');
          const card = document.querySelector('[data-testid="forecast-overlay"]');
          const before = { scrollHeight: p.scrollHeight, clientHeight: p.clientHeight, scrollTop: p.scrollTop, scrolls: p.scrollHeight > p.clientHeight + 1 };
          p.scrollTop = p.scrollHeight;
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let last = null;
          while (walker.nextNode()) if (walker.currentNode.textContent.trim()) last = walker.currentNode;
          const txt = last.textContent.replace(/\s+$/, ''); const range = document.createRange();
          range.setStart(last, Math.max(0, txt.length - 12)); range.setEnd(last, txt.length);
          const lr = range.getBoundingClientRect(); const pr = p.getBoundingClientRect(); const cr = card.getBoundingClientRect();
          const within = (a, b) => a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5 && a.left >= b.left - 0.5 && a.right <= b.right + 0.5;
          return { ...before, scrollTopAtEnd: p.scrollTop, atBottom: Math.abs(p.scrollTop + p.clientHeight - p.scrollHeight) <= 1, lastChars: txt.slice(-12),
            lastLineBox: { top: +lr.top.toFixed(1), bottom: +lr.bottom.toFixed(1) }, panelBox: { top: +pr.top.toFixed(1), bottom: +pr.bottom.toFixed(1) },
            lastLineInPanel: within(lr, pr), lastLineInCardWindow: within(lr, cr), lastLineInViewport: lr.top >= 0 && lr.bottom <= innerHeight };
        });
        await page.waitForTimeout(200);
        r.openEndShot = await clipShot(page, '[data-testid="tide-readout"]', path.join(OUT, `${ftag}-infobox-open-end.png`), 16, '[data-testid="forecast-overlay"], [data-testid="tide-datum-tip"]');
      } catch (e) {
        r.infobox = { error: String(e).slice(0, 300) };
        await page.screenshot({ path: path.join(OUT, `${ftag}-infobox-FAIL.jpg`), type: 'jpeg', quality: 60 });
      }
      r.asked = asked;
      r.errors = log.errors.slice(0, 3);
    } catch (e) { r.fatal = String(e).slice(0, 300); }
    await browser.close();
    console.log(tag, JSON.stringify({ marker: r.marker && r.marker[0] && r.marker[0].text, glyph: r.glyph && r.glyph.tideLine, readout: r.readout, kb: r.keyboard && r.keyboard.pass, tabIn: r.keyboard && r.keyboard.tabIntoPanel && r.keyboard.tabIntoPanel.focusOnPanel, ps: r.panelScroll, open: r.open && { h: r.open.panel && r.open.panel.height, inCard: r.open.panelInCard, hidden: r.open.panelHiddenBelowCardPx }, err: r.infobox || r.fatal }));
  }
  fs.writeFileSync(path.join(OUT, `tide-plain-line${SUFFIX}.json`), JSON.stringify(results, null, 1));
  stub.close();
})();
