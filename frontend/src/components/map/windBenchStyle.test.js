/**
 * Wind bench, STYLE columns (scripts/wind-bench/style.js, printed by map-run.js): what the wind's marks look like against
 * the field under them. It is the instrument behind windInk.js: "dark looks great, light and beach look pale" became
 * "dark's marks are all lighter than their ground by 10-13 L* and keep its colour; light's are a mix at a third of that".
 * These tests give it pictures whose answer is known.
 */
const { markStyle, styleCell, labInto, washOf, washVerdict, WASH_BAR, STYLE_HEADER, STYLE_DEFAULTS } = require('../../../scripts/wind-bench/style');

const W = 40, H = 40;
/** An RGBA image from a per-pixel colour function. */
const image = (fn) => { const px = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = fn(x, y), p = (y * W + x) * 4; px[p] = r; px[p + 1] = g; px[p + 2] = b; px[p + 3] = 255; } return px; };
const FIELD_RGB = [120, 150, 190];                         // a mid blue field
const field = image(() => FIELD_RGB);
const stripes = (mark) => image((x) => (x % 4 === 0 ? mark : FIELD_RGB));   // one column in four is a mark: 25% cover
const L = (rgb) => labInto([0, 0, 0], ...rgb)[0];

describe('the marks against the field under them', () => {
  it('no particles: no marks', () => {
    const [land, water] = markStyle(field, field, null);
    expect(land).toEqual({ cover: 0, pixels: W * H });
    expect(water).toEqual({ cover: 0, pixels: 0 });
  });
  it('lighter marks: positive dL, all one polarity, the cover is the share of changed pixels', () => {
    const mark = [200, 220, 245], [s] = markStyle(stripes(mark), field, null);
    expect(s.cover).toBeCloseTo(0.25, 4);
    expect(s.lighter).toBe(1);
    expect(s.dL).toBeCloseTo(L(mark) - L(FIELD_RGB), 0);   // histogram step 0.5
    expect(s.absDL).toBeCloseTo(L(mark) - L(FIELD_RGB), 1);
    expect(s.strong).toBe(1);                               // 25 L* off the ground: every mark pixel is past 15
    expect(s.Lfield).toBeCloseTo(L(FIELD_RGB), 0);
    expect(s.Lmark).toBeCloseTo(L(mark), 0);
  });
  it('darker marks (ink): negative dL, lighter share 0', () => {
    const [s] = markStyle(stripes([40, 60, 110]), field, null);
    expect(s.dL).toBeLessThan(-20);
    expect(s.lighter).toBe(0);
  });
  it('a mark with a light ring and a dark core reads as MIXED polarity and a small median: the hatching signature', () => {
    const mixed = image((x) => (x % 4 === 0 ? [235, 240, 250] : x % 4 === 1 ? [70, 90, 130] : FIELD_RGB));
    const [s] = markStyle(mixed, field, null);
    expect(s.cover).toBeCloseTo(0.5, 4);
    expect(s.lighter).toBeCloseTo(0.5, 3);
    expect(Math.abs(s.dL)).toBeLessThan(s.absDL);          // the two halves cancel in the median, not in the mean magnitude
    expect(s.dL10).toBeLessThan(-15); expect(s.dL90).toBeGreaterThan(15);
  });
  it('colour: a grey mark washes the field out, a same-hue mark keeps the hue, another hue is seen as one', () => {
    const [grey] = markStyle(stripes([200, 200, 200]), field, null);
    expect(grey.Cmark).toBeLessThan(grey.Cfield - 15);
    expect(grey.dh).toBeNull();                             // an achromatic mark has no hue to compare
    const [same] = markStyle(stripes([170, 200, 240]), field, null);   // a lighter blue
    expect(same.dh).toBeLessThanOrEqual(8);
    const [other] = markStyle(stripes([240, 200, 60]), field, null);   // gold on blue
    expect(other.dh).toBeGreaterThan(120);
  });
  it('a change under the mark threshold is not a mark, and a faint one is not a strong one', () => {
    const [none] = markStyle(stripes([122, 152, 192]), field, null);    // about 1 dE
    expect(none.cover).toBe(0);
    const [faint] = markStyle(stripes([140, 168, 205]), field, null);   // about 7 L*
    expect(faint.cover).toBeCloseTo(0.25, 4);
    expect(faint.strong).toBe(0);
    expect(STYLE_DEFAULTS).toEqual({ markDE: 4, strongDL: 15, chromatic: 8 });
  });
  it('the mask splits land from water, each scored on its own pixels', () => {
    const mask = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) mask[i] = (i % W) < W / 2 ? 0 : 1;   // left half land, right half water
    const full = image((x) => (x % 4 === 0 ? (x < W / 2 ? [200, 220, 245] : [40, 60, 110]) : FIELD_RGB));
    const [land, water] = markStyle(full, field, mask);
    expect(land.pixels).toBe(W * H / 2); expect(water.pixels).toBe(W * H / 2);
    expect(land.lighter).toBe(1); expect(water.lighter).toBe(0);
    expect(land.dL).toBeGreaterThan(20); expect(water.dL).toBeLessThan(-20);
  });
  it('the table cell lines up under its header and says so when there is nothing to score', () => {
    const [s] = markStyle(stripes([200, 220, 245]), field, null);
    expect(styleCell(s)).toMatch(/^0\.250 +\+2\d\.\d \[ *\+2\d\.\d, *\+2\d\.\d\] +2\d\.\d 1\.00 1\.00/);
    expect(styleCell({ cover: 0 })).toContain('no marks');
    expect(styleCell(null)).toContain('no marks');
    expect(STYLE_HEADER).toContain('cover');
    expect(STYLE_HEADER).toMatch(/wash darker +end$/);
    expect(styleCell(s).endsWith(` ${washVerdict(s)}`)).toBe(true);
  });
});

