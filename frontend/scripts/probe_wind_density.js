// Visible INK, not particle COUNT, is what the eye sees.
//   count(s)  ~ lifetime ~ 1/dropRate(s)
//   ink(s)    ~ mark AREA(s) x count(s)
const S = [0.28, 3.85, 6.52, 11.08, 16.87, 22.71, 38.79];
const drop = (s) => 0.002 + 0.008 * s;

// (a) TRAIL rendering, as in the webgl-wind lineage the bump was designed for: ink ~ speed/drop
console.log('(a) legacy design intent — trail ink ~ speed / dropRate:');
const trail = S.map((s) => s / drop(s));
S.forEach((s, i) => console.log(`   ${String(s).padStart(6)}kn  ink ${trail[i].toFixed(0).padStart(5)}`));
console.log(`   ratio max/min above 4kn = ${(Math.max(...trail.slice(1)) / Math.min(...trail.slice(1))).toFixed(2)}x  <-- the compensator works\n`);

// (b) POINT-SPRITE rendering as this codebase actually does it, AFTER my round-2 size floor.
const sizeLegacy = (s) => (s < 0.5 ? 0 : 2.5 + 2.5 * Math.min(Math.max((s - 1) / 29, 0), 1));
const sizeNow = (s) => {
  const base = sizeLegacy(s);
  if (s >= 0.15 && s < 10) {
    const slowness = Math.min(Math.max((10 - s) / (10 - 0.15), 0), 1);
    return Math.max(base, 5.5 + (8.0 - 5.5) * slowness);
  }
  return base;
};
const area = (px) => Math.PI * (px / 2) * (px / 2);
console.log('(b) point-sprite ink ~ AREA / dropRate  (what we actually render):');
const before = S.map((s) => area(sizeLegacy(s)) / drop(s));
const after = S.map((s) => area(sizeNow(s)) / drop(s));
S.forEach((s, i) => console.log(
  `   ${String(s).padStart(6)}kn  size ${sizeLegacy(s).toFixed(1)}->${sizeNow(s).toFixed(1)}   ink ${before[i].toFixed(0).padStart(6)} -> ${after[i].toFixed(0).padStart(7)}`));
const r = (a) => (Math.max(...a) / Math.min(...a.filter((x) => x > 0)));
console.log(`\n   ink ratio BEFORE round-2 floor: ${r(before).toFixed(1)}x`);
console.log(`   ink ratio AFTER  round-2 floor: ${r(after).toFixed(1)}x   <-- the clumping`);
