/**
 * AUDIT 13.1 — CAUSAL TRACE: SOURCE-PARITY-MISMATCH
 *
 * The HUD reports `layer: heatmap=swell_1 infobox=wind`. Exactly one of these is true:
 *   (A) the marine WebGL engine is STILL DRAWING a stale variable under a different active
 *       layer  -> renderer / state-ownership defect;
 *   (B) the engine is not drawing at all and the instrument is comparing dead metadata
 *       -> the instrument fabricates a violation (the WS-CAN-0010/0063 defect class).
 *
 * Discriminator: for each active layer, read simultaneously
 *   - window.__MARINE_SOURCE_PARITY__      (the verdict)
 *   - window.__WebGLMarineLayer_DIAG__     (the sibling instrument)
 *   - window.__MARINE_ENGINE__ internals   (is there wave data? vectors?)
 *   - the MapLibre style: is the marine custom layer PRESENT and VISIBLE?
 *   - an ablation: force the marine layer's visibility off, re-read the verdict.
 *
 * node parityprobe.js <baseUrl> <tag>
 */
const { chromium } = require('C:/Users/dprit/Raw-Surf/frontend/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:3000';
const TAG = process.argv[3] || 'local';
const OUT = 'C:/Users/dprit/Raw-Surf/audit/weather-simulation-13.1/evidence/causal-traces';
fs.mkdirSync(OUT, { recursive: true });

const user = { id: 'admin-user-id', email: 'admin@rawsurf.com', full_name: 'Admin Officer', username: 'adminuser', role: 'admin', subscription_tier: 'premium', is_admin: true };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const L = []; const say = (s) => { console.log(s); L.push(s); fs.writeFileSync(path.join(OUT, `${TAG}-parity-log.txt`), L.join('\n')); };

const PROBE = () => {
  const P = window.__MARINE_SOURCE_PARITY__ || null;
  const D = window.__WebGLMarineLayer_DIAG__ || null;
  const E = window.__MARINE_ENGINE__ || null;
  const m = window.__M__;
  let style = null;
  if (m) { try { const st = m.getStyle();
    const custom = st.layers.filter(l => l.type === 'custom');
    style = { total: st.layers.length,
      customLayers: custom.map(l => ({ id: l.id, vis: (() => { try { return m.getLayoutProperty(l.id, 'visibility') || 'visible'; } catch (e) { return '?'; } })() })),
      marineIds: st.layers.filter(l => /marine|heatmap|wave|swell|wind|water_temp|fog|precip|radar|ocean-mask/i.test(l.id))
        .map(l => ({ id: l.id, type: l.type,
          vis: (() => { try { return m.getLayoutProperty(l.id, 'visibility') || 'visible'; } catch (e) { return '?'; } })(),
          op: (() => { try { const k = l.type === 'raster' ? 'raster-opacity' : l.type === 'fill' ? 'fill-opacity' : l.type === 'line' ? 'line-opacity' : null;
            return k ? m.getPaintProperty(l.id, k) : null; } catch (e) { return '?'; } })() })) };
  } catch (e) { style = { err: String(e).slice(0, 100) }; } }
  let engine = null;
  if (E) { try { engine = { hasWaveData: !!E._waveData,
      waveDataLen: E._waveData && (E._waveData.length || (E._waveData.u && E._waveData.u.length) || null),
      activeLayer: E.activeLayer || E._activeLayer || null,
      activeModel: E.activeModel || E._activeModel || null,
      keys: Object.keys(E).filter(k => /layer|model|data|vector|visible|active|enabled/i.test(k)).slice(0, 25) }; } catch (e) { engine = { err: String(e).slice(0, 80) }; } }
  const body = document.body.innerText || '';
  const i = body.indexOf('TRUTH VIOLATIONS');
  const hudTruth = i < 0 ? null : body.slice(i + 16, i + 220).replace(/\s+/g, ' ').trim();
  const badge = (body.match(/TruthOverlay\s*[x×]\s*(\d+)/) || [])[1] || null;
  return { parity: P, webglDiag: D ? { activeModel: D.activeModel, activeLayer: D.activeLayer,
    infoboxHeatmapParity: D.infoboxHeatmapParity, vectorCount: D.vectorCount, nonzero: D.nonzero,
    keys: Object.keys(D).slice(0, 30) } : null, engine, style, hudTruth, badge };
};

(async () => {
  say(`=== PARITY CAUSAL TRACE — ${TAG} — ${BASE} — ${new Date().toISOString()} ===`);
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ u }) => {
    localStorage.setItem('raw-surf-user', JSON.stringify(u));
    localStorage.setItem(`tos-accepted-${u.id}-1.0`, Date.now().toString());
    localStorage.setItem('raw-surf-cookie-consent', JSON.stringify({ accepted: true, timestamp: Date.now() }));
    localStorage.setItem('rs-push-prompt-dismissed', Date.now().toString());
    localStorage.setItem('raw-surf-theme', 'dark');
  }, { u: user });
  await page.goto(`${BASE}/map`, { waitUntil: 'domcontentloaded' });
  await sleep(15000);
  await page.evaluate(() => { for (const k of Object.keys(window)) { try { const v = window[k];
    if (v && typeof v.isStyleLoaded === 'function' && typeof v.getZoom === 'function' && typeof v.jumpTo === 'function') { window.__M__ = v; return; } } catch (e) { } } });
  const click = async (l) => page.evaluate((x) => { const b = [...document.querySelectorAll('button')].find(e => (e.textContent || '').trim() === x); if (!b) return false; b.click(); return true; }, l);
  const jump = async (lng, lat, z) => page.evaluate(({ lng, lat, z }) => { if (window.__M__) window.__M__.jumpTo({ center: [lng, lat], zoom: z }); }, { lng, lat, z });

  await jump(-80.607, 28.361, 8); await sleep(6000);

  const trace = [];
  // Sequence chosen to CREATE the stale-metadata condition: a marine layer, then a non-marine one.
  const SEQ = ['Wind', 'Waves', 'Wind', 'Swell', 'Water Temp', 'Swell 2', 'Wind', 'Fog', 'Waves'];
  for (const layer of SEQ) {
    await click(layer); await sleep(9000);
    const r = await page.evaluate(PROBE);
    trace.push({ step: trace.length + 1, clicked: layer, ...r });
    const p = r.parity || {};
    say(`\n[${trace.length}] clicked=${layer}`);
    say(`   parity.status=${p.status} activeLayer=${p.activeLayer} heatmap.model=${p.heatmap && p.heatmap.model} heatmap.provider=${p.heatmap && p.heatmap.provider} heatmap.vectorCount=${p.heatmap && p.heatmap.vectorCount} heatmap.waveData=${p.heatmap && p.heatmap.waveData}`);
    say(`   mismatchReasons=${JSON.stringify(p.mismatchReasons)}  unsampled=${JSON.stringify(p.unsampledReasons)}`);
    say(`   webglDiag.activeLayer=${r.webglDiag && r.webglDiag.activeLayer} vectorCount=${r.webglDiag && r.webglDiag.vectorCount} infoboxHeatmapParity=${r.webglDiag && r.webglDiag.infoboxHeatmapParity}`);
    say(`   engine.hasWaveData=${r.engine && r.engine.hasWaveData} engine.activeLayer=${r.engine && r.engine.activeLayer}`);
    say(`   style.customLayers=${JSON.stringify(r.style && r.style.customLayers)}`);
    say(`   HUD badge=x${r.badge}  truth="${(r.hudTruth || '').slice(0, 120)}"`);
    fs.writeFileSync(path.join(OUT, `${TAG}-parity-trace.json`), JSON.stringify(trace, null, 2));
  }

  // ---------- ABLATION: hide the marine custom layer, re-read the verdict ----------
  say('\n=== ABLATION: set every custom (marine) layer visibility=none, then re-read parity ===');
  await click('Wind'); await sleep(9000);
  const pre = await page.evaluate(PROBE);
  const hid = await page.evaluate(() => {
    const m = window.__M__; if (!m) return null;
    const st = m.getStyle(); const ids = st.layers.filter(l => l.type === 'custom').map(l => l.id);
    ids.forEach(id => { try { m.setLayoutProperty(id, 'visibility', 'none'); } catch (e) { } });
    return ids; });
  await sleep(7000);
  const post = await page.evaluate(PROBE);
  say(`  custom layers hidden: ${JSON.stringify(hid)}`);
  say(`  BEFORE ablation: status=${pre.parity && pre.parity.status} reasons=${JSON.stringify(pre.parity && pre.parity.mismatchReasons)}`);
  say(`  AFTER  ablation: status=${post.parity && post.parity.status} reasons=${JSON.stringify(post.parity && post.parity.mismatchReasons)}`);
  say(`  NOTE: project record says visibility:'none' is silently reverted on OceanMask; check customLayers vis below.`);
  say(`  AFTER customLayers=${JSON.stringify(post.style && post.style.customLayers)}`);
  await page.screenshot({ path: path.join(OUT, `${TAG}-ablation-custom-hidden.png`) }).catch(() => { });

  fs.writeFileSync(path.join(OUT, `${TAG}-parity-ablation.json`), JSON.stringify({ hiddenIds: hid, pre, post }, null, 2));
  say('\n=== DONE ===');
  await ctx.close(); await browser.close();
})().catch(e => { console.error('FATAL', e); fs.writeFileSync(path.join(OUT, `${TAG}-parity-FATAL.txt`), String((e && e.stack) || e) + '\n' + L.join('\n')); process.exit(1); });