// WASH (LESSONS L-V28): light under dark's streak method was picked from still crops and seen live to wash the picture out. The bench had
// the numbers and no bar on them. These pictures pin what the wash numbers say, and the measured anchors pin the bar.
describe('the wash: how much a surface\'s marks lift it, where the picture ends, and whether any mark keeps a dark edge', () => {
  const ground = (rgb) => image(() => rgb);
  const marked = (rgb, mark, every) => image((x) => (x % every === 0 ? mark : rgb));
  const lift = (rgb, dl) => { let c = rgb.slice(); while (L(c) < L(rgb) + dl) c = c.map((v) => Math.min(255, v + 1)); return c; };
  it('wash is cover x the median step, end is the field\'s L* plus it, darker the share of marks below the ground', () => {
    const mark = [200, 220, 245], [s] = markStyle(stripes(mark), field, null);
    expect(s.wash).toBeCloseTo(0.25 * s.dL, 1);
    expect(s.end).toBeCloseTo(s.Lfield + s.wash, 1);
    expect(s.darker).toBe(0);
    const [ink] = markStyle(stripes([40, 60, 110]), field, null);
    expect(ink.darker).toBe(1); expect(ink.wash).toBeLessThan(0); expect(ink.end).toBeLessThan(ink.Lfield);
    const mixed = image((x) => (x % 4 === 0 ? [235, 240, 250] : x % 4 === 1 ? [70, 90, 130] : FIELD_RGB));
    expect(markStyle(mixed, field, null)[0].darker).toBeCloseTo(0.5, 3);
    expect(washOf(0.5, 12, 40, 0)).toEqual({ wash: 6, darker: 0, end: 46 });
  });
  it('the same lift is luminous streaks on a dark ground and a wash on a pale one; a dark edge is never a wash', () => {
    const DARK = [55, 60, 80], PALE = [205, 200, 215];
    const [onDark] = markStyle(marked(DARK, lift(DARK, 12), 2), ground(DARK), null);
    const [onPale] = markStyle(marked(PALE, lift(PALE, 12), 2), ground(PALE), null);
    expect(onDark.wash).toBeCloseTo(onPale.wash, 0);                 // the plain product cannot tell them apart
    expect(washVerdict(onDark)).toBe('ok'); expect(washVerdict(onPale)).toBe('wash');
    const edged = image((x) => (x % 4 === 0 ? lift(PALE, 12) : x % 4 === 1 ? lift(PALE, 12) : x % 4 === 2 ? [150, 145, 160] : PALE));
    const [withEdge] = markStyle(edged, ground(PALE), null);
    expect(withEdge.darker).toBeGreaterThanOrEqual(WASH_BAR.darker);
    expect(washVerdict(withEdge)).toBe('ok');
    expect(washVerdict({ cover: 0 })).toBe('ok'); expect(washVerdict(null)).toBe('ok');
  });
  // Measured (map-run.js --offline, Mobile Bay, served strength, z6; log 2026-10-10-light-look-ab): the anchors the bar stands on.
  const MEASURED = {
    dark: { land: { cover: 0.459, dL: 17, Lfield: 24, darker: 0 }, water: { cover: 0.726, dL: 10.5, Lfield: 42.5, darker: 0.07 } },
    beachLikedLive: { land: { cover: 0.525, dL: 12.5, Lfield: 61, darker: 0 }, water: { cover: 0.856, dL: 12, Lfield: 58.5, darker: 0 } },
    lightGlowWashedLive: { land: { cover: 0.409, dL: 8, Lfield: 71, darker: 0 }, water: { cover: 0.829, dL: 13.5, Lfield: 62.5, darker: 0 } },
    lightToday: { land: { cover: 0.587, dL: 6, Lfield: 71.5, darker: 0.284 }, water: { cover: 0.909, dL: 11.5, Lfield: 63, darker: 0.12 } },
  };
  const cell = (m) => ({ cover: m.cover, ...washOf(m.cover, m.dL, m.Lfield, m.darker) });
  it('dark, the reference, adds the MOST lightness and is no wash; beach, liked live, is no wash; light under glow, washed out live, is', () => {
    const wash = (k) => cell(MEASURED[k].land).wash;
    expect(wash('dark')).toBeGreaterThan(wash('beachLikedLive'));
    expect(wash('beachLikedLive')).toBeGreaterThan(wash('lightGlowWashedLive'));   // why the plain product is not the bar
    for (const surface of ['land', 'water']) {
      expect(washVerdict(cell(MEASURED.dark[surface]))).toBe('ok');
      expect(washVerdict(cell(MEASURED.beachLikedLive[surface]))).toBe('ok');
      expect(washVerdict(cell(MEASURED.lightGlowWashedLive[surface]))).toBe('wash');
    }
    expect(washVerdict(cell(MEASURED.lightToday.land))).toBe('ok');      // as pale, but 28% of its mark pixels are darker: an edge
    expect(washVerdict(cell(MEASURED.lightToday.water))).toBe('wash');   // over the water its edge is thin (12%)
    expect(WASH_BAR).toEqual({ end: 71, darker: 0.15 });
  });
});
