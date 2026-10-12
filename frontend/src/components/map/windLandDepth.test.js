/**
 * THE LAND AT THE SEA'S DEPTH UNDER THE WIND (windBasemapMute.js WIND_BASEMAP_MUTE.landL; DECISIONS D-026). ON BY DEFAULT in light
 * and beach wherever the basemap mute is restyling the map.
 *
 * The owner, 2026-10-12, on a prototype shown moving beside dark and today's look: "go with F and the deeper land and open the pr".
 * Measured on a speed ramp (log 2026-10-12-wind-land-depth): in dark the land and the sea carry nearly one ground under the wind
 * (L* 33.5 and 42.5); in light and beach the land sat 12 to 17 L* ABOVE the sea, because the mute darkens the sea (by 10.7 and 6.4
 * L*) and leaves the land as the style draws it. No white streak can lift a ground that pale as far as dark's lifts dark's land
 * (0.38 to 0.93 of it), and the two grounds needed two streak strengths, whose seam (the land mask's 20 km texel) drew a pale halo
 * along every coast.
 *
 * This file pins: the numbers; the switch, its kill and its lever; what the plan repaints (the land's area colours and the lines
 * drawn on it, never the water, never anything above the wind) and that with the factor at 1 the plan is the one before, byte for
 * byte; the sync's record and read-back; and the one rule that rides on it: where the land is drawn at the sea's depth, a streak
 * over land is laid at the SEA's strength (one ground, one strength, no seam), and nowhere else.
 */
import {
  WIND_BASEMAP_MUTE, WIND_LAND_STEP, windLandStep, windLandStepAsked, windLandStepOn, windBasemapLandL, windBasemapWaterL, windLandDepthOn, muteColor, muteValue, parseColor, oklab,
  windBasemapMutePlan, syncWindBasemapMute, windBasemapMuteStale,
} from './windBasemapMute';
import { windWhiteStrength, windWhiteStreakOn, DARK_RULES_HOLDS } from './WindColorRamp';
import { DARK_WHITE } from './windDarkRules';

const L = (s) => oklab(parseColor(s))[0], C = (s) => { const [, a, b] = oklab(parseColor(s)); return Math.hypot(a, b); };
const KILL = { __RAW_DISABLE_WIND_LAND_DEPTH__: true };
// D-026 AS IT MERGED (the land at the sea's depth, a streak over it at the sea's strength) is, since the land a step above the sea
// (D-026 amended, 2026-10-12), what that step's kill draws. Every pin of the depth below is kept to the letter under it.
const DEPTH = { __RAW_DISABLE_WIND_LAND_STEP__: true };
const STYLE = () => [
  { id: 'land', type: 'background', paint: { 'background-color': 'hsl(60, 0%, 99%)' } },
  { id: 'landcover', type: 'fill', paint: { 'fill-color': ['match', ['get', 'class'], 'wood', 'hsl(100, 40%, 70%)', 'hsl(82, 40%, 92%)'] } },
  { id: 'water', type: 'fill', paint: { 'fill-color': 'hsl(197, 98%, 78%)' } },
  { id: 'waterway', type: 'line', paint: { 'line-color': 'hsl(197, 98%, 78%)' } },
  { id: 'road-primary', type: 'line', paint: { 'line-color': ['interpolate', ['linear'], ['zoom'], 5, 'hsl(45, 90%, 80%)', 12, 'hsl(0, 0%, 100%)'], 'line-width': 2 } },
  { id: 'contour-line', type: 'line', paint: { 'line-color': 'hsl(100, 60%, 40%)' } },
  { id: 'ocean-mask-land', type: 'fill', paint: { 'fill-color': 'hsl(35, 30%, 90%)' } },
  { id: 'wind', type: 'custom' },
  { id: 'admin-1-boundary', type: 'line', paint: { 'line-color': 'hsl(250, 90%, 85%)' } },
  { id: 'place-label', type: 'symbol', paint: { 'text-color': 'hsl(230, 20%, 5%)' } },
];
function fakeMap(layers = STYLE()) {
  const live = new Map(layers.map((l) => [l.id, JSON.parse(JSON.stringify(l))]));
  return {
    style: { _order: layers.map((l) => l.id) },
    getLayer: (id) => live.get(id),
    getStyle: () => ({ layers: [...live.values()].filter((l) => l.type !== 'custom').map((l) => JSON.parse(JSON.stringify(l))) }),
    getPaintProperty: (id, p) => (live.get(id).paint || {})[p],
    getLayoutProperty: (id, p) => (live.get(id).layout || {})[p],
    setPaintProperty: (id, p, v) => { const l = live.get(id); l.paint = l.paint || {}; l.paint[p] = JSON.parse(JSON.stringify(v)); },
    paint: () => JSON.stringify([...live.values()].map((l) => l.paint)),
  };
}
const by = (plan, id) => plan.find((p) => p.id === id);

