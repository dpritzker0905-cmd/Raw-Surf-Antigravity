/**
 * AUDIT 13.1 — FINDING F1 FALSIFICATION, READ-ONLY, AGAINST PRODUCTION
 *
 * Claim under test: /conditions/batch `swell_height_ft` is filled from the WAVES layer's
 * point.speed (VHM0, total offshore significant height) on the precomputed frame lane, while
 * the live lane fills it from swell_1 (VHM0_SW1, the primary swell partition).
 *
 * Read-only discriminator (no env var is changed on any service):
 *   published  = /api/conditions/batch            -> conditions[id].swell_height_ft
 *   VHM0       = /api/weather/point layer=waves   -> point.speed  * M_TO_FT
 *   VHM0_SW1   = /api/weather/point layer=swell_1 -> point.speed  * M_TO_FT
 * Then ask which candidate the published number equals.
 *
 * FALSIFIED (finding downgrades to a naming defect) if published tracks VHM0_SW1.
 * CONFIRMED if published tracks VHM0.
 */
const API = 'https://raw-surf-antigravity.onrender.com/api';
const M_TO_FT = 3.28084;
const OUT = 'C:/Users/dprit/Raw-Surf/audit/weather-simulation-13.1/evidence/scientific-validation';
const fs = require('fs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const REGIONS = [
  { n: 'Florida east coast', bbox: '-81.5,27.0,-79.5,29.5' },
  { n: 'California',         bbox: '-123.5,36.0,-120.5,38.5' },
  { n: 'Portugal / Iberia',  bbox: '-10.5,37.0,-8.0,41.5' },
  { n: 'Hawaii',             bbox: '-158.5,21.0,-157.5,21.8' },
  { n: 'New York / NJ',      bbox: '-74.5,39.5,-71.5,41.2' },
];

const j = async (url, tries = 4) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (r.status === 429 || r.status >= 500) { await sleep(4000 * (i + 1)); continue; }
      if (!r.ok) return { __http: r.status };
      return await r.json();
    } catch (e) { await sleep(3000 * (i + 1)); }
  }
  return { __http: 'timeout/exhausted' };
};

