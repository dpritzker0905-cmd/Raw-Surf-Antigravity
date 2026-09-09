import { sameHandoffTarget, resolveBridgeHandoff, applyBridgeHandoffWash } from './marineBridgeHandoff';
import WebGLMarineEngine, { applySharpenOpacityEase } from './WebGLMarineEngine';

const grid = () => ({ __sourceModel: 'GFS', __componentLayer: 'waves', ratingMode: false,
  served_valid_time: '2026-09-08T00:00:00Z', hourOffset: 0 });
const base = {};
const held = () => ({ grid: grid(), base, mult: 0, bridge: true, wash: .5, covers: false });
const incoming = () => ({ grid: grid(), base, mult: 1, bridge: false, wash: .2, covers: true });

it('is opt-in; default keeps the historical from-hidden snap and wash', () => {
  const r = resolveBridgeHandoff(held(), incoming(), 1000, false);
  expect(r.scale).toBe(1);
  expect(r.wash).toBe(.2);
  expect(r.state.transition).toBeNull();
  expect(applySharpenOpacityEase({ from: 0, t0: 1000 }, .69, 1, 1000, {}).value).toBe(.69);
});

it('hands the visible coarse wash to the replacement without an opacity step and expires', () => {
  const input = incoming();
  const first = resolveBridgeHandoff(held(), input, 1000, true);
  expect(first.scale).toBe(0);
  expect(first.wash).toBe(.5);
  const middle = resolveBridgeHandoff(first.state, input, 1300, true);
  expect(middle.scale).toBe(.5);
  expect(middle.wash).toBeCloseTo(.35);
  const end = resolveBridgeHandoff(middle.state, input, 1600, true);
  expect(end.scale).toBe(1);
  expect(end.wash).toBe(.2);
  expect(end.state.transition).toBeNull();
});

it.each([
  ['model', { __sourceModel: 'EURO' }], ['layer', { __componentLayer: 'swell' }],
  ['valid time', { served_valid_time: '2026-09-08T01:00:00Z' }], ['lead', { hourOffset: 1 }],
  ['rating', { ratingMode: true }], ['unknown rating', { ratingMode: undefined }],
  ['unknown time', { served_valid_time: null }], ['unknown model', { __sourceModel: null }],
  ['malformed time', { served_valid_time: 'not-a-date' }],
])('does not blend across a changed or unknown %s', (_, change) => {
  const previous = held(), input = incoming();
  Object.assign(previous.grid, change);
  expect(sameHandoffTarget(previous.grid, input.grid)).toBe(false);
  expect(resolveBridgeHandoff(previous, input, 1000, true).scale).toBe(1);
});

it.each([
  ['visible resident', { mult: 1 }], ['not a bridge', { bridge: false }],
  ['invisible wash', { wash: 0 }], ['different coarse source', { base: {} }],
])('does not reinterpret a %s as a hidden coverage handoff', (_, change) => {
  expect(resolveBridgeHandoff({ ...held(), ...change }, incoming(), 1000, true).scale).toBe(1);
});

it('requires a real grid replacement with known full coverage', () => {
  const previous = held();
  expect(resolveBridgeHandoff(previous, { ...incoming(), grid: previous.grid }, 1000, true).scale).toBe(1);
  expect(resolveBridgeHandoff(previous, { ...incoming(), covers: false }, 1000, true).scale).toBe(1);
  expect(resolveBridgeHandoff(null, incoming(), 1000, true).scale).toBe(1);
});

it.each([
  ['hidden again', { mult: 0 }], ['lost coarse base', { base: null }],
  ['another commit', { grid: grid() }], ['changed rating', { grid: { ...grid(), ratingMode: true } }],
])('drops an active transition when %s', (_, change) => {
  const input = incoming();
  const first = resolveBridgeHandoff(held(), input, 1000, true);
  const result = resolveBridgeHandoff(first.state, { ...input, ...change }, 1100, true);
  expect(result.scale).toBe(1);
  expect(result.state.transition).toBeNull();
});

it('drops an active transition on kill or a nonfinite/backward clock', () => {
  const input = incoming();
  const first = resolveBridgeHandoff(held(), input, 1000, true);
  for (const now of [999, NaN, Infinity]) {
    expect(resolveBridgeHandoff(first.state, input, now, true).scale).toBe(1);
  }
  expect(resolveBridgeHandoff(first.state, input, 1100, false).scale).toBe(1);
});

it('records the wash actually drawn and clears the handoff across a lifecycle reset', () => {
  const engine = new WebGLMarineEngine();
  engine._bridgeHandoffState = held();
  engine._waveData = { waveGrid: grid() };
  engine._coarseBaseData = base;
  const win = { __RAW_ENABLE_BRIDGE_HANDOFF_BLEND__: true, __RAW_GPU__: {} };
  expect(applyBridgeHandoffWash(engine, .2, 1, false, true, win, 1000)).toBe(.5);
  expect(engine._bridgeHandoffScale).toBe(0);
  expect(win.__RAW_GPU__.washEff).toBe(.5);
  expect(win.__RAW_GPU__.bridgeHandoff.lastReplacement).toMatchObject({
    enabled: true, sameTarget: true, sameBase: true, covers: true, priorMult: 0, priorBridge: true,
  });
  engine.clearBuffers(null);
  expect(engine._bridgeHandoffState).toBeNull();
});

it('records missing/changed identity without enabling a rejected handoff', () => {
  const engine = { _bridgeHandoffState: held(), _waveData: { waveGrid: { ...grid(), served_valid_time: null } },
    _coarseBaseData: base };
  const win = { __RAW_ENABLE_BRIDGE_HANDOFF_BLEND__: true, __RAW_GPU__: {} };
  expect(applyBridgeHandoffWash(engine, .2, 1, false, true, win, 1000)).toBe(.2);
  expect(win.__RAW_GPU__.bridgeHandoff.lastReplacement).toMatchObject({ enabled: true, sameTarget: false,
    before: { served: '2026-09-08T00:00:00Z' }, after: { served: null, asked: null } });
  expect(win.__RAW_GPU__.bridgeHandoff.starts).toBe(0);
});