describe('the numbers, the switch, the kill and the lever', () => {
  it('the land takes 0.81 of its own lightness in light and 0.85 in beach: the muted sea\'s lightness, as the prototype the owner chose drew it', () => {
    expect(WIND_BASEMAP_MUTE.landL).toEqual({ light: 0.81, beach: 0.85 });
    expect(Object.isFrozen(WIND_BASEMAP_MUTE.landL)).toBe(true);
    expect(windBasemapLandL('light', DEPTH)).toBe(0.81); expect(windBasemapLandL('beach', DEPTH)).toBe(0.85);
    expect(windBasemapLandL('dark', {})).toBe(1); expect(windBasemapLandL('dark', DEPTH)).toBe(1);   // dark's map is the model: not touched
  });
  it('the kill draws the land as the style does; the lever sets any factor from 0.5 to 1.2, and nothing outside it', () => {
    for (const t of ['light', 'beach', 'dark']) expect(windBasemapLandL(t, KILL)).toBe(1);
    expect(windBasemapLandL('light', { __RAW_WIND_BASEMAP_LAND_L__: 0.7 })).toBe(0.7);
    expect(windBasemapLandL('dark', { __RAW_WIND_BASEMAP_LAND_L__: 0.7 })).toBe(1);       // dark is never touched, lever or not
    expect(windBasemapLandL('light', { __RAW_WIND_BASEMAP_LAND_L__: 1.1 })).toBe(1.1);    // above 1 the land is drawn LIGHTER: not deep (below)
    for (const bad of [0.2, 3, '0.7', null, NaN]) { expect(windBasemapLandL('light', { ...DEPTH, __RAW_WIND_BASEMAP_LAND_L__: bad })).toBe(0.81); expect(windBasemapLandL('light', { __RAW_WIND_BASEMAP_LAND_L__: bad })).toBe(0.9); }
    expect(windBasemapLandL('light', { ...KILL, __RAW_WIND_BASEMAP_LAND_L__: 0.7 })).toBe(1);   // the kill wins over the lever
    expect(windBasemapWaterL('light', KILL)).toBe(0.9);                                   // and is the land's alone
  });
  it('the real window is read when no lever object is passed', () => {
    try { window.__RAW_DISABLE_WIND_LAND_DEPTH__ = true; expect(windBasemapLandL('light')).toBe(1); } finally { delete window.__RAW_DISABLE_WIND_LAND_DEPTH__; }
    expect(windBasemapLandL('light')).toBe(0.9);
    try { window.__RAW_DISABLE_WIND_LAND_STEP__ = true; expect(windBasemapLandL('light')).toBe(0.81); } finally { delete window.__RAW_DISABLE_WIND_LAND_STEP__; }
  });
});

describe('the plan: the land and what is drawn on it go deeper; the water, and everything above the wind, do not', () => {
  const before = windBasemapMutePlan(STYLE(), 'wind', 0.85, 0.9), deep = windBasemapMutePlan(STYLE(), 'wind', 0.85, 0.9, 0.81);
  it('with the factor at 1 (the kill, dark, an old caller) the plan is the one before, byte for byte', () => {
    expect(windBasemapMutePlan(STYLE(), 'wind', 0.85, 0.9, 1)).toEqual(before);
    expect(before.map((p) => p.id)).toEqual(['land', 'landcover', 'water', 'waterway']);   // no line on the land was ever in it
  });
  it('the land\'s area colours are the muted colours at 0.81 of their lightness', () => {
    expect(by(deep, 'land').to).toBe(muteColor('hsl(60, 0%, 99%)', 0.85, 0.81));
    expect(L(by(deep, 'land').to)).toBeCloseTo(0.81 * L('hsl(60, 0%, 99%)'), 2);
    expect(by(deep, 'landcover').to).toEqual(muteValue(STYLE()[1].paint['fill-color'], 0.85, 0.81));
    expect(by(deep, 'landcover').to[2]).toBe('wood');                                     // an expression keeps its shape
  });
  it('the water is the water before: its own factor, never the land\'s', () => {
    expect(by(deep, 'water')).toEqual(by(before, 'water'));
    expect(by(deep, 'waterway')).toEqual(by(before, 'waterway'));
  });
  it('the lines drawn on the land (roads, contours) take the land\'s whole treatment, muted and deepened: a pale, coloured road on a deeper land outshone the wind', () => {
    const road = by(deep, 'road-primary'), contour = by(deep, 'contour-line');
    expect(road.prop).toBe('line-color');
    expect(road.to.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);
    expect(road.to[4]).toBe(muteColor('hsl(45, 90%, 80%)', 0.85, 0.81));
    expect(L(road.to[4])).toBeCloseTo(0.81 * L('hsl(45, 90%, 80%)'), 2);
    expect(C(road.to[4])).toBeCloseTo(0.15 * C('hsl(45, 90%, 80%)'), 2);                   // its hue is given to the wind, as the land's is
    expect(contour.to).toBe(muteColor('hsl(100, 60%, 40%)', 0.85, 0.81));
    expect(L(by(deep, 'road-primary').to[6])).toBeGreaterThan(L(by(deep, 'land').to) - 0.01);   // a white road is still at or above the land it lies on: a line, as dark's are
    expect(deep.some((p) => p.prop === 'line-width')).toBe(false);                         // colour only
  });
  it('a border line UNDER the wind (the under-labels kill puts the wind on top) is left as the style draws it, as the ink leaves it (D-023)', () => {
    const onTop = [...STYLE().filter((l) => l.id !== 'wind'), { id: 'wind', type: 'custom' }];
    const plan = windBasemapMutePlan(onTop, 'wind', 0.85, 0.9, 0.81);
    expect(by(plan, 'admin-1-boundary')).toBeUndefined();
    expect(by(plan, 'road-primary')).toBeDefined();
  });
  it('a style with no land area under the wind is left alone: a line goes down only where the land does', () => {
    expect(windBasemapMutePlan([{ id: 'road', type: 'line', paint: { 'line-color': '#fff' } }, { id: 'wind', type: 'custom' }], 'wind', 0.85, 0.9, 0.81)).toEqual([]);
    expect(windBasemapMutePlan([STYLE()[2], STYLE()[4], { id: 'wind', type: 'custom' }], 'wind', 0.85, 0.9, 0.81).map((p) => p.id)).toEqual(['water']);   // water alone is not land
  });
  it('nothing above the wind, and nothing the app owns, is in it', () => {
    for (const id of ['admin-1-boundary', 'place-label', 'ocean-mask-land', 'wind']) expect(by(deep, id)).toBeUndefined();
  });
  it('it rides the mute: no mute, no plan (the mute\'s kill keeps its meaning: the map keeps its own colours)', () => {
    expect(windBasemapMutePlan(STYLE(), 'wind', 0, 0.9, 0.81)).toEqual([]);
  });
});

