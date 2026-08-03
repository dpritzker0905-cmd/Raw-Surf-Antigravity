/**
 * A telemetry ring's usefulness is bounded by its LOUDEST WRITER, not by its cap.
 *
 * Measured three times on the live map, each time as "one emitter is ~all of the ring":
 *   texture_generated  495/500      model_warning  73.8%      FPS_drop_detected  86.4% of 434
 * Each was fixed by quietening that emitter — which only promotes the next-loudest. The shape is
 * the EVICTION POLICY. A plain FIFO ring lets one per-frame emit delete every other type within
 * seconds, and `WeatherTelemetry` had no per-type counter at all, so those types disappeared with
 * NO RESIDUAL COUNT: unrecoverable, not merely truncated.
 *
 * Two properties are pinned here:
 *   1. `counts` is monotonic and survives eviction — the true total is always recoverable.
 *   2. Proportional-fair eviction — the oldest entry of the MOST-RESIDENT type is dropped, so a
 *      rare event survives an unbounded flood of a common one.
 *
 * ★ The kill-switch test is the negative control: with `__RAW_TELEMETRY_NO_QUOTA__` the rare event
 *   IS lost. Without it, a green suite would not prove the quota is what saves the event.
 */
import { WeatherTelemetry } from '../components/map/WeatherTelemetry';

const reset = () => {
  WeatherTelemetry.logs = [];
  WeatherTelemetry.counts = Object.create(null);
  WeatherTelemetry.ringCounts = Object.create(null);
  WeatherTelemetry.evictedByType = Object.create(null);
  delete window.__RAW_TELEMETRY_NO_QUOTA__;
};

const flood = (type, n) => {
  for (let i = 0; i < n; i++) WeatherTelemetry.emit(type, { i });
};

const residentOf = (type) => WeatherTelemetry.logs.filter((e) => e.type === type).length;

describe('telemetry ring: the loudest writer must not erase every other type', () => {
  beforeEach(reset);
  afterEach(reset);

  test('a single render_failed SURVIVES a flood that is 86% of the ring', () => {
    WeatherTelemetry.emit('render_failed', { reason: 'the event that kept being lost' });
    flood('FPS_drop_detected', WeatherTelemetry.MAX_LOGS * 3);

    expect(WeatherTelemetry.logs.length).toBe(WeatherTelemetry.MAX_LOGS);
    expect(residentOf('render_failed')).toBe(1);
    // ...and the flood is what got evicted, not the rare event.
    expect(WeatherTelemetry.evictedByType.FPS_drop_detected).toBeGreaterThan(0);
    expect(WeatherTelemetry.evictedByType.render_failed).toBeUndefined();
  });

  test('NEGATIVE CONTROL — with the quota killed, the rare event is lost', () => {
    window.__RAW_TELEMETRY_NO_QUOTA__ = true;
    WeatherTelemetry.emit('render_failed', { reason: 'plain FIFO' });
    flood('FPS_drop_detected', WeatherTelemetry.MAX_LOGS * 3);

    expect(residentOf('render_failed')).toBe(0);
    // ★ and THIS is why the monotonic counter matters: the event is gone from the ring but the
    //   fact that it happened is still recoverable.
    expect(WeatherTelemetry.counts.render_failed).toBe(1);
  });

  test('counts are monotonic and survive eviction; logs are only a sample', () => {
    flood('texture_generated', WeatherTelemetry.MAX_LOGS * 2);

    expect(WeatherTelemetry.counts.texture_generated).toBe(WeatherTelemetry.MAX_LOGS * 2);
    expect(WeatherTelemetry.logs.length).toBe(WeatherTelemetry.MAX_LOGS);
    // quoting log length as a total would under-report by half
    expect(residentOf('texture_generated')).toBeLessThan(
      WeatherTelemetry.counts.texture_generated
    );
  });

  test('several rare types all survive one dominant flood', () => {
    const rare = ['tile_failed', 'model_error', 'WebGL_context_restored', 'model_switch'];
    rare.forEach((t) => WeatherTelemetry.emit(t));
    flood('FPS_drop_detected', WeatherTelemetry.MAX_LOGS * 5);

    rare.forEach((t) => {
      expect(residentOf(t)).toBe(1);
      expect(WeatherTelemetry.counts[t]).toBe(1);
    });
  });

  test('with ONE type resident the policy is byte-for-byte the old FIFO', () => {
    flood('only_type', WeatherTelemetry.MAX_LOGS + 10);
    expect(WeatherTelemetry.logs.length).toBe(WeatherTelemetry.MAX_LOGS);
    // newest-first ring: [0] is the newest emit, and the oldest 10 were dropped in order
    expect(WeatherTelemetry.logs[0].payload.i).toBe(WeatherTelemetry.MAX_LOGS + 9);
    expect(WeatherTelemetry.logs[WeatherTelemetry.logs.length - 1].payload.i).toBe(10);
  });

  test('two equally loud types split the ring instead of one winning', () => {
    for (let i = 0; i < WeatherTelemetry.MAX_LOGS * 2; i++) {
      WeatherTelemetry.emit(i % 2 === 0 ? 'a' : 'b', { i });
    }
    // neither may be starved: a strict FIFO would keep whichever emitted most recently
    expect(residentOf('a')).toBeGreaterThan(WeatherTelemetry.MAX_LOGS * 0.4);
    expect(residentOf('b')).toBeGreaterThan(WeatherTelemetry.MAX_LOGS * 0.4);
  });

  test('ringHealth reports saturation so a sample is never quoted as a total', () => {
    WeatherTelemetry.emit('render_failed');
    let h = WeatherTelemetry.ringHealth();
    expect(h.saturated).toBe(false);
    expect(h.total).toBe(1);

    flood('FPS_drop_detected', WeatherTelemetry.MAX_LOGS * 2);
    h = WeatherTelemetry.ringHealth();
    expect(h.saturated).toBe(true);
    expect(h.loudest).toBe('FPS_drop_detected');
    expect(h.loudestShare).toBeGreaterThan(0.9);
    expect(h.total).toBe(WeatherTelemetry.MAX_LOGS * 2 + 1);
    expect(h.resident).toBe(WeatherTelemetry.MAX_LOGS);
    // the discriminator the rings have always lacked: total !== resident means "you are reading
    // a sample", and it is a FIELD rather than something a reader has to infer.
    expect(h.total).toBeGreaterThan(h.resident);
  });

  test('the eviction always makes room — the buffer never grows past its cap', () => {
    const types = ['a', 'b', 'c', 'd', 'e'];
    for (let i = 0; i < 3000; i++) WeatherTelemetry.emit(types[i % types.length], { i });
    expect(WeatherTelemetry.logs.length).toBe(WeatherTelemetry.MAX_LOGS);
    const resident = Object.values(WeatherTelemetry.ringCounts).reduce((a, b) => a + b, 0);
    expect(resident).toBe(WeatherTelemetry.MAX_LOGS); // bookkeeping agrees with the ring
  });
});
