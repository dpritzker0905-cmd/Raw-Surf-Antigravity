// LIGHT CREST SWITCH over the spectrum (D-037, 2026-10-21). Light's crest V2 (D-036) flips from a dark umber ink to cream at 3.05 m, where
// v2's wash crossed mid-lightness (APCA Y 0.352). The spectrum darkens faster, so its crossing moves. This scans the switch height with
// V2's own colours unchanged and reports the weakest APCA |Lc| of a crest core against the wash under it, over 0-14 m (every 0.05 m),
// world/regional/coastal opacity, swell lighting 0/0.5/1, whitecap off and at full roll: the same composite and crest model wave-check.mjs
// uses. Usage: node crest-switch.mjs [--palette spectrum] [--from 1.5 --to 3.6]
import { loadPalettes, composite, crestOver, ALPHAS, apcaLc, LIGHT_CRESTS } from './wave-lib.mjs';

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const mod = loadPalettes(), id = arg('--palette', 'spectrum'), P = id.endsWith('@16') ? mod.widenWavePalette(mod.WAVE_PALETTES[id.replace('@16', '')]) : mod.WAVE_PALETTES[id];
const V2 = LIGHT_CRESTS.v2, from = +arg('--from', 1.5), to = +arg('--to', 3.6);
function worst(sw) {
  const crest = V2.slice(); crest[4] = { ...V2[4], h: sw };
  let w = { lc: Infinity };
  for (let h = 0; h <= P.cap + 1e-9; h += 0.05) for (const [view, a] of Object.entries(ALPHAS)) for (const dir of [0, 0.5, 1]) for (const wc of [0, 1]) {
    const under = composite(P, 'light', h, a, dir), core = crestOver('light', h, under, wc, crest), lc = Math.abs(apcaLc(core, under));
    if (lc < w.lc) w = { lc, h, view, dir, wc };
  }
  return w;
}
const rows = []; for (let sw = from; sw <= to + 1e-9; sw += 0.05) rows.push({ sw, ...worst(sw) });
const best = rows.reduce((a, b) => (b.lc > a.lc ? b : a)), at305 = worst(3.05);
console.log(`palette ${id}: V2 crest colours, weakest APCA |Lc| by switch height (core vs wash, every view, whitecap off/on)`);
rows.filter((r, i) => i % 4 === 0 || r === best).forEach((r) => console.log(`  switch ${r.sw.toFixed(2)} m  |Lc| ${r.lc.toFixed(1)}  (at ${r.h.toFixed(2)} m, ${r.view}, lighting ${r.dir}, whitecap ${r.wc})`));
console.log(`today's 3.05 m: |Lc| ${at305.lc.toFixed(1)} (at ${at305.h.toFixed(2)} m); best ${best.sw.toFixed(2)} m: |Lc| ${best.lc.toFixed(1)} (at ${best.h.toFixed(2)} m, ${best.view}, lighting ${best.dir}, whitecap ${best.wc})`);
