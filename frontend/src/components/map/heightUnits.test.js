import { getHeightUnit, setHeightUnit, formatHeightFromMeters, M_TO_FT } from './heightUnits';

// The wave-height display-unit preference (2026-07-12 user: m/ft toggle). Data stays metric;
// this module owns the display preference + formatting. jsdom provides localStorage.

describe('heightUnits — ft/m display preference', () => {
  beforeEach(() => window.localStorage.removeItem('__RAW_HEIGHT_UNIT__'));

  it('defaults to feet (the pre-toggle live behavior)', () => {
    expect(getHeightUnit()).toBe('ft');
  });

  it('persists and round-trips the preference', () => {
    expect(setHeightUnit('m')).toBe('m');
    expect(getHeightUnit()).toBe('m');
    expect(setHeightUnit('ft')).toBe('ft');
    expect(getHeightUnit()).toBe('ft');
  });

  it('coerces junk to feet (never an invalid unit)', () => {
    window.localStorage.setItem('__RAW_HEIGHT_UNIT__', 'furlongs');
    expect(getHeightUnit()).toBe('ft');
    expect(setHeightUnit('cubits')).toBe('ft');
  });

  it('dispatches rawsurf:height-unit so open readouts can re-render', () => {
    const seen = [];
    const h = (e) => seen.push(e.detail.unit);
    window.addEventListener('rawsurf:height-unit', h);
    setHeightUnit('m');
    window.removeEventListener('rawsurf:height-unit', h);
    expect(seen).toEqual(['m']);
  });

  it('formats meters in the requested unit (compact + withUnit)', () => {
    expect(formatHeightFromMeters(1.0, 'm')).toBe('1');
    expect(formatHeightFromMeters(1.0, 'ft')).toBe('3.3');            // 3.28 ft
    expect(formatHeightFromMeters(3.05, 'ft')).toBe('10');            // ~10 ft rounds whole
    expect(formatHeightFromMeters(0.2, 'm')).toBe('0.2');
    expect(formatHeightFromMeters(1.5, 'm', { withUnit: true })).toBe('1.5 m');
    expect(formatHeightFromMeters(1.5, 'ft', { withUnit: true })).toBe(`${(Math.round(1.5 * M_TO_FT * 10) / 10)} ft`);
    expect(formatHeightFromMeters(null, 'ft')).toBe('—');
    expect(formatHeightFromMeters(undefined, 'm')).toBe('—');
  });
});
