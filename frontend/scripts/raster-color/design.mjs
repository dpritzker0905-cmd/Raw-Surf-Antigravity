// Raster palette designer: builds the air temp / water temp / fog tables from OKLCH anchor stops (interpolated in OKLab, so
// equal steps look equal), rounds them to sRGB bytes, and scores them with check.mjs against the gates in
// docs/weather-program/log/2026-11-14-fable-raster-palettes.md.
//   node scripts/raster-color/design.mjs            # scores
//   node scripts/raster-color/design.mjs --emit     # prints the tables as JS for src/components/map/rasterPalettes.js
import { interpolate, formatRgb, converter, clampChroma } from 'culori';
import { report, gates, legendGate } from './check.mjs';
const toRgb = converter('rgb');
const ok = (l, c, h) => ({ mode: 'oklch', l, c, h });
// g(l, f, h): lightness l, hue h, chroma = fraction f of the most the sRGB gamut holds there (anchors stay in gamut, so the ramp does not kink).
const maxC = (l, h) => clampChroma({ mode: 'oklch', l, c: 0.4, h }, 'oklch').c;
const g = (l, f, h) => ok(l, f * maxC(l, h), h);
// A ramp through anchors [[value, oklch]], sampled at every breakpoint; alpha per breakpoint from `alpha(value)`.
function ramp(anchors, breakpoints, alpha) {
  const colors = breakpoints.map((v) => {
    let i = 0; while (i < anchors.length - 2 && v > anchors[i + 1][0]) i += 1;
    const [v0, c0] = anchors[i]; const [v1, c1] = anchors[i + 1];
    const t = Math.min(1, Math.max(0, (v - v0) / (v1 - v0)));
    const c = toRgb(clampChroma(interpolate([c0, c1], 'oklab')(t), 'oklch'));
    return [Math.round(Math.min(1, Math.max(0, c.r)) * 255), Math.round(Math.min(1, Math.max(0, c.g)) * 255), Math.round(Math.min(1, Math.max(0, c.b)) * 255), +alpha(v).toFixed(2)];
  });
  return { type: 'breakpoint', breakpoints, colors };
}
const seq = (a, b, s) => { const o = []; for (let v = a; v <= b + 1e-9; v += s) o.push(+v.toFixed(2)); return o; };

// ── AIR TEMP: diverging around 0 C. Cold: pale ice -> blue -> indigo -> deep violet. Warm: pale cream -> yellow -> orange -> red -> maroon.
// Lightness falls away from 0 C on both sides; the two stops beside 0 are already tinted, so the freezing line reads.
export function airTemp(theme) {
  const k = theme === 'dark' ? { l0: 0.97, lo: 0.30, chroma: 1.0 } : { l0: 0.97, lo: 0.24, chroma: 1.0 };
  // The stops below -0.5 C and the first four above 0 C were found by a random search with refinement (30,000 candidates,
  // 2026-11-14) for the largest smallest-margin over every air temp gate line on the REAL map colours of the three themes; by
  // hand the 5 C band line and the colour-blind cold-against-warm line kept trading against each other over the light and
  // beach maps' bright cyan water.
  const cold = [
    [-40, g(0.11, 0.85, 332.2)], [-30, g(0.17, 0.88, 324.2)], [-25, g(0.281, 0.88, 319.5)], [-20, g(0.402, 0.85, 303.3)], [-15, g(0.485, 0.82, 280.2)],
    [-10, g(0.562, 0.82, 264.4)], [-5, g(0.67, 0.85, 240.3)], [-0.5, g(0.715, 0.90, 237.0)], [0, g(0.928, 0.791, 81.0)],
  ];
  // No neutral stop at 0 C: a near-white one sank into the pale light map (gate B1). 0 C is the first, palest warm colour (a pale
  // apricot, not a cream: a blue-blind viewer cannot tell cream from the beach map's warm white) and the freezing line is the
  // blue / apricot edge itself.
  const warm = [
    [0, g(0.928, 0.791, 81.0)], [5, g(0.875, 0.716, 90.4)], [10, g(0.831, 1.0, 83.3)], [15, g(0.776, 0.90, 82.0)],
    [20, g(0.705, 0.88, 60)], [25, g(0.63, 0.86, 45)], [30, g(0.555, 0.85, 30)], [35, g(0.48, 0.85, 12)], [40, g(0.395, 0.85, 352)], [45, g(0.31, 0.85, 332)],
  ];
  const bps = [-80, ...seq(-40, -1, 1), -0.5, 0, 0.5, ...seq(1, 45, 1), 50];   // every stop on the own-frames lookup's 0.5 C step (ownRasterLayer TEMPERATURE_LUT)
  const a = ramp([...cold, ...warm.slice(1)], bps, () => 1);
  return { ...a, unit: '°C' };
}