(async () => {
  const VT = new Date().toISOString().replace(/:\d\d\.\d+Z$/, ':00:00Z').replace(/T(\d\d):\d\d/, 'T$1');
  const vt = new Date().toISOString().slice(0, 14) + '00:00Z';
  console.log('=== F1 FALSIFICATION — READ-ONLY — PRODUCTION ===');
  console.log('valid_time  :', vt);
  const health = await j(`${API}/health`);
  console.log('backend     :', (health.version || '?').slice(0, 60), '|', health.status);
  console.log('');

  // ---- 1. collect spots per region ----
  const spots = [];
  for (const R of REGIONS) {
    const sr = await j(`${API}/weather/spot-ratings?bbox=${R.bbox}&valid_time=${vt}&model=GFS&limit=8`);
    const list = (sr && sr.spots) || [];
    console.log(`region ${R.n.padEnd(20)} -> ${String(list.length).padStart(2)} spots | ratings source=${sr.source || '?'} served_valid_time=${sr.served_valid_time || '-'} frame_offset_h=${sr.frame_offset_hours ?? '-'}`);
    for (const s of list.slice(0, 4)) {
      spots.push({ region: R.n, id: s.spot_id, name: s.name, lat: s.latitude, lng: s.longitude,
        frame_offshore_hs_m: s.offshore_hs_m, frame_surf_height_m: s.surf_height_m, run_time: s.run_time });
    }
    await sleep(600);
  }
  console.log(`\ncollected ${spots.length} spots across ${REGIONS.length} regions\n`);
  if (!spots.length) { console.log('NO SPOTS — aborting'); return; }

  // ---- 2. /conditions/batch (the published value + which lane answered) ----
  const ids = spots.map(s => s.id).join(',');
  const batch = await j(`${API}/conditions/batch?spot_ids=${ids}&model=GFS`);
  const cs = batch.conditions_source || {};
  console.log('conditions_source:', JSON.stringify(cs));
  console.log('');

  // ---- 3. per spot: waves vs swell_1 ----
  const rows = [];
  for (const s of spots) {
    const pub = (batch.conditions || {})[s.id];
    const w = await j(`${API}/weather/point?model=GFS&domain=marine&layer=waves&lat=${s.lat}&lng=${s.lng}&valid_time=${vt}`);
    await sleep(350);
    const s1 = await j(`${API}/weather/point?model=GFS&domain=marine&layer=swell_1&lat=${s.lat}&lng=${s.lng}&valid_time=${vt}`);
    await sleep(350);
    const vhm0_m = w && w.point ? w.point.speed : null;
    const sw1_m = s1 && s1.point ? s1.point.speed : null;
    const published_ft = pub ? pub.swell_height_ft : null;
    const vhm0_ft = vhm0_m == null ? null : Math.round(vhm0_m * M_TO_FT * 10) / 10;
    const sw1_ft = sw1_m == null ? null : Math.round(sw1_m * M_TO_FT * 10) / 10;
    const dW = (published_ft != null && vhm0_ft != null) ? Math.abs(published_ft - vhm0_ft) : null;
    const dS = (published_ft != null && sw1_ft != null) ? Math.abs(published_ft - sw1_ft) : null;
    let verdict = 'INDETERMINATE';
    if (dW != null && dS != null) {
      if (dW <= 0.1 && dS > 0.1) verdict = 'MATCHES VHM0 (waves)';
      else if (dS <= 0.1 && dW > 0.1) verdict = 'MATCHES VHM0_SW1 (swell_1)';
      else if (dW <= 0.1 && dS <= 0.1) verdict = 'AMBIGUOUS (both within 0.1 ft)';
      else verdict = 'MATCHES NEITHER';
    }
    const overstate = (sw1_ft && published_ft) ? +(((published_ft - sw1_ft) / sw1_ft) * 100).toFixed(1) : null;
    const row = { region: s.region, name: s.name, spot_id: s.id, lat: s.lat, lng: s.lng,
      published_swell_height_ft: published_ft,
      frame_offshore_hs_m: s.frame_offshore_hs_m,
      frame_offshore_hs_ft: s.frame_offshore_hs_m == null ? null : Math.round(s.frame_offshore_hs_m * M_TO_FT * 10) / 10,
      waves_VHM0_m: vhm0_m, waves_VHM0_ft: vhm0_ft,
      swell1_VHM0_SW1_m: sw1_m, swell1_VHM0_SW1_ft: sw1_ft,
      abs_diff_vs_VHM0_ft: dW, abs_diff_vs_SW1_ft: dS,
      overstatement_pct_vs_SW1: overstate, verdict,
      waves_product: w && w.product_id, swell1_product: s1 && s1.product_id, run_time: s.run_time };
    rows.push(row);
    console.log(`${s.region.slice(0, 14).padEnd(15)} ${String(s.name).slice(0, 20).padEnd(21)} published=${String(published_ft).padStart(5)} | VHM0=${String(vhm0_ft).padStart(5)} | SW1=${String(sw1_ft).padStart(5)} | ${verdict}${overstate != null ? '  (+' + overstate + '% vs SW1)' : ''}`);
    fs.writeFileSync(`${OUT}/F1-falsification-production.json`, JSON.stringify({ valid_time: vt, backend: health.version, conditions_source: cs, rows }, null, 2));
  }

  // ---- 4. verdict ----
  const dec = rows.filter(r => /MATCHES VHM0 \(|MATCHES VHM0_SW1/.test(r.verdict));
  const w = rows.filter(r => r.verdict === 'MATCHES VHM0 (waves)').length;
  const s1c = rows.filter(r => r.verdict === 'MATCHES VHM0_SW1 (swell_1)').length;
  const amb = rows.filter(r => /AMBIGUOUS/.test(r.verdict)).length;
  const neither = rows.filter(r => r.verdict === 'MATCHES NEITHER').length;
  const ind = rows.filter(r => r.verdict === 'INDETERMINATE').length;
  const over = rows.map(r => r.overstatement_pct_vs_SW1).filter(x => x != null && isFinite(x));
  over.sort((a, b) => a - b);
  console.log('\n=== VERDICT ===');
  console.log(`spots sampled            : ${rows.length} across ${new Set(rows.map(r => r.region)).size} regions`);
  console.log(`lane that answered       : ${JSON.stringify(cs)}`);
  console.log(`published == VHM0 (waves): ${w}`);
  console.log(`published == VHM0_SW1    : ${s1c}`);
  console.log(`ambiguous / neither / ind: ${amb} / ${neither} / ${ind}`);
  if (over.length) {
    const med = over[Math.floor(over.length / 2)];
    console.log(`overstatement vs SW1     : min ${over[0]}%  median ${med}%  max ${over[over.length - 1]}%`);
    console.log(`  all signed one way?    : ${over.every(x => x >= 0) ? 'YES — published is never BELOW the swell partition' : 'no'}`);
  }
  console.log('');
  console.log(w > 0 && s1c === 0 ? '>>> F1 CONFIRMED — published tracks the WAVES layer (VHM0), not the swell partition.'
    : s1c > 0 && w === 0 ? '>>> F1 FALSIFIED — published tracks swell_1; downgrade to a naming defect.'
      : '>>> MIXED / INDETERMINATE — see rows.');
  fs.writeFileSync(`${OUT}/F1-falsification-production.json`, JSON.stringify({
    valid_time: vt, backend: health.version, conditions_source: cs,
    verdict: { spots: rows.length, regions: new Set(rows.map(r => r.region)).size, matches_VHM0: w, matches_VHM0_SW1: s1c, ambiguous: amb, neither, indeterminate: ind,
      overstatement_pct_vs_SW1: over.length ? { min: over[0], median: over[Math.floor(over.length / 2)], max: over[over.length - 1], all_same_sign: over.every(x => x >= 0) } : null },
    rows }, null, 2));
})();
