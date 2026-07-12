import {
  recordMarineEvent,
  forensicDump,
  forensicSummary,
  forensicReset,
} from './marineForensics';

// The __RAW_FORENSIC__ ring buffer: one dump() replaces a thousand-line console paste. These
// tests pin the contract the live-diagnosis workflow depends on: capped ring, timestamped typed
// events, self-identifying dump (build), summary counts, and recording that never throws.

describe('marineForensics — ring-buffer recorder', () => {
  beforeEach(() => forensicReset());

  it('records typed, timestamped events', () => {
    recordMarineEvent('commit', { dims: '9x9', rating: true });
    const d = forensicDump();
    expect(d.eventCount).toBeGreaterThanOrEqual(1);
    const ev = d.events[d.events.length - 1];
    expect(ev.type).toBe('commit');
    expect(ev.dims).toBe('9x9');
    expect(ev.rating).toBe(true);
    expect(typeof ev.t).toBe('number');
  });

  it('dump() self-identifies the build and the capture window', () => {
    const d = forensicDump();
    expect(typeof d.build).toBe('string');   // 'dev' locally, the git hash on deployed builds
    expect(d.build.length).toBeGreaterThan(0);
    expect(typeof d.startedAt).toBe('number');
    expect(d.now).toBeGreaterThanOrEqual(d.startedAt);
    expect(Array.isArray(d.events)).toBe(true);
  });

  it('caps the ring at 500 events, keeping the NEWEST', () => {
    for (let i = 0; i < 620; i++) recordMarineEvent('snap', { i });
    const d = forensicDump();
    // build_check from the first-record announce may occupy one slot — assert the cap, not exact fill.
    expect(d.events.length).toBeLessThanOrEqual(500);
    expect(d.events[d.events.length - 1].i).toBe(619);          // newest survives
    expect(d.events[0].i).toBeGreaterThanOrEqual(120 - 1);      // oldest were evicted
  });

  it('summary() counts by type and keeps the last event of each type', () => {
    recordMarineEvent('commit', { dims: '9x9' });
    recordMarineEvent('commit', { dims: '37x17' });
    recordMarineEvent('reject_downgrade', { incoming: '37x17' });
    const s = forensicSummary();
    expect(s.counts.commit).toBe(2);
    expect(s.counts.reject_downgrade).toBe(1);
    expect(s.last.commit.dims).toBe('37x17');                    // the LAST commit
    expect(typeof s.build).toBe('string');
  });

  it('never throws on hostile input (recording must not break the pipeline)', () => {
    expect(() => recordMarineEvent('weird', null)).not.toThrow();
    expect(() => recordMarineEvent('weird', undefined)).not.toThrow();
    expect(() => recordMarineEvent(undefined, { a: 1 })).not.toThrow();
    const circular = {}; circular.self = circular;
    expect(() => recordMarineEvent('circular', circular)).not.toThrow();
  });

  it('reset() empties the ring for a clean pre-repro capture', () => {
    recordMarineEvent('commit', {});
    forensicReset();
    expect(forensicDump().eventCount).toBe(0);
  });
});
