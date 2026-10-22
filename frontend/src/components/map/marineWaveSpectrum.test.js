// THE LIGHT SPECTRUM (D-037, owner 2026-10-21): light's wave-height wash draws seven colour steps on the sea-state breaks, with the widest
// spectrum the light map can show, lightness falling at every step as drawn; dark and beach draw exactly what they drew.
// Baselines: hashed from dev 23a91534f's own files (the original light crests are the default again there, D-041; dark's 8 m+ storm
// crest, D-039). Since D-041, light's crests over the spectrum are the original by default; V2 (`v2s`) and its far-zoom lift only on request.
import { createHash } from 'crypto';

const sha = (s) => createHash('sha256').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex');
const DEV = {
  HEATMAP_FS: 'c8deb3bd58c1beea2aeb29d625b5af9313b6349a2bb0e3c4a12cf0a7271442a8',
  DRAW_FS: 'e24385865160c841d04f9bfb8108f4bcda361fe8512648ae8f4a5e372d0289e5',
  DRAW_VS: 'b1569be996bc67eb85cc51e77e995d011b28700711214f480a5e3748034cf9a3',
  GLSL: '05a4cc2f957c5ed7ada5b6f6980218d452cc649ea52422bbb64eb5f7efa57ba7',
  legendLightFt: '33b9f9c134057a1bfd48e44f8db78e68624b3d61dd55d1c1fc384deb77ea872d',
  legendLightM: '10a7f2adc07fd129f1bda3a6bfe7dd32ee9d8966b3ef5742562df059b5d74fc8',
  legendBeach: '1dee437685c4eeeda82787ed33c137e0cb29425fe8ac417180951f0bc977d55e',
  samplesLight: '66b497c5a5d4b813dc40aa56d12aee4bf68258feca56ef214d473f3f58d2aa58',
  samplesBeach: 'e25e5bf7e1058d820841b9f6e5d3413f4f167a10752b26900972e6dc574b5980',
};
const KILL = { __RAW_DISABLE_WAVE_SPECTRUM__: true }, V2 = { __RAW_LIGHT_CREST_V2__: true };
const SCALE = { unit: 'm', breakpoints: [0, 0.5, 1, 2, 3, 5, 7, 10] };
const samples = (p, theme) => Array.from({ length: 171 }, (_, i) => p.sampleMarineWavePalette(i / 10, theme));

function withWindow(levers, fn) {
  let out;
  jest.isolateModules(() => {
    Object.assign(window, levers);
    try {
      out = fn({ p: require('./marineWavePalette'), s: { ...require('./WebGLMarineShaders'), ...require('./WebGLMarineParticleShaders') }, c: require('./marineCrestPalette') });
    } finally { Object.keys(levers).forEach((k) => delete window[k]); }
  });
  return out;
}

// OKLab lightness of encoded sRGB 0-255 (Ottosson 2020), for the lightness-order pins.
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const okL = (rgb) => {
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
};
const WATER = [144, 223, 254], LIGHTING = [0.03, 0.05, 0.08];
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

describe('the kill (window.__RAW_DISABLE_WAVE_SPECTRUM__) is dev exactly', () => {
  it('palette GLSL, heatmap shader, crest shader, legends, samples and encoder scales hash to dev 448deb35c', () => {
    withWindow(KILL, ({ p, s }) => {
      expect([sha(p.MARINE_WAVE_PALETTE_GLSL), sha(s.HEATMAP_FS), sha(s.DRAW_FS), sha(s.DRAW_VS)]).toEqual([DEV.GLSL, DEV.HEATMAP_FS, DEV.DRAW_FS, DEV.DRAW_VS]);
      expect([sha(p.marineWaveLegend(SCALE, 'light', 'ft')), sha(p.marineWaveLegend(SCALE, 'light', 'm')), sha(p.marineWaveLegend(SCALE, 'beach', 'ft'))])
        .toEqual([DEV.legendLightFt, DEV.legendLightM, DEV.legendBeach]);
      expect([sha(samples(p, 'light')), sha(samples(p, 'beach'))]).toEqual([DEV.samplesLight, DEV.samplesBeach]);
      expect([p.marineWaveHeightScale('light'), p.marineWaveHeightScale('beach'), p.marineWaveHeightScale('dark')]).toEqual([16, 10, 10]);
      expect([p.MARINE_WAVE_PALETTE_IDS.light, p.MARINE_WAVE_SPECTRUM, p.withWaveSpectrum('anything')]).toEqual(['v2', false, 'anything']);
    });
  });
  it('the 16 m kill (#411 exactly) and the V2 kill also leave the spectrum off', () => {
    withWindow({ __RAW_DISABLE_WAVE_HEIGHT_16M__: true }, ({ p }) => expect([p.MARINE_WAVE_PALETTE_IDS.light, p.MARINE_WAVE_SPECTRUM]).toEqual(['v2', false]));
    withWindow({ __RAW_DISABLE_WAVE_PALETTE_V2__: true }, ({ p }) => expect([p.MARINE_WAVE_PALETTE_IDS.light, p.MARINE_WAVE_SPECTRUM]).toEqual(['v1', false]));
  });
});

