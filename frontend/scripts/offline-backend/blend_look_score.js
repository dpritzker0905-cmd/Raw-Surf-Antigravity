// Unblind the owner's look at the hour blend (scn_blend_look.js, blend_look.html). Reads OUT/key.json and the answer code.
//   node blend_look_score.js <OUT> "p03:x p07:n p01:y ..."
// Reading registered before any clip existed (log 2026-11-15-fable-crest-hour-blend.md, section 35).
const fs = require('fs');
const path = require('path');

/** Pure: { rows, fade, cut, none, unknown, verdict } from the key's pairs and the answer code. */
function scoreLook(keyPairs, code) {
  const rows = []; let fade = 0; let cut = 0; let none = 0; const unknown = [];
  for (const tok of String(code || '').trim().split(/\s+/).filter(Boolean)) {
    const [id, slot] = tok.split(':'); const k = keyPairs[id];
    if (!k || k.error || !['x', 'y', 'n'].includes(slot)) { unknown.push(tok); continue; }
    const chose = slot === 'n' ? 'no difference' : k[slot];
    if (chose === 'fade') fade += 1; else if (chose === 'cut') cut += 1; else none += 1;
    rows.push({ id, layer: k.layer, theme: k.theme, size: `${k.w}x${k.h}`, zoom: k.z, chose });
  }
  const n = rows.length;
  // As registered: the cross-fade is PREFERRED at 8 or more of 10; the hard cut at 8 or more; anything else is "no clear preference".
  const verdict = n < 10 ? `INCOMPLETE (${n} of 10 pairs answered)` : fade >= 8 ? 'CROSS-FADE PREFERRED' : cut >= 8 ? 'HARD CUT PREFERRED' : 'NO CLEAR PREFERENCE';
  return { rows, fade, cut, none, unknown, verdict };
}

if (require.main === module) {
  const [out, code] = process.argv.slice(2);
  if (!out || !code) { console.log('usage: node blend_look_score.js <OUT> "<answer code>"'); process.exit(2); }
  const key = JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8'));
  const r = scoreLook(key.pairs, code);
  for (const row of r.rows) console.log(`${row.id}  ${row.layer.padEnd(8)} ${row.theme.padEnd(6)} ${row.size.padEnd(9)} z${row.zoom}  ->  ${row.chose}`);
  if (r.unknown.length) console.log(`not understood: ${r.unknown.join(' ')}`);
  console.log(`cross-fade ${r.fade}, hard cut ${r.cut}, no difference ${r.none}  ->  ${r.verdict}`);
}

module.exports = { scoreLook };