describe('the sync: one record, an exact restore, and a read-back that says what the land is', () => {
  it('light and beach are drawn deeper by default, and the read-back names the factor', () => {
    for (const [theme, f, lev] of [['light', 0.81, DEPTH], ['beach', 0.85, DEPTH], ['light', 0.9, {}], ['beach', 0.94, {}]]) {
      const map = fakeMap(), win = { ...lev };
      syncWindBasemapMute(map, theme, true, 'wind', win);
      expect(map.getPaintProperty('land', 'background-color')).toBe(muteColor('hsl(60, 0%, 99%)', 0.85, f));
      expect(win.__WIND_BASEMAP_MUTE__).toMatchObject({ applied: true, theme, landL: f, layers: 4, landLines: 2 });   // `layers` counts what it always did (land, landcover, water and the water's line); the road and the contour are `landLines`
      expect(windLandDepthOn(theme, win)).toBe(true);
    }
  });
  it('the wind off restores every colour exactly, the roads included', () => {
    const map = fakeMap(), was = map.paint(), win = {};
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(map.paint()).not.toBe(was);
    syncWindBasemapMute(map, 'light', false, 'wind', win);
    expect(map.paint()).toBe(was);
    expect(win.__WIND_BASEMAP_MUTE__).toMatchObject({ applied: false, landL: 1 });
    expect(windLandDepthOn('light', win)).toBe(false);
  });
  it('the kill, set while the wind is on, is seen as stale and takes the land back to the mute alone; unset, the land goes deep again', () => {
    const map = fakeMap(), win = {};
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(false);
    win.__RAW_DISABLE_WIND_LAND_DEPTH__ = true;
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(map.getPaintProperty('land', 'background-color')).toBe(muteColor('hsl(60, 0%, 99%)', 0.85));
    expect(map.getPaintProperty('road-primary', 'line-color')).toEqual(STYLE()[4].paint['line-color']);   // the road is the style's own again
    expect(map.getPaintProperty('water', 'fill-color')).toBe(muteColor('hsl(197, 98%, 78%)', 0.85, 0.9));   // the mute stays
    expect(win.__WIND_BASEMAP_MUTE__).toMatchObject({ applied: true, landL: 1 });
    expect(windLandDepthOn('light', win)).toBe(false);
    delete win.__RAW_DISABLE_WIND_LAND_DEPTH__;
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(windLandDepthOn('light', win)).toBe(true);
  });
  it('the mute\'s own kill, dark, and imagery under the wind leave the land the style\'s (and say so)', () => {
    const map = fakeMap(), was = map.paint(), win = { __RAW_DISABLE_WIND_BASEMAP_MUTE__: true };
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(map.paint()).toBe(was); expect(windLandDepthOn('light', win)).toBe(false);
    const dark = fakeMap(), w2 = {};
    syncWindBasemapMute(dark, 'dark', true, 'wind', w2);
    expect(dark.paint()).toBe(was); expect(windLandDepthOn('dark', w2)).toBe(false);
    const photo = fakeMap([{ id: 'sat', type: 'raster', paint: { 'raster-opacity': 1 } }, ...STYLE()]), shot = photo.paint(), w3 = {};
    syncWindBasemapMute(photo, 'light', true, 'wind', w3);
    expect(photo.paint()).toBe(shot); expect(windLandDepthOn('light', w3)).toBe(false);
  });
  it('a read-back of another theme, or of a map the mute did not take, is not this theme\'s land (a theme change in flight)', () => {
    expect(windLandDepthOn('beach', { __WIND_BASEMAP_MUTE__: { applied: true, theme: 'light', landL: 0.81 } })).toBe(false);
    expect(windLandDepthOn('light', { __WIND_BASEMAP_MUTE__: { applied: false, theme: 'light', landL: 0.81 } })).toBe(false);
    expect(windLandDepthOn('light', { __WIND_BASEMAP_MUTE__: { applied: true, theme: 'light', landL: 1 } })).toBe(false);
    expect(windLandDepthOn('light', {})).toBe(false); expect(windLandDepthOn('light', null)).toBe(false);
  });
});

