import { resolveMarineFields } from './marineFieldResolver';

function resolve(vectors, { N = vectors.length, layer = 'waves', rating = false, phys = false } = {}) {
  const fields = Object.fromEntries(['uArr', 'vArr', 'hArr', 'pArr', 'confArr'].map(k => [k, new Float32Array(N).fill(99)]));
  fields.oceanArr = new Uint8Array(N).fill(99);
  fields.motionArr = rating ? new Uint8Array(N).fill(99) : null;
  fields.hPhys = phys ? new Float32Array(N).fill(99) : null;
  return { fields, count: resolveMarineFields(vectors, layer, N, fields) };
}

it('does not synthesize placeholder direction on masked waves, but preserves explicit ocean precedence', () => {
  const { fields } = resolve([{ u: 0, v: 0, direction: 0, waves: { is_valid: false } },
    { u: 0, v: 0, direction: 0, isOcean: true, waves: { is_valid: false } }]);
  expect(Array.from(fields.uArr)).toEqual([0, -0]);
  expect(Array.from(fields.vArr)).toEqual([0, -1]);
  expect(Array.from(fields.oceanArr)).toEqual([0, 1]);
});

it.each([
  [{ phys_speed: 3, physSpeed: 4, waves: { phys_speed: 5 } }, 3],
  [{ physSpeed: 4, waves: { phys_speed: 5 } }, 4],
  [{ waves: { phys_speed: 5 } }, 5], [{}, 2],
])('preserves honest physical-height precedence in rating mode: %j', (extra, expected) => {
  const { fields } = resolve([{ height: 2, speed: 7, ...extra }], { rating: true, phys: true });
  expect(fields.hArr[0]).toBe(2); expect(fields.hPhys[0]).toBe(expected);
});

it('preserves motion on masked real data and leaves genuine zero-data land still', () => {
  const { fields } = resolve([{ is_valid: false, u: .2, height: 2 }, { is_valid: false, u: 0, v: 0, height: 0, period: 0 }],
    { rating: true, phys: true });
  expect(Array.from(fields.oceanArr)).toEqual([0, 0]); expect(Array.from(fields.motionArr)).toEqual([1, 0]);
});

it('preserves active-layer overrides, confidence clamping and land default confidence', () => {
  const { fields } = resolve([{ u: 5, height: 5, dirConfidence: .8, swell_1: { u: 1, height: 2, period: 9, dirConfidence: -1 } },
    { dirConfidence: .3, swell_1: { isOcean: false, dirConfidence: .1 } },
    { swell_1: { dir_confidence: 2 } }], { layer: 'swell_1' });
  expect(Array.from(fields.confArr)).toEqual([0, 1, 1]);
  expect(fields.uArr[0]).toBe(1); expect(fields.hArr[0]).toBe(2); expect(fields.pArr[0]).toBe(9);
});

it('clears the unused scratch tail and retains the diagnostic speed count', () => {
  const { fields, count } = resolve([{ speed: 3, period: 8 }], { N: 3, rating: true, phys: true });
  expect(count).toEqual({ numGridToProcess: 1, flatSpeedNonzeroCount: 1 });
  for (const [key, values] of Object.entries(fields)) expect(Array.from(values).slice(1)).toEqual(key === 'confArr' ? [1, 1] : [0, 0]);
});
