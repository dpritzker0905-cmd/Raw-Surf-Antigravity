// F-STALE cadence sampler. Read-only GET against the production catalog.
// Writes a COMPACT snapshot: for every (model, layer, tier), the full SET of distinct run_times
// present in the catalog at this instant -- not just the newest. The catalog retains products from
// more than one ingest, so a single snapshot already carries ingest history; the gaps between those
// run_times ARE the cadence, with no waiting required. Repeated samples confirm it.
const fs = require('fs');

const URL = 'https://raw-surf-antigravity.onrender.com/api/weather/products';
const TIERS = ['global_mid', 'global_coarse', 'florida_east_coast', 'us_west_coast_socal', 'hawaii',
  'iberia_west', 'uk_ireland', 'east_australia', 'indonesia', 'brazil_east', 'south_africa',
  'mexico_centralamerica_pac', 'us_southeast_midatlantic', 'azores', 'us_northeast', 'france_biscay'];
const tierOf = (f) => TIERS.find((t) => (f || '').includes('_' + t + '_')) || '?';

(async () => {
  const label = process.argv[2] || 'sample';
  const out = process.argv[3];
  const t0 = Date.now();
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const sampledAt = new Date().toISOString();

  const marine = j.products.filter((p) => p.domain === 'marine');
  const runTimes = {};   // "MODEL|layer|tier" -> Set of run_time
  const budgets = {};
  for (const p of marine) {
    const t = tierOf(p.filename);
    if (t === '?') continue;
    const k = `${p.model}|${p.layer}|${t}`;
    (runTimes[k] = runTimes[k] || new Set()).add(p.run_time);
    budgets[k] = p.freshness_sec;
  }

  const triples = {};
  for (const [k, set] of Object.entries(runTimes)) {
    triples[k] = { runTimes: [...set].sort(), budget: budgets[k] };
  }

  const snap = {
    label,
    sampled_at: sampledAt,
    fetch_ms: Date.now() - t0,
    last_manifest_update: j.last_manifest_update,
    product_count: j.products.length,
    marine_count: marine.length,
    triples
  };
  if (out) fs.writeFileSync(out, JSON.stringify(snap, null, 1));

  // --- immediate readout: how many ingests does each triple retain, and what are the gaps? ---
  const gapsAll = [];
  let multi = 0;
  for (const [, v] of Object.entries(triples)) {
    if (v.runTimes.length < 2) continue;
    multi++;
    for (let i = 1; i < v.runTimes.length; i++) {
      gapsAll.push((new Date(v.runTimes[i]) - new Date(v.runTimes[i - 1])) / 60000);
    }
  }
  gapsAll.sort((a, b) => a - b);
  const q = (p) => (gapsAll.length ? gapsAll[Math.floor(p * (gapsAll.length - 1))].toFixed(1) : 'n/a');
  const ages = Object.values(triples).map(
    (v) => (Date.parse(sampledAt) - new Date(v.runTimes[v.runTimes.length - 1])) / 3600000
  ).sort((a, b) => a - b);
  const qa = (p) => ages[Math.floor(p * (ages.length - 1))].toFixed(2);

  console.log(`[${label}] sampled_at=${sampledAt} manifest=${j.last_manifest_update} products=${j.products.length} marine=${marine.length}`);
  console.log(`  triples=${Object.keys(triples).length}  retaining >1 ingest=${multi}  intra-triple gaps n=${gapsAll.length}`);
  console.log(`  GAP between consecutive ingests (min): min=${q(0)} p25=${q(0.25)} p50=${q(0.5)} p75=${q(0.75)} max=${q(1)}`);
  console.log(`  AGE of newest ingest (h):              min=${qa(0)} p50=${qa(0.5)} max=${qa(1)}`);
})().catch((e) => { console.error('SAMPLER FAILED:', e.message); process.exit(1); });