describe('one ground, one strength: over a land drawn at the sea\'s depth a streak is laid at the sea\'s strength', () => {
  const deep = (theme, f) => ({ __WIND_BASEMAP_MUTE__: { applied: true, theme, landL: f } });
  it('where the land is deep, the land\'s strength is the sea\'s (whatever the sea\'s is), so the land mask\'s seam has nothing to show', () => {
    for (const theme of ['light', 'beach']) {
      const s = windWhiteStrength(theme, { ...deep(theme, WIND_BASEMAP_MUTE.landL[theme]), ...DEPTH });
      expect(s).toEqual({ land: DARK_WHITE[theme].sea, sea: DARK_WHITE[theme].sea });
      expect(s.land).toBeLessThan(1);
    }
  });
  it('where it is not (no read-back yet, the kill, the mute off, imagery, another theme\'s read-back), the strengths are D-022\'s: full over land', () => {
    for (const theme of ['light', 'beach']) {
      const d22 = { land: DARK_WHITE[theme].land, sea: DARK_WHITE[theme].sea };
      for (const win of [{}, deep(theme, 1), { __WIND_BASEMAP_MUTE__: { applied: false, theme, landL: 0.81 } }, deep(theme === 'light' ? 'beach' : 'light', 0.81)]) expect(windWhiteStrength(theme, win)).toEqual(d22);
    }
  });
  it('D-022\'s kill and everything that stands the white streak down still read full strength on both grounds, deep land or not', () => {
    for (const theme of ['light', 'beach']) for (const off of ['__RAW_DISABLE_WIND_DARK_WHITE__', '__RAW_DISABLE_WIND_WHITE_STREAK__', '__RAW_DISABLE_WIND_DARK_RULES__']) {
      expect(windWhiteStrength(theme, { ...deep(theme, 0.81), [off]: true })).toEqual({ land: 1, sea: 1 });
    }
    expect(windWhiteStrength('dark', deep('dark', 0.81))).toEqual({ land: 1, sea: 1 });
  });
  it('a bench lever names another strength for the deep land (0.2 to 1), and is nothing where the land is not deep', () => {
    expect(windWhiteStrength('light', { ...deep('light', 0.81), __RAW_WIND_WHITE_LAND__: 0.7 }).land).toBe(0.7);
    expect(windWhiteStrength('light', { ...deep('light', 0.81), ...DEPTH, __RAW_WIND_WHITE_LAND__: 7 }).land).toBe(DARK_WHITE.light.sea);
    expect(windWhiteStrength('light', { __WIND_BASEMAP_MUTE__: { applied: true, theme: 'light', landL: 0.9, landStep: true }, __RAW_WIND_WHITE_LAND__: 7 }).land).toBe(0.75);
    expect(windWhiteStrength('light', { __RAW_WIND_WHITE_LAND__: 0.7 }).land).toBe(1);
  });
});

describe('AN OLDER KILL DRAWS ITS OLD PICTURE, the land included (an independent review, before the PR: with D-022\'s kill alone the streaks were full white over a deep land, a picture nobody built)', () => {
  const OLDER = ['__RAW_DISABLE_WIND_DARK_WHITE__', '__RAW_DISABLE_WIND_WHITE_STREAK__', '__RAW_DISABLE_WIND_DARK_RULES__', ...DARK_RULES_HOLDS];
  const dev = (theme, win) => { const map = fakeMap(); syncWindBasemapMute(map, theme, true, 'wind', { ...win, __RAW_DISABLE_WIND_LAND_DEPTH__: true }); return map.paint(); };
  it('the land is deep only where the white streak is laid by the ground (D-022): under every older kill and every hold the factor is 1', () => {
    expect(OLDER.length).toBeGreaterThan(10);
    for (const theme of ['light', 'beach']) for (const k of OLDER) {
      expect(windBasemapLandL(theme, { [k]: true })).toBe(1);
      expect(windBasemapLandL(theme, { [k]: true, __RAW_WIND_BASEMAP_LAND_L__: 0.7 })).toBe(1);   // and no lever brings it back under one
    }
    for (const look of ['moderate', 'deep', 'ink']) expect(windBasemapLandL('light', { __RAW_WIND_LIGHT_LOOK__: look })).toBe(1);   // a steered light look draws its own way
    expect(windBasemapLandL('beach', { __RAW_WIND_LIGHT_LOOK__: 'deep', ...DEPTH })).toBe(0.85);                                 // and steers light only
    expect(windBasemapLandL('beach', { __RAW_WIND_LIGHT_LOOK__: 'deep' })).toBe(0.94);
    for (const theme of ['light', 'beach']) expect(windWhiteStreakOn(theme, {})).toBe(true);                                      // the control: with nothing set the gate is open
  });
  it('and the map under each is the map dev draws under it, write for write (the land the mute\'s alone, the roads the style\'s own)', () => {
    for (const theme of ['light', 'beach']) for (const k of OLDER) {
      const map = fakeMap(), win = { [k]: true };
      syncWindBasemapMute(map, theme, true, 'wind', win);
      expect(map.paint()).toBe(dev(theme, win));
      expect(windLandDepthOn(theme, win)).toBe(false);
      expect(windWhiteStrength(theme, win)).toEqual({ land: 1, sea: 1 });
    }
  });
});

describe('the read-back says what the MAP is, not what was asked for', () => {
  it('a style with no land the mute can deepen (water alone; a land colour it cannot parse) reads landL 1, and the land\'s streaks stay full', () => {
    for (const layers of [[STYLE()[2], { id: 'wind', type: 'custom' }], [{ id: 'land', type: 'background', paint: { 'background-color': ['rgb', 236, 236, 232] } }, STYLE()[2], { id: 'wind', type: 'custom' }]]) {
      const map = fakeMap(layers), win = {};
      expect(syncWindBasemapMute(map, 'light', true, 'wind', win)).toMatchObject({ applied: true, landLines: 0 });
      expect(win.__WIND_BASEMAP_MUTE__.landL).toBe(1);
      expect(windLandDepthOn('light', win)).toBe(false);
      expect(windWhiteStrength('light', win)).toEqual({ land: DARK_WHITE.light.land, sea: DARK_WHITE.light.sea });
    }
  });
  it('a factor above 1 draws the land LIGHTER and is not a deep land: the read-back carries it, and the land\'s streaks stay full', () => {
    const map = fakeMap(), win = { __RAW_WIND_BASEMAP_LAND_L__: 1.1 };
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(win.__WIND_BASEMAP_MUTE__.landL).toBe(1.1);
    expect(windLandDepthOn('light', win)).toBe(false);
    expect(windWhiteStrength('light', win).land).toBe(1);
  });
  it('an answer that muted nothing still carries landLines: 0 (never undefined)', () => {
    const map = fakeMap(), win = {};
    expect(syncWindBasemapMute(map, 'light', false, 'wind', win).landLines).toBe(0);
    expect(syncWindBasemapMute(map, 'dark', true, 'wind', win).landLines).toBe(0);
    expect(win.__WIND_BASEMAP_MUTE__.landLines).toBe(0);
  });
});