describe('the spectrum on (the default)', () => {
  it('light draws the spectrum; beach draws v1 exactly (D-035) and its legend is dev\'s; the encoder reads light to 14 m', () => {
    withWindow({}, ({ p }) => {
      expect([p.MARINE_WAVE_PALETTE_IDS.light, p.MARINE_WAVE_PALETTE_IDS.beach, p.MARINE_WAVE_SPECTRUM]).toEqual(['spectrum', 'v1', true]);
      expect(sha(samples(p, 'beach'))).toBe(DEV.samplesBeach);
      expect(sha(p.marineWaveLegend(SCALE, 'beach', 'ft'))).toBe(DEV.legendBeach);
      expect([p.marineWaveHeightScale('light'), p.marineWaveHeightScale('beach'), p.marineWaveHeightScale('dark')]).toEqual([14, 10, 10]);
    });
  });
  it('the heatmap differs from dev ONLY by light\'s table, the opacity function, and the two light-only lines', () => {
    const killed = withWindow(KILL, ({ p, s }) => ({ glsl: p.MARINE_WAVE_PALETTE_GLSL, fs: s.HEATMAP_FS }));
    withWindow({}, ({ p, s }) => {
      const NL = String.fromCharCode(10);
      const lines = s.HEATMAP_FS.split(NL);
      const blend = lines.filter((l) => l.includes('float waveBlend = (u_theme > 0.5 && u_theme < 1.5) ? 1.0 : smoothstep(0.0, 0.18, displayHeight);'));
      const opacity = lines.filter((l) => l.includes('float alpha = marineWaveSpectrumAlpha(u_opacity, displayHeight, u_theme);'));
      expect([blend.length, opacity.length]).toEqual([1, 1]);
      const undo = s.HEATMAP_FS.split(p.MARINE_WAVE_PALETTE_GLSL).join(killed.glsl)
        .split(blend[0]).join('  float waveBlend = smoothstep(0.0, 0.18, displayHeight);')
        .split(opacity[0]).join('  float alpha = u_opacity;');
      expect(sha(undo)).toBe(DEV.HEATMAP_FS);
      // dark (theme 0) and beach (theme 2) take the old opacity and the sea-floor blend; beach's table branch is v1's text exactly
      expect(p.MARINE_WAVE_PALETTE_GLSL).toContain('if (theme < 0.5 || theme > 1.5) return alpha;');
      const beachBranch = (g) => g.split('if (theme > 1.5) { ')[1].split(' }')[0];
      expect(beachBranch(p.MARINE_WAVE_PALETTE_GLSL)).toBe(beachBranch(killed.glsl));
      expect(() => p.withWaveSpectrum('void main() {}')).toThrow(/one floor blend and one opacity line/);
    });
  });
  it('the GLSL table, the JS sampler and the legend agree on the spectrum\'s colours', () => {
    withWindow({}, ({ p }) => {
      const P = p.WAVE_PALETTES.spectrum;
      P.heights.forEach((h, i) => expect(p.sampleMarineWavePalette(h, 'light')).toEqual(P.light[i]));
      P.light.forEach((rgb) => expect(p.MARINE_WAVE_PALETTE_GLSL).toContain(`vec3(${rgb.map((v) => (v / 255).toFixed(9)).join(', ')})`));
      expect(p.marineWavePaletteGlsl(P, p.WAVE_PALETTES.v1)).toContain('float h = clamp(height, 0.0, 14.0);');
    });
  });
  it('lightness falls at every 2 cm, on the table and as drawn at world/regional/coastal opacity under every swell lighting', () => {
    withWindow({}, ({ p }) => {
      // the GPU's own blend (unrounded): sampleMarineWavePalette rounds to whole RGB, which alone jitters OKLab L by ~5e-4
      const P = p.WAVE_PALETTES.spectrum, at = (h) => { const H = P.heights, x = Math.max(0, Math.min(P.cap, h)); let i = 0; while (i < H.length - 2 && x > H[i + 1]) i++;
        const t = (x - H[i]) / (H[i + 1] - H[i]); return P.light[i].map((v, c) => v + (P.light[i + 1][c] - v) * t); };
      const tableL = (h) => okL(at(h));
      const drawnL = (h, base, dir) => {
        const a = p.spectrumAlpha(base, h), src = at(h).map((v) => v / 255);
        return okL(src.map((v, i) => 255 * (Math.min(1, v + LIGHTING[i] * dir * ss(0.1, 3, h)) * a + (WATER[i] / 255) * (1 - a))));
      };
      for (let k = 0; k < 700; k++) {
        const h = k * 0.02, n = h + 0.02;
        expect(tableL(n)).toBeLessThanOrEqual(tableL(h) + 1e-4);
        for (const base of [0.65, 0.70, 0.77]) for (const dir of [0, 0.5, 1]) if (h >= 0.18) expect(drawnL(n, base, dir)).toBeLessThanOrEqual(drawnL(h, base, dir) + 1e-4);
      }
      expect(drawnL(14, 0.65, 0.5)).toBeLessThan(drawnL(0.5, 0.65, 0.5) - 0.3);   // a wide lightness range, calm to phenomenal
    });
  });
  it('opacity: the pass\'s own at 0.5 m, rising to 0.80 by 6 m at world zoom, fading out under 0.5 m', () => {
    withWindow({}, ({ p }) => {
      expect([p.spectrumAlpha(0.65, 0), p.spectrumAlpha(0.65, 0.5), p.spectrumAlpha(0.65, 6), p.spectrumAlpha(0.65, 14)].map((v) => +v.toFixed(4))).toEqual([0, 0.65, 0.8, 0.8]);
      expect(p.spectrumAlpha(0.8, 6)).toBeGreaterThan(0.8);   // every zoom grows denser with height
    });
  });
  it('the legend is a ruler: one share per sea-state band, coloured as drawn, ticks in feet or metres, no arrow', () => {
    withWindow({}, ({ p }) => {
      const ft = p.marineWaveLegend(SCALE, 'light', 'ft'), m = p.marineWaveLegend(SCALE, 'light', 'm');
      expect(ft.stops.map((s) => s.label)).toEqual(['0', '1.6', '4', '8', '13', '20', '30', '46+']);
      expect(m.stops.map((s) => s.label)).toEqual(['0', '0.5', '1.25', '2.5', '4', '6', '9', '14+']);
      expect(ft.stops.map((s) => +s.pct.toFixed(3))).toEqual([0, 14.286, 28.571, 42.857, 57.143, 71.429, 85.714, 100]);
      expect(ft.clipPath).toBeUndefined();
      expect(ft.gradientCSS.startsWith('linear-gradient(to right, rgb(144,223,254) 0.000%')).toBe(true);   // the faded calm is the water
    });
  });
});

