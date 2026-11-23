/**
 * The infobox reads the frame the map draws (SOTA-GAP inspection 2026-11-23, finding 10; ownFrameReadout.js).
 * DARK: REACT_APP_INFOBOX_OWN_FRAME=true. Pins: the CPU sample IS the fragment shader's (lattice, bilinear, antimeridian wrap,
 * no-data corners, air temperature's lapse * dz); the card's number, words and accessible name per layer, gusts and currents
 * included; an engaged layer never falls back to another source; the strict .om sampler; flag off = the old cards.
 */
import { fieldValueAt, directionTowardAt, ownFrameValueAt, ownFrameCards, noteShownFrame, getShownFrame,
  _resetOwnFrameReadoutForTest, infoboxOwnFrameEnabled, visibilityWords } from './ownFrameReadout';
import { compileForecastCards } from './forecastCardCompiler';
import { sampleDecodedOmValue } from './decodedOmSampler';
import { downscaleAt } from './ownRasterLayer';
import { gustWindowLabel } from './gustWindow';

const H = 3600000;
const SEL = Date.parse('2026-11-23T12:00:00Z');
// A regional grid: v = 2 * lon + 3 * lat at every node, so bilinear reproduces the plane EXACTLY between nodes.
function plane({ west = -100, south = 10, cols = 11, rows = 6, d = 1, validMs = SEL, runMs = SEL - 6 * H } = {}) {
  const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) values[r * cols + c] = 2 * (west + c * d) + 3 * (south + r * d);
  return { cols, rows, bounds: { west, south, east: west + (cols - 1) * d, north: south + (rows - 1) * d }, values, validMs, runMs };
}
// A full circle: 8 columns 45 degrees apart from -180 (no repeated column), so the shader wraps column 7 -> column 0.
function ring() {
  const cols = 8; const rows = 3; const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) values[r * cols + c] = c * 10 + r;
  return { cols, rows, bounds: { west: -180, south: -10, east: 135, north: 10 }, values, validMs: SEL, runMs: SEL };
}

beforeEach(() => {
  _resetOwnFrameReadoutForTest();
  process.env.REACT_APP_INFOBOX_OWN_FRAME = 'true';
  delete window.__RAW_DISABLE_INFOBOX_OWN_FRAME__;
});
afterEach(() => { delete process.env.REACT_APP_INFOBOX_OWN_FRAME; delete window.map; delete window.__DECODED_OM_TILES__; });

describe('fieldValueAt = the fragment shader', () => {
  it('bilinear on the cell-centre lattice: exact on a plane, at nodes and between them', () => {
    const f = plane();
    for (const [lat, lng] of [[10, -100], [12.25, -97.5], [14.9, -90.1], [15, -90], [11.5, -95.75]]) {
      expect(fieldValueAt(f, lat, lng)).toBeCloseTo(2 * lng + 3 * lat, 3);
    }
  });
  it('a regional grid: outside its longitudes is nothing (the shader discards); latitude clamps to the edge row', () => {
    const f = plane();
    expect(fieldValueAt(f, 12, -100.01)).toBeNull();
    expect(fieldValueAt(f, 12, -89.99)).toBeNull();
    expect(fieldValueAt(f, 40, -95)).toBeCloseTo(2 * -95 + 3 * 15, 3);   // clamped to the north row, as the shader's clamp
  });
  it('a full-circle grid wraps across the antimeridian by integer column, both ways round', () => {
    const f = ring();
    expect(fieldValueAt(f, 0, 157.5)).toBeCloseTo((70 + 0) / 2 + 1, 4);   // halfway from column 7 (135) to column 0 (-180)
    expect(fieldValueAt(f, 0, -202.5)).toBeCloseTo(fieldValueAt(f, 0, 157.5), 6);
    expect(fieldValueAt(f, 0, 180)).toBeCloseTo(1, 6);                    // = -180, column 0
  });
  it('any corner of no data (MISSING, NaN) is no data, never a partial average', () => {
    const f = plane();
    f.values[1 * f.cols + 3] = -9999;
    expect(fieldValueAt(f, 11.5, -96.5)).toBeNull();
    expect(fieldValueAt(f, 11.5, -95.5)).not.toBeNull();
    f.values[0] = NaN;
    expect(fieldValueAt(f, 10.2, -99.8)).toBeNull();
  });
  it('flow direction: the nearest node of the one-byte codes, degrees TOWARD', () => {
    const f = plane();
    f.dirCodes = new Uint8Array(f.cols * f.rows).fill(32);   // 32 * 360 / 256 = 45 degrees: toward the northeast
    expect(directionTowardAt(f, 12.2, -95.3)).toBe(45);
    expect(directionTowardAt(plane(), 12, -95)).toBeNull();     // not decoded (the particles off): no direction, never a guess
  });
});