describe('THE ENGINE\'S OWN CALL: windWhiteStrength(theme) with no window passed reads the real one (a mutation that never read it passed every other test)', () => {
  it('the read-back on the real window decides, and its removal takes the land back to full at once', () => {
    try {
      window.__WIND_BASEMAP_MUTE__ = { applied: true, theme: 'light', landL: 0.81 }; window.__RAW_DISABLE_WIND_LAND_STEP__ = true;
      expect(windWhiteStrength('light')).toEqual({ land: DARK_WHITE.light.sea, sea: DARK_WHITE.light.sea });
      delete window.__RAW_DISABLE_WIND_LAND_STEP__; window.__WIND_BASEMAP_MUTE__ = { applied: true, theme: 'light', landL: 0.9, landStep: true };
      expect(windWhiteStrength('light')).toEqual({ land: WIND_LAND_STEP.white.light, sea: DARK_WHITE.light.sea });   // the default: the land a step above the sea, its own strength
      expect(windWhiteStrength('beach').land).toBe(DARK_WHITE.beach.land);                // the read-back is light's, not beach's
      expect(windLandDepthOn('light')).toBe(true);
    } finally { delete window.__WIND_BASEMAP_MUTE__; delete window.__RAW_DISABLE_WIND_LAND_STEP__; }
    expect(windWhiteStrength('light').land).toBe(1);
  });
  it('the bench lever\'s range is closed at both ends', () => {
    const deep = { __WIND_BASEMAP_MUTE__: { applied: true, theme: 'light', landL: 0.81 }, ...DEPTH };
    for (const bad of [0.1, 1.01, '0.7', null]) expect(windWhiteStrength('light', { ...deep, __RAW_WIND_WHITE_LAND__: bad }).land).toBe(DARK_WHITE.light.sea);
    for (const ok of [0.2, 1]) expect(windWhiteStrength('light', { ...deep, __RAW_WIND_WHITE_LAND__: ok }).land).toBe(ok);
  });
});

describe('what the plan must not break', () => {
  it('a `match` LABEL that happens to be a colour name is a label: only the outputs are colours', () => {
    const road = { id: 'road', type: 'line', paint: { 'line-color': ['match', ['get', 'tint'], 'white', '#ffff00', ['black', 'transparent'], 'hsl(0, 0%, 50%)', 'hsl(45, 90%, 80%)'] } };
    const to = by(windBasemapMutePlan([STYLE()[0], road, { id: 'wind', type: 'custom' }], 'wind', 0.85, 0.9, 0.81), 'road').to;
    expect(to.slice(0, 3)).toEqual(['match', ['get', 'tint'], 'white']);
    expect(to[4]).toEqual(['black', 'transparent']);
    expect(to[3]).toBe(muteColor('#ffff00', 0.85, 0.81)); expect(to[5]).toBe(muteColor('hsl(0, 0%, 50%)', 0.85, 0.81)); expect(to[6]).toBe(muteColor('hsl(45, 90%, 80%)', 0.85, 0.81));
    expect(muteValue(['match', ['get', 'class'], 'white', ['interpolate', ['linear'], ['zoom'], 5, 'white', 9, 'black'], 'white'], 0.85)).toEqual(
      ['match', ['get', 'class'], 'white', ['interpolate', ['linear'], ['zoom'], 5, muteColor('white', 0.85), 9, muteColor('black', 0.85)], muteColor('white', 0.85)]);   // a nested output is still walked
  });
  it('a ferry line is drawn on the sea: it is not a line on the land', () => {
    const plan = windBasemapMutePlan([STYLE()[0], { id: 'ferry', type: 'line', paint: { 'line-color': 'hsl(205, 60%, 60%)' } }, { id: 'ferry-auto', type: 'line', paint: { 'line-color': 'hsl(205, 60%, 60%)' } }, { id: 'wind', type: 'custom' }], 'wind', 0.85, 0.9, 0.81);
    expect(plan.map((p) => p.id)).toEqual(['land']);
  });
  it('every area colour of the land takes the factor: hillshade, extrusions and fill outlines with the fills', () => {
    const layers = [
      { id: 'hillshade', type: 'hillshade', paint: { 'hillshade-shadow-color': 'hsl(56, 59%, 22%)', 'hillshade-highlight-color': 'hsl(0, 0%, 100%)' } },
      { id: 'building', type: 'fill-extrusion', paint: { 'fill-extrusion-color': 'hsl(35, 8%, 85%)' } },
      { id: 'park', type: 'fill', paint: { 'fill-color': 'hsl(100, 50%, 80%)', 'fill-outline-color': 'hsl(100, 40%, 60%)' } }, { id: 'wind', type: 'custom' }];
    const plan = windBasemapMutePlan(layers, 'wind', 0.85, 0.9, 0.81);
    expect(plan.map((p) => `${p.id}.${p.prop}`)).toEqual(['hillshade.hillshade-shadow-color', 'hillshade.hillshade-highlight-color', 'building.fill-extrusion-color', 'park.fill-color', 'park.fill-outline-color']);
    for (const e of plan) expect(e.to).toBe(muteColor(e.from, 0.85, 0.81));
  });
});