describe('light\'s crests over the spectrum', () => {
  it('are the original by default (D-041): DRAW_FS and DRAW_VS exactly as dev, no switch, no lift', () => {
    withWindow({}, ({ s, c }) => {
      expect(c.LIGHT_CREST_ID).toBe('v1');
      expect([sha(s.DRAW_FS), sha(s.DRAW_VS)]).toEqual([DEV.DRAW_FS, DEV.DRAW_VS]);
      expect(c.resolveSpectrumCrestLift()).toBeNull();
    });
  });
  it('on request keep V2\'s colours with the switch moved to 2.35 m; v2 at 3.05 m under the spectrum kill; v1 under the crest kill', () => {
    withWindow(V2, ({ s, c }) => {
      expect(c.LIGHT_CREST_ID).toBe('v2s');
      expect(s.DRAW_FS).toContain('step(2.35, v_wave_height)');
      ['calm', 'active', 'storm', 'foam'].forEach((k) => {
        expect(c.LIGHT_CRESTS.v2s[k].rgb).toEqual(c.LIGHT_CRESTS.v2[k].rgb);
        expect(c.LIGHT_CRESTS.v2s[k].above).toEqual(c.LIGHT_CRESTS.v2[k].above);
      });
      expect([c.resolveLightCrest(V2, true, 'spectrum'), c.resolveLightCrest(V2, true, 'v2'), c.resolveLightCrest({ ...V2, __RAW_DISABLE_LIGHT_CREST_V2__: true }, true, 'spectrum'),
        c.resolveLightCrest({}, true, 'spectrum')]).toEqual(['v2s', 'v2', 'v1', 'v1']);
    });
    withWindow({ ...KILL, ...V2 }, ({ c }) => expect(c.LIGHT_CREST_ID).toBe('v2'));
    withWindow(KILL, ({ c }) => expect(c.LIGHT_CREST_ID).toBe('v1'));
  });
});