describe('ownFrameValueAt: only for a layer drawn from our frames, and it never falls back', () => {
  const engagedTemp = { temperature: 'GFS' };
  it('flag off, kill switch, or the layer on the .om path: not applicable (null)', () => {
    noteShownFrame('temperature', { path: 'p', field: plane(), model: 'GFS' });
    expect(ownFrameValueAt('temperature', 12, -95, { engaged: {} })).toBeNull();
    window.__RAW_DISABLE_INFOBOX_OWN_FRAME__ = true;
    expect(infoboxOwnFrameEnabled()).toBe(false);
    expect(ownFrameValueAt('temperature', 12, -95, { engaged: engagedTemp })).toBeNull();
    delete window.__RAW_DISABLE_INFOBOX_OWN_FRAME__;
    delete process.env.REACT_APP_INFOBOX_OWN_FRAME;
    expect(ownFrameValueAt('temperature', 12, -95, { engaged: engagedTemp })).toBeNull();
  });
  it('the frame on screen, its model and time; air temperature adds the shader lapse * dz', () => {
    const f = plane();
    noteShownFrame('temperature', { path: 'v1/gfs/t/x.bin', field: f, model: 'GFS' });
    expect(getShownFrame('temperature').path).toBe('v1/gfs/t/x.bin');
    const plain = ownFrameValueAt('temperature', 12, -95, { engaged: engagedTemp, downscale: null });
    expect(plain).toMatchObject({ engaged: true, value: expect.any(Number), validMs: SEL, model: 'GFS', downscaled: false });
    const tile = { col0: 0, cols: 361, rows: 181, data: new Uint8Array(361 * 181).fill(110) };
    const asset = { lattice: { west: -180, south: -90, dlon: 1, dlat: 1, cols: 360, rows: 181 }, offset: 100, step: 50, lapse: -0.0065, tiles: [tile] };
    const adj = ownFrameValueAt('temperature', 12, -95, { engaged: engagedTemp, downscale: asset });
    expect(downscaleAt(asset, -95, 12)).toBe(500);
    expect(adj.value).toBeCloseTo(plain.value - 3.25, 4);
    expect(adj.downscaled).toBe(true);
  });
  it('no frame of ours on screen yet: gusts / currents wait ("Loading"); a layer the .om path still draws keeps its own readout', () => {
    expect(ownFrameValueAt('gusts', 12, -95, { engaged: { gusts: 'GFS' } })).toMatchObject({ value: undefined });
    expect(ownFrameValueAt('pressure', 12, -95, { engaged: { pressure: 'GFS' } })).toBeNull();
  });
  it('an own-only model claimed with nothing to draw is "Unavailable", and a no-data point is "No data here", never another source', () => {
    const idle = ownFrameValueAt('temperature', 12, -95, { engaged: { temperature: 'ICON:idle' } });
    expect(ownFrameCards(idle)[0]).toMatchObject({ label: 'Air Temp', value: 'Unavailable' });
    noteShownFrame('rain', { path: 'r', field: plane(), model: 'ICON' });
    const off = ownFrameValueAt('rain', 50, -95.5, { engaged: { rain: 'ICON' } });
    expect(off.value).toBeCloseTo(2 * -95.5 + 3 * 15, 3);   // clamped row: still the frame's own value
    const outside = ownFrameValueAt('rain', 12, 20, { engaged: { rain: 'ICON' } });
    expect(outside.value).toBeNull();
    expect(ownFrameCards(outside)[0]).toMatchObject({ label: 'Precip', value: 'No data here' });
  });
});

describe('ownFrameCards: the number, its words and its accessible name', () => {
  const rd = (layer, value, over = {}) => ({ engaged: true, layer, value, validMs: SEL, runMs: SEL - 6 * H, model: 'GFS', ...over });
  it('each layer in the units its legend reads', () => {
    expect(ownFrameCards(rd('pressure', 1013.4))[0]).toMatchObject({ label: 'Pressure', value: '1013 hPa' });
    expect(ownFrameCards(rd('temperature', 20))[0]).toMatchObject({ label: 'Air Temp', value: '68°F' });
    expect(ownFrameCards(rd('water_temp', 25))[0]).toMatchObject({ label: 'Water Temp', value: '77°F' });
    expect(ownFrameCards(rd('satellite', 42.6))[0]).toMatchObject({ label: 'Cloud Cover', value: '43%' });
    expect(ownFrameCards(rd('rain', 1.26))[0]).toMatchObject({ label: 'Precip', value: '1.3 mm/h' });
    expect(ownFrameCards(rd('fog', 800))[0]).toMatchObject({ label: 'Visibility', value: 'Dense Fog (<1km)' });
    expect(ownFrameCards(rd('water_temp', null))[0].value).toBe('Land / no data');
    expect(visibilityWords(12000)).toBe('Clear (12 km)');
  });
  it('gusts: knots and WHICH gust (the gust window, by the frame\'s own model and lead) in words and in the accessible name', () => {
    const [card] = ownFrameCards(rd('gusts', 31.6, { model: 'EURO' }), { selectedMs: SEL });
    const w = gustWindowLabel('EURO', 6);
    expect(card).toMatchObject({ label: 'Gusts', value: '32 kts' });
    expect(card.note).toBe(w);
    expect(card.ariaLabel).toContain('Wind gusts 32 knots');
    if (w) expect(card.ariaLabel).toContain(w.toLowerCase());
    expect(card.ariaLabel).toContain('ECMWF');
  });
  it('currents: speed and a direction card in words (toward, never an arrow alone)', () => {
    const cards = ownFrameCards(rd('currents', 1.24, { model: 'RTOFS', towardDeg: 45 }), { selectedMs: SEL });
    expect(cards[0]).toMatchObject({ label: 'Current', value: '1.2 kts' });
    expect(cards[0].ariaLabel).toMatch(/Ocean current 1\.2 knots.*NOAA RTOFS/);
    expect(cards[1]).toMatchObject({ label: 'to NE', value: '45°', rotate: 45 });
    expect(cards[1].ariaLabel).toBe('Current flowing toward the northeast, 45 degrees');
    expect(ownFrameCards(rd('currents', 0.5), { selectedMs: SEL })).toHaveLength(1);
  });
  it('a frame of another hour than the wheel says which, on the card and in its name', () => {
    const [same] = ownFrameCards(rd('pressure', 1000), { selectedMs: SEL });
    expect(same.note).toBeUndefined();
    const [other] = ownFrameCards(rd('pressure', 1000, { validMs: SEL - 3 * H }), { selectedMs: SEL });
    expect(other.note).toMatch(/^at \d{1,2} (AM|PM)$/);   // same day: the hour alone, so a phone row does not truncate it
    const [nextDay] = ownFrameCards(rd('pressure', 1000, { validMs: SEL + 30 * H }), { selectedMs: SEL });
    expect(nextDay.note).toMatch(/^at [A-Z][a-z]{2} \d{1,2} (AM|PM)$/);
    expect(other.ariaLabel).toMatch(/forecast for /);
  });
});