describe('THE LAND A STEP ABOVE THE SEA (D-026 amended, 2026-10-12): the land takes the sea\'s own factor, and a streak over it its own strength', () => {
  // The owner, on the deployed build with the coast in the borders' ink live: "it needs to be checked at all zooms, because I don't see
  // the fix at higher out zooms, cannot see the land below the wind animations in beach or light modes well". Bench: ground-run.js on a
  // speed ramp (land minus sea under the field: light +8.3 L*, beach +8.0, dark -9.4; at the sea's depth light kept 1.1 and beach 1.7).
  const read = (theme, f, landStep = f === WIND_LAND_STEP.landL[theme]) => ({ __WIND_BASEMAP_MUTE__: { applied: true, theme, landL: f, landStep } });   // what a default sync leaves
  it('the numbers: the land\'s factor IS the sea\'s (0.90 light, 0.94 beach), a streak over it is laid at 0.75, between the sea\'s and full', () => {
    expect(WIND_LAND_STEP).toEqual({ landL: { light: 0.9, beach: 0.94 }, white: { light: 0.75, beach: 0.75 } });
    expect(Object.isFrozen(WIND_LAND_STEP)).toBe(true); expect(Object.isFrozen(WIND_LAND_STEP.landL)).toBe(true); expect(Object.isFrozen(WIND_LAND_STEP.white)).toBe(true);
    for (const theme of ['light', 'beach']) {
      expect(WIND_LAND_STEP.landL[theme]).toBe(WIND_BASEMAP_MUTE.waterL[theme]);                 // one factor for the land and the sea: the map's own step survives the mute
      expect(WIND_LAND_STEP.landL[theme]).toBeGreaterThan(WIND_BASEMAP_MUTE.landL[theme]);       // lighter than the depth of PR #320
      expect(WIND_LAND_STEP.white[theme]).toBeGreaterThan(DARK_WHITE[theme].sea); expect(WIND_LAND_STEP.white[theme]).toBeLessThan(DARK_WHITE[theme].land);
      expect(windBasemapLandL(theme, {})).toBe(WIND_LAND_STEP.landL[theme]);
      expect(windLandStep(theme, {})).toBe(true); expect(windLandStep(theme, DEPTH)).toBe(false);
    }
    expect(windLandStep('dark', {})).toBe(false); expect(windBasemapLandL('dark', {})).toBe(1);   // dark is the model
  });
  it('the map keeps its own land-sea step: as restyled the land is as far above the sea in OKLab lightness as on the style\'s own map (to a rounding)', () => {
    for (const [theme, land, sea] of [['light', 'hsl(60, 0%, 99%)', 'hsl(197, 98%, 78%)'], ['beach', 'hsl(35, 32%, 91%)', 'hsl(196, 80%, 70%)']]) {
      const k = WIND_BASEMAP_MUTE.waterL[theme], own = L(land) / L(sea);
      const step = L(muteColor(land, 0.85, windBasemapLandL(theme, {}))) / L(muteColor(sea, 0.85, k));
      const depth = L(muteColor(land, 0.85, windBasemapLandL(theme, DEPTH))) / L(muteColor(sea, 0.85, k));
      expect(step / own).toBeGreaterThan(0.98); expect(step / own).toBeLessThan(1.02);          // the ratio the map draws is the ratio under the wind
      expect(depth / own).toBeLessThan(0.93);                                                    // at the sea's depth it was not: the positive control
    }
  });
  it('a streak over that land takes the step\'s strength; the sea keeps its own', () => {
    for (const theme of ['light', 'beach']) {
      expect(windWhiteStrength(theme, read(theme, WIND_LAND_STEP.landL[theme]))).toEqual({ land: 0.75, sea: DARK_WHITE[theme].sea });
      expect(windWhiteStrength(theme, { ...read(theme, WIND_LAND_STEP.landL[theme]), __RAW_WIND_WHITE_LAND__: 0.6 }).land).toBe(0.6);   // the bench lever still names another
      expect(windWhiteStrength(theme, read(theme, 1))).toEqual({ land: DARK_WHITE[theme].land, sea: DARK_WHITE[theme].sea });           // a land the mute did not deepen: D-022's, full
    }
  });
  it('its kill draws D-026 as it merged, write for write: the land at the sea\'s depth, the roads with it, a streak over it at the sea\'s strength', () => {
    for (const theme of ['light', 'beach']) {
      const map = fakeMap(), win = { ...DEPTH }, f = WIND_BASEMAP_MUTE.landL[theme];
      syncWindBasemapMute(map, theme, true, 'wind', win);
      const want = fakeMap(); syncWindBasemapMute(want, theme, true, 'wind', { __RAW_WIND_BASEMAP_LAND_L__: f });   // the depth's own lever at PR #320's factor: the same writes
      expect(map.paint()).toBe(want.paint());
      for (const p of windBasemapMutePlan(STYLE(), 'wind', 0.85, WIND_BASEMAP_MUTE.waterL[theme], f)) expect(map.getPaintProperty(p.id, p.prop)).toEqual(p.to);   // and they are the plan at that factor, land, roads and water
      expect(win.__WIND_BASEMAP_MUTE__).toMatchObject({ applied: true, landL: f, landStep: false });
      expect(windWhiteStrength(theme, win)).toEqual({ land: DARK_WHITE[theme].sea, sea: DARK_WHITE[theme].sea });
      // The same, by the numbers PR #320 merged (not by this file's own functions): the land's colour at 0.81 / 0.85, a streak at 0.55.
      expect(map.getPaintProperty('land', 'background-color')).toBe(muteColor('hsl(60, 0%, 99%)', 0.85, theme === 'light' ? 0.81 : 0.85));
      expect(map.getPaintProperty('water', 'fill-color')).toBe(muteColor('hsl(197, 98%, 78%)', 0.85, theme === 'light' ? 0.9 : 0.94));
      expect(windWhiteStrength(theme, win)).toEqual({ land: 0.55, sea: 0.55 });
    }
  });
  it('only `true` is the kill: 1, a string, an object or false leave the step on (the house rule for every kill)', () => {
    for (const not of [1, 'true', {}, false, null, undefined]) {
      expect(windLandStep('light', { __RAW_DISABLE_WIND_LAND_STEP__: not })).toBe(true);
      expect(windBasemapLandL('light', { __RAW_DISABLE_WIND_LAND_STEP__: not })).toBe(0.9);
    }
    expect(windLandStep('light', { __RAW_DISABLE_WIND_LAND_STEP__: true })).toBe(false);
  });
  it('the kill, set while the wind is on, is stale and takes the land down to the sea\'s depth; unset, the land rises again; the restore is exact either way', () => {
    const map = fakeMap(), was = map.paint(), win = {};
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(map.getPaintProperty('land', 'background-color')).toBe(muteColor('hsl(60, 0%, 99%)', 0.85, 0.9));
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(false);
    win.__RAW_DISABLE_WIND_LAND_STEP__ = true;
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(map.getPaintProperty('land', 'background-color')).toBe(muteColor('hsl(60, 0%, 99%)', 0.85, 0.81));
    expect(map.getPaintProperty('road-primary', 'line-color')[4]).toBe(muteColor('hsl(45, 90%, 80%)', 0.85, 0.81));
    delete win.__RAW_DISABLE_WIND_LAND_STEP__;
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(win.__WIND_BASEMAP_MUTE__.landL).toBe(0.9);
    expect(map.getPaintProperty('road-primary', 'line-color')[4]).toBe(muteColor('hsl(45, 90%, 80%)', 0.85, 0.9));   // what is drawn on the land rises with it
    syncWindBasemapMute(map, 'light', false, 'wind', win);
    expect(map.paint()).toBe(was);
  });
  it('it rides everything the depth rides: the depth\'s kill, every older kill and hold, the mute\'s kill and dark leave the land the style\'s, step or no step', () => {
    const OLDER = ['__RAW_DISABLE_WIND_LAND_DEPTH__', '__RAW_DISABLE_WIND_DARK_WHITE__', '__RAW_DISABLE_WIND_WHITE_STREAK__', '__RAW_DISABLE_WIND_DARK_RULES__', ...DARK_RULES_HOLDS];
    for (const theme of ['light', 'beach']) for (const k of OLDER) for (const step of [{}, DEPTH]) {
      expect(windBasemapLandL(theme, { [k]: true, ...step })).toBe(1);
      const map = fakeMap(), win = { [k]: true, ...step };
      syncWindBasemapMute(map, theme, true, 'wind', win);
      expect(windLandDepthOn(theme, win)).toBe(false);
      if (k !== '__RAW_DISABLE_WIND_LAND_DEPTH__') expect(windWhiteStrength(theme, win)).toEqual({ land: 1, sea: 1 });
    }
    const dark = fakeMap(), was = dark.paint();
    syncWindBasemapMute(dark, 'dark', true, 'wind', {});
    expect(dark.paint()).toBe(was);
  });
  it('the depth\'s lever still sets any factor, over the step and under its kill alike', () => {
    expect(windBasemapLandL('light', { __RAW_WIND_BASEMAP_LAND_L__: 0.7 })).toBe(0.7);
    expect(windBasemapLandL('light', { ...DEPTH, __RAW_WIND_BASEMAP_LAND_L__: 0.7 })).toBe(0.7);
  });
});

