/**
 * Wind bench, STYLE columns (scripts/wind-bench/style.js, printed by map-run.js): what the wind's marks look like against
 * the field under them. It is the instrument behind windInk.js: "dark looks great, light and beach look pale" became
 * "dark's marks are all lighter than their ground by 10-13 L* and keep its colour; light's are a mix at a third of that".
 * These tests give it pictures whose answer is known.
 */
const { markStyle, styleCell, labInto, STYLE_HEADER, STYLE_DEFAULTS } = require('../../../scripts/wind-bench/style');

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
  });
});