// ── WATER TEMP: sequential, lightness rising with temperature all the way (cold = deep violet-blue, warm = pale gold), hue
// turning from violet through blue, teal, green and yellow-green to gold so each degree moves in hue as well as lightness.
export function waterTemp(theme) {
  const anchors = [
    [-2, g(0.115, 0.80, 318)], [4, g(0.185, 0.85, 306)], [8, g(0.295, 0.85, 268)], [12, g(0.385, 0.78, 245)], [16, g(0.49, 0.78, 205)],
    [20, g(0.60, 0.85, 160)], [24, g(0.725, 0.85, 125)], [28, g(0.87, 0.60, 104)], [30, g(0.93, 0.45, 98)], [34, g(0.975, 0.40, 92)],
  ];
  const a = ramp(anchors, [-80, ...seq(-2, 34, 1), 50], () => 1);
  return { ...a, unit: '°C', theme };
}

// ── FOG: visibility in metres. The veil must stand off the basemap, so its colour is theme-specific: a blue-grey slate over the
// pale light / beach maps, near-white over the dark one. Alpha carries the emphasis: full below 300 m, gone by 10 km.
export function fog(theme) {
  const col = theme === 'dark' ? [[0, ok(0.97, 0.01, 240)], [1000, ok(0.93, 0.015, 240)], [10000, ok(0.90, 0.015, 240)]]
    : theme === 'beach' ? [[0, ok(0.30, 0.035, 255)], [1000, ok(0.42, 0.035, 250)], [10000, ok(0.55, 0.03, 245)]]
      : [[0, ok(0.28, 0.04, 255)], [1000, ok(0.40, 0.04, 250)], [10000, ok(0.55, 0.03, 245)]];
  const alpha = (v) => (v <= 312.5 ? 1 : v <= 1000 ? 1 - 0.28 * (v - 312.5) / 687.5 : v <= 3000 ? 0.72 - 0.50 * (v - 1000) / 2000 : v < 10000 ? 0.22 * (1 - (v - 3000) / 7000) : 0);
  // every stop a multiple of 31.25 m (ownRasterLayer FOG_LUT: 0..10 km in 31.25 m steps): 62.5 m steps to 1 km, 125 m to 3 km, 500 m to 10 km
  const a = ramp(col, [...seq(0, 937.5, 62.5), ...seq(1000, 2875, 125), ...seq(3000, 10000, 500)], alpha);
  return { ...a, unit: 'm' };
}

export const build = (theme) => ({ temperature: airTemp(theme), water_temp: waterTemp(theme), fog: fog(theme) });

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('raster-color/design.mjs');
if (isMain) {
  if (process.argv.includes('--emit')) {
    const out = {}; for (const t of ['light', 'beach', 'dark']) out[t] = build(t);
    console.log(JSON.stringify(out));
  } else {
    let fails = 0;
    for (const theme of ['light', 'beach', 'dark']) {
      const scales = build(theme); const rows = report(scales, 'new').filter((x) => x.theme === theme);
      if (process.argv.includes('--rows')) for (const r of rows) console.log(JSON.stringify(r));
      for (const g of [...gates(rows, scales, theme), ...legendGate(scales, theme)]) { if (!g.ok) fails += 1; if (!g.ok || process.argv.includes('--all')) console.log(g.ok ? 'pass' : 'FAIL', g.gate.padEnd(18), g.detail); }
    }
    console.log(fails ? `${fails} gate line(s) FAIL` : 'every gate line passes');
  }
}