describe('BOTH HALVES OF THE STEP MOVE AT THE SYNC (an independent review, before the PR: the kill set in the console drew 0.55 over the lighter land, or 0.75 over the deeper one, until a style event)', () => {
  const land = (map) => map.getPaintProperty('land', 'background-color'), AT = (f) => muteColor('hsl(60, 0%, 99%)', 0.85, f);
  it('the default sync says so: landStep true, the land at the sea\'s factor, a streak over it at 0.75', () => {
    for (const [theme, f] of [['light', 0.9], ['beach', 0.94]]) {
      const map = fakeMap(), win = {};
      expect(syncWindBasemapMute(map, theme, true, 'wind', win)).toMatchObject({ landL: f, landStep: true });
      expect(win.__WIND_BASEMAP_MUTE__).toMatchObject({ applied: true, landL: f, landStep: true });
      expect(windLandStepOn(theme, win)).toBe(true);
      expect(windWhiteStrength(theme, win)).toEqual({ land: 0.75, sea: 0.55 });
    }
  });
  it('the kill SET with no sync yet changes nothing drawn: the land is still the lighter one and its streak still 0.75; the sync then moves both', () => {
    const map = fakeMap(), win = {};
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    win.__RAW_DISABLE_WIND_LAND_STEP__ = true;                                           // typed in the console: the engine reads the strength on its next frame
    expect(land(map)).toBe(AT(0.9)); expect(windWhiteStrength('light', win).land).toBe(0.75);   // not 0.55 over the 0.90 land
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(land(map)).toBe(AT(0.81)); expect(windWhiteStrength('light', win).land).toBe(0.55);
    expect(win.__WIND_BASEMAP_MUTE__).toMatchObject({ landL: 0.81, landStep: false });
  });
  it('and the kill LIFTED with no sync yet: the land is still the deeper one and its streak still the sea\'s; the sync then moves both', () => {
    const map = fakeMap(), win = { __RAW_DISABLE_WIND_LAND_STEP__: true };
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    delete win.__RAW_DISABLE_WIND_LAND_STEP__;
    expect(land(map)).toBe(AT(0.81)); expect(windWhiteStrength('light', win).land).toBe(0.55);  // not 0.75 over the 0.81 land
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(land(map)).toBe(AT(0.9)); expect(windWhiteStrength('light', win).land).toBe(0.75);
  });
  it('a read-back without landStep (an older build\'s, a hand-made one) is not the step: the sea\'s strength, as before it', () => {
    for (const r of [{ applied: true, theme: 'light', landL: 0.9 }, { applied: true, theme: 'light', landL: 0.9, landStep: 1 }, { applied: true, theme: 'light', landL: 0.9, landStep: 'true' }]) {
      expect(windLandStepOn('light', { __WIND_BASEMAP_MUTE__: r })).toBe(false);
      expect(windWhiteStrength('light', { __WIND_BASEMAP_MUTE__: r }).land).toBe(0.55);
    }
    expect(windLandStepOn('beach', { __WIND_BASEMAP_MUTE__: { applied: true, theme: 'light', landL: 0.9, landStep: true } })).toBe(false);   // another theme's read-back
    expect(windLandStepOn('light', { __WIND_BASEMAP_MUTE__: { applied: false, theme: 'light', landL: 0.9, landStep: true } })).toBe(false);  // a map the mute did not take
    expect(windLandStepOn('light', {})).toBe(false); expect(windLandStepOn('light', null)).toBe(false);
  });
  it('a style with no land to restyle is not a step, whatever was asked', () => {
    const map = fakeMap([STYLE()[2], { id: 'wind', type: 'custom' }]), win = {};
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(win.__WIND_BASEMAP_MUTE__).toMatchObject({ applied: true, landL: 1, landStep: false });
    expect(windWhiteStrength('light', win).land).toBe(1);
  });
  it('an answer that muted nothing carries landStep: false (never undefined)', () => {
    const map = fakeMap(), win = {};
    expect(syncWindBasemapMute(map, 'light', false, 'wind', win).landStep).toBe(false);
    expect(syncWindBasemapMute(map, 'dark', true, 'wind', win).landStep).toBe(false);
    expect(win.__WIND_BASEMAP_MUTE__.landStep).toBe(false);
  });
});

