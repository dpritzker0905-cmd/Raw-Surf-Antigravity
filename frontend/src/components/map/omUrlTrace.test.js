import { traceOmUrl } from './omUrlTrace';

// The instrument is only trustworthy if its PARSE is. Two confident, wrong findings on
// 2026-08-13 came from reading tile coordinates badly; these pin the reading itself so the next
// person can argue about the map instead of about the trace.

const arm = () => {
  window.__OM_URL_TRACE__ = { n: 0, x: {}, y: {}, z: {}, recent: [], unmatched: 0 };
  return window.__OM_URL_TRACE__;
};

afterEach(() => { delete window.__OM_URL_TRACE__; });

describe('omUrlTrace', () => {
  test('is a NO-OP until armed — it sits in the hot path of every tile', () => {
    delete window.__OM_URL_TRACE__;
    expect(() => traceOmUrl('om://host/data/2/1/3.om')).not.toThrow();
    expect(window.__OM_URL_TRACE__).toBeUndefined();
  });

  test('records z/x/y from a real om tile URL', () => {
    const t = arm();
    traceOmUrl('om://https://map-tiles.open-meteo.com/data_spatial/ncep_gfs013/2026-08-13T00/2/1/3.om');
    expect(t.n).toBe(1);
    expect(t.z['2']).toBe(1);
    expect(t.x['1']).toBe(1);
    expect(t.y['3']).toBe(1);
    expect(t.recent).toEqual(['2/1/3']);
  });

  test('a trailing query string does not become a coordinate', () => {
    // ⭐ THE ONE THAT MATTERS: these URLs carry `&_cb=<epoch>` and `variable=`. A regex anchored
    // loosely would read digits out of the cache-buster and report tiles that were never asked
    // for -- an instrument inventing its own evidence.
    const t = arm();
    traceOmUrl('om://host/data/9/140/213.om?variable=surface_temperature&dark=true&_cb=1786599027024');
    expect(t.n).toBe(1);
    expect(t.z['9']).toBe(1);
    expect(t.x['140']).toBe(1);
    expect(t.y['213']).toBe(1);
    expect(t.unmatched).toBeFalsy();
  });

  test('counts a non-tile URL as unmatched and keeps ONE sample', () => {
    // The metadata fetch lands here. Keeping a sample is how we learned water_temp is served
    // from ncep_gfs013 whatever model the UI shows -- an unmatched entry is evidence, not noise.
    const t = arm();
    traceOmUrl('om://https://map-tiles.open-meteo.com/data_spatial/ncep_gfs013/latest.json?variable=surface_temperature');
    traceOmUrl('om://host/other/latest.json');
    expect(t.n).toBe(0);
    expect(t.unmatched).toBe(2);
    expect(t.sampleUnmatched).toContain('latest.json');
    expect(t.sampleUnmatched).toContain('ncep_gfs013');   // the FIRST sample is kept, not the last
  });

  test('accumulates counts across a tile sweep', () => {
    const t = arm();
    ['2/0/1', '2/1/1', '2/2/1', '2/0/2', '2/1/2', '2/2/2']
      .forEach(c => traceOmUrl(`om://host/d/${c}.om`));
    expect(t.n).toBe(6);
    expect(Object.keys(t.x).sort()).toEqual(['0', '1', '2']);
    expect(Object.keys(t.y).sort()).toEqual(['1', '2']);
    expect(t.y['1']).toBe(3);
    expect(t.y['2']).toBe(3);
  });

  test('recent is bounded so a long session cannot grow without limit', () => {
    const t = arm();
    for (let i = 0; i < 80; i++) traceOmUrl(`om://host/d/5/${i}/7.om`);
    expect(t.n).toBe(80);
    expect(t.recent.length).toBe(60);
    expect(t.recent[t.recent.length - 1]).toBe('5/79/7');   // newest kept
  });

  test('never throws on junk — it can not be allowed to break the transport', () => {
    arm();
    expect(() => traceOmUrl(null)).not.toThrow();
    expect(() => traceOmUrl(undefined)).not.toThrow();
    expect(() => traceOmUrl({})).not.toThrow();
  });
});
