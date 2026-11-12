/**
 * Tide-cell rounding oracle (follow-up to #791, review finding 6).
 *
 * The client tide cell (tideClient.tideCellKey -> roundTideCoordinate) must match the backend's
 * tide._round_key, which is Python round(x, 1). The expected values are Python's own answers,
 * generated ONCE by frontend/scripts/gen_tide_round_oracle.py into tideRoundOracle.fixture.json;
 * backend/tests/test_tide_round_key_oracle.py pins that tide._round_key still equals the same
 * fixture, so a change on either side breaks CI.
 *
 * Signed zero: Python keeps round(-0.0, 1) == -0.0 while the client yields 0. Both are the same
 * cell (Python's tuple key compares -0.0 == 0.0 and hashes equal), so the comparison is on the
 * cell key the client actually uses, where String(-0) === '0'.
 */
import oracle from './tideRoundOracle.fixture.json';
import { tideCellKey } from './tideClient';

const { inputs, expected } = oracle;

describe('tide-cell rounding oracle (Python round(x, 1))', () => {
  it('fixture is intact and covers the hard cases', () => {
    expect(inputs).toHaveLength(oracle.count);
    expect(expected).toHaveLength(oracle.count);
    expect(inputs.length).toBeGreaterThan(9000);
    expect(inputs.some((x) => Object.is(x, -0))).toBe(true);
    for (const bound of [-180, -90, 90, 180, 0.25, 0.75, -0.25, -0.75, 179.75, -179.75]) {
      expect(inputs).toContain(bound);
    }
    // the exactly representable ties disagree between toFixed and Python; they must be present
    expect(inputs.filter((x) => Math.abs(x) % 0.5 === 0.25).length).toBeGreaterThan(700);
  });

  it('the client lands on the same cell as Python for every fixture input, lat and lng', () => {
    const mismatches = [];
    for (let i = 0; i < inputs.length; i++) {
      const want = String(expected[i]);
      const [lat, lng] = tideCellKey(inputs[i], inputs[inputs.length - 1 - i]).split(',');
      const wantLng = String(expected[inputs.length - 1 - i]);
      if (lat !== want || lng !== wantLng) {
        mismatches.push({ x: inputs[i], got: lat, want, y: inputs[inputs.length - 1 - i], gotLng: lng, wantLng });
        if (mismatches.length >= 20) break;
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('pins the named hard cases (ties to even, binary neighbours, signed zero)', () => {
    const cell = (x) => tideCellKey(x, 0).split(',')[0];
    expect(cell(0.25)).toBe('0.2');                      // exact tie -> even
    expect(cell(0.75)).toBe('0.8');
    expect(cell(-0.25)).toBe('-0.2');
    expect(cell(-179.75)).toBe('-179.8');
    expect(cell(0.25 + Number.EPSILON)).toBe('0.3');     // just above the tie
    expect(cell(0.25 - Number.EPSILON)).toBe('0.2');
    expect(cell(0.15)).toBe('0.1');                       // 0.1499999... in binary
    expect(cell(0.35)).toBe('0.3');                       // 0.3499999...
    expect(cell(1.45)).toBe('1.4');
    expect(cell(-0)).toBe(cell(0));
    expect(cell(-0.04)).toBe('0');                        // Python -0.0 is the same cell
    expect(cell(180)).toBe('180');
    expect(cell(-90)).toBe('-90');
  });
});