describe('THE DEPTH\'S LEVER KEEPS ITS MEANING UNDER THE STEP (the review: with the lever the map was dev\'s and the streak over it 0.75 where dev laid 0.55)', () => {
  it('a land set by the lever is drawn as dev drew it under that lever, the streak over it included: the sea\'s strength, at every factor', () => {
    for (const theme of ['light', 'beach']) for (const lev of [0.5, 0.6, 0.7, 0.81, 0.85, 0.9, 0.94, 0.99]) {
      const map = fakeMap(), win = { __RAW_WIND_BASEMAP_LAND_L__: lev };
      const dev = fakeMap(), devWin = { __RAW_WIND_BASEMAP_LAND_L__: lev, __RAW_DISABLE_WIND_LAND_STEP__: true };   // the step's kill is dev
      syncWindBasemapMute(map, theme, true, 'wind', win); syncWindBasemapMute(dev, theme, true, 'wind', devWin);
      expect(map.paint()).toBe(dev.paint());
      expect(windLandStepAsked(theme, win)).toBe(false);
      expect(win.__WIND_BASEMAP_MUTE__).toMatchObject({ landL: lev, landStep: false });
      expect(windWhiteStrength(theme, win)).toEqual({ land: 0.55, sea: 0.55 });
      expect(windWhiteStrength(theme, win)).toEqual(windWhiteStrength(theme, devWin));
    }
  });
  it('the lever at exactly the step\'s own factor, set over a step already drawn, is seen as stale (the land is the same, the rule is not) and the streak follows at the sync', () => {
    const map = fakeMap(), win = {};
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    win.__RAW_WIND_BASEMAP_LAND_L__ = 0.9;
    expect(windWhiteStrength('light', win).land).toBe(0.75);                             // nothing has been drawn by the lever yet
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    const was = map.paint();
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(map.paint()).toBe(was); expect(windWhiteStrength('light', win).land).toBe(0.55);
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(false);
    delete win.__RAW_WIND_BASEMAP_LAND_L__;
    expect(windBasemapMuteStale(map, 'light', true, 'wind', win)).toBe(true);
    syncWindBasemapMute(map, 'light', true, 'wind', win);
    expect(windWhiteStrength('light', win).land).toBe(0.75);
  });
  it('windLandStepAsked: the step\'s own rule only (not under its kill, the depth\'s kill, an older kill, the lever, or dark)', () => {
    expect(windLandStepAsked('light', {})).toBe(true); expect(windLandStepAsked('beach', {})).toBe(true); expect(windLandStepAsked('dark', {})).toBe(false);
    for (const off of [DEPTH, KILL, { __RAW_DISABLE_WIND_DARK_WHITE__: true }, { __RAW_DISABLE_WIND_WHITE_STREAK__: true }, { __RAW_DISABLE_WIND_DARK_RULES__: true }, { __RAW_WIND_BASEMAP_LAND_L__: 0.9 }]) expect(windLandStepAsked('light', off)).toBe(false);
    for (const bad of [0.2, 3, '0.9', null, NaN]) expect(windLandStepAsked('light', { __RAW_WIND_BASEMAP_LAND_L__: bad })).toBe(true);   // not a lever: the step stands
  });
});