describe('the infobox: the own frame replaces the layer\'s cards (one number per layer)', () => {
  const base = { activeLayer: 'temperature', activeModel: 'GFS', isLoading: false, temp: 30, sampledAirTempC: 31, degToCompass: () => 'N',
    getClampedValue: () => null, wx: {}, heightUnit: 'ft' };
  it('flag off / not applicable: the point forecast card, as before', () => {
    const cards = compileForecastCards({ ...base, ownFrameCards: null });
    expect(cards.filter((c) => c.label === 'Air Temp').map((c) => c.value)).toEqual(['86°F']);
  });
  it('own frame: exactly one Air Temp card, the frame\'s value (terrain-adjusted words included)', () => {
    const own = ownFrameCards({ engaged: true, layer: 'temperature', value: 20, validMs: SEL, model: 'GFS', downscaled: true }, { selectedMs: SEL });
    const cards = compileForecastCards({ ...base, ownFrameCards: own });
    const air = cards.filter((c) => c.label === 'Air Temp');
    expect(air).toHaveLength(1);
    expect(air[0]).toMatchObject({ value: '68°F', note: 'terrain-adjusted' });
    expect(air[0].ariaLabel).toContain('adjusted for terrain');
  });
  it('gusts and currents now have cards at all', () => {
    for (const layer of ['gusts', 'currents']) {
      expect(compileForecastCards({ ...base, activeLayer: layer })).toHaveLength(0);   // before: nothing
      const own = ownFrameCards({ engaged: true, layer, value: 12, validMs: SEL, runMs: SEL, model: 'GFS' }, { selectedMs: SEL });
      expect(compileForecastCards({ ...base, activeLayer: layer, ownFrameCards: own }).length).toBeGreaterThan(0);
    }
  });
});

describe('the .om sampler under the flag: the slot on screen or nothing', () => {
  const GRID = (ti) => `om://https://openmeteo.s3.amazonaws.com/data_spatial/ncep_gfs013/latest.json?time_step=valid_times_${ti}&variable=surface_temperature`;
  const mapAt = (ti) => ({ getSource: (id) => (/slot-1-source/.test(id) ? { url: GRID(ti) } : null),
    getPaintProperty: (id) => (/slot-1-layer/.test(id) ? ['interpolate'] : 0) });
  const tile = (ti) => ({ variable: 'surface_temperature', model: 'ncep_gfs013', timeIndex: ti, timestamp: ti, bounds: [0, 0, 4, 3], nx: 4, ny: 3,
    values: new Float32Array(12).fill(ti) });
  const read = (map, ...tiles) => sampleDecodedOmValue({ variable: 'surface_temperature', layerKey: 'water_temp', lat: 1, lng: 1 },
    { map, tiles: new Map(tiles.map((t, i) => [i, t])) });
  it('flag off: another hour\'s newest tile, or a left-over tile with no slot at all (finding 10, as before)', () => {
    delete process.env.REACT_APP_INFOBOX_OWN_FRAME;
    expect(read(mapAt(7), tile(5))).toBe(5);
    expect(read(null, tile(5))).toBe(5);
  });
  it('flag on: only the exact slot; otherwise null', () => {
    expect(read(mapAt(7), tile(5))).toBeNull();
    expect(read(null, tile(5))).toBeNull();
    expect(read(mapAt(7), tile(5), tile(7))).toBe(7);
  });
});