describe('light\'s far-zoom crest lift over the spectrum (owner: "Make sure the crest zooms are still visible")', () => {
  const LIFT = '  if (u_theme > 0.5 && u_theme < 1.5) zoomAlphaScale *= mix(';
  it('with V2 asked for, DRAW_VS differs from dev only by the light-only lift line and the shared u_theme declaration', () => {
    withWindow(V2, ({ s, c }) => {
      const NL = String.fromCharCode(10), lines = s.DRAW_VS.split(NL);
      const lift = lines.filter((l) => l.startsWith(LIFT)), theme = lines.filter((l) => l.startsWith('uniform mediump float u_theme;'));
      expect([lift.length, theme.length]).toEqual([1, 1]);
      expect(lift[0]).toContain(`mix(${(c.SPECTRUM_CREST_LIFT.far / 0.45).toFixed(4)}, 1.0, smoothstep(3.0, ${c.SPECTRUM_CREST_LIFT.end.toFixed(2)}, u_zoom));`);
      expect(sha(lines.filter((l) => l !== lift[0] && l !== theme[0]).join(NL))).toBe(DEV.DRAW_VS);
      expect(s.DRAW_FS).toContain('uniform float u_theme;');   // the fragment shader's default float is mediump: the two declarations match
    });
  });
  it('its kill, the spectrum kill and the crest kill each leave DRAW_VS exactly as dev, even with V2 asked for', () => {
    for (const k of [{ __RAW_DISABLE_SPECTRUM_CREST_LIFT__: true }, KILL, { __RAW_DISABLE_LIGHT_CREST_V2__: true }].map((x) => ({ ...V2, ...x }))) {
      withWindow(k, ({ s }) => expect(sha(s.DRAW_VS)).toBe(DEV.DRAW_VS));
    }
  });
  it('the factor starts at `far` at world zoom and meets today\'s curve by `end`; levers are bounded; only v2s lifts', () => {
    withWindow({}, ({ c }) => {
      const today = (z) => 0.45 + 0.55 * ss(3, 9, z), L = c.SPECTRUM_CREST_LIFT;
      const lifted = (z) => today(z) * ((L.far / 0.45) + (1 - L.far / 0.45) * ss(3, L.end, z));
      expect(+lifted(2.2).toFixed(4)).toBe(L.far);
      expect(lifted(L.end)).toBeCloseTo(today(L.end), 10);
      for (let z = 1; z <= 12; z += 0.25) expect(lifted(z)).toBeGreaterThanOrEqual(today(z) - 1e-12);   // never fainter than today
      expect(c.resolveSpectrumCrestLift({}, 'v2')).toBeNull();
      expect(c.resolveSpectrumCrestLift({}, 'v1')).toBeNull();
      expect(c.resolveSpectrumCrestLift({ __RAW_SPECTRUM_CREST_FAR__: 0.8, __RAW_SPECTRUM_CREST_END__: 7 }, 'v2s')).toEqual({ far: 0.8, end: 7 });
      expect(c.resolveSpectrumCrestLift({ __RAW_SPECTRUM_CREST_FAR__: 3, __RAW_SPECTRUM_CREST_END__: '7' }, 'v2s')).toEqual(L);
      expect(() => c.withSpectrumCrestLift('void main() {}', L)).toThrow(/one far-zoom alpha line/);
    });
  });
});
