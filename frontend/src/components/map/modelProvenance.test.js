/**
 * R11-11 item 4 — the silent GFS cross-fall. The infobox header prints the SELECTED model over
 * pixels that may be GFS: at EURO + fog it reads "ECMWF Forecast" above a GFS raster, at every
 * hour, because `LayerRegistry` pins fog to `ncep_gfs025` for all three models.
 *
 * These tests pin the DISCLOSURE, and deliberately not the horizon constants. Those thresholds
 * (120/168/228/240) live in four independently drifted copies and none of them is authoritative;
 * the rendered slot URL is what the GPU is painting, so it is the only thing worth asserting on.
 */
import { familyOfOmModel, describeSubstitution, describeLayerSubstitution, describeStaleHour } from './modelProvenance';

const SLOT = (model, ti = 3) =>
  `om://https://map-tiles.open-meteo.com/data_spatial/${model}/latest.json?time_step=valid_times_${ti}&variable=visibility&contours=true`;

function makeMap({ layerKey = 'fog', model = 'ncep_gfs025', activeSlot = 1 } = {}) {
  return {
    getSource: (id) => {
      const m = id.match(new RegExp(`${layerKey}-slot-(\\d)-source`));
      if (!m) return null;
      return +m[1] === 0 ? { url: 'om://transparent-tile' } : { url: SLOT(model) };
    },
    getPaintProperty: (id) => {
      const m = id.match(new RegExp(`${layerKey}-slot-(\\d)-layer`));
      if (!m) return 0;
      return +m[1] === activeSlot ? ['interpolate', ['linear'], ['zoom'], 2, 0.45] : 0;
    },
  };
}

describe('familyOfOmModel — versioned ids collapse to what a user recognises', () => {
  it('maps every id resolveModel can emit', () => {
    expect(familyOfOmModel('ncep_gfs025')).toBe('GFS');       // fog, pressure
    expect(familyOfOmModel('ncep_gfs013')).toBe('GFS');       // wind, atmospheric
    expect(familyOfOmModel('ncep_gfswave025')).toBe('GFS');   // marine
    expect(familyOfOmModel('dwd_icon')).toBe('ICON');
    expect(familyOfOmModel('dwd_gwam')).toBe('ICON');         // the ICON wave model
    expect(familyOfOmModel('ecmwf_ifs025')).toBe('ECMWF');
    expect(familyOfOmModel('ecmwf_wam025')).toBe('ECMWF');
  });

  it('returns null for an unknown id rather than guessing', () => {
    // A wrong family label would manufacture a FALSE "substituted" banner — the same lie in
    // reverse, and harder to notice because it looks like diligence.
    expect(familyOfOmModel('some_new_model_2027')).toBeNull();
    expect(familyOfOmModel(null)).toBeNull();
    expect(familyOfOmModel('')).toBeNull();
  });
});

describe('describeSubstitution — absent unless there is something true to say', () => {
  it('says nothing when the rendered model is the selected one', () => {
    expect(describeSubstitution('GFS', 'ncep_gfs025')).toBeNull();
    expect(describeSubstitution('EURO', 'ecmwf_ifs025')).toBeNull();
    expect(describeSubstitution('ICON', 'dwd_gwam')).toBeNull();   // family, not exact id
  });

  it('THE DEFECT: EURO + fog is really GFS, and now says so', () => {
    const s = describeSubstitution('EURO', 'ncep_gfs025');
    expect(s).not.toBeNull();
    expect(s.rendered).toBe('GFS');
    expect(s.selected).toBe('ECMWF');
    expect(s.text).toMatch(/GFS/);
    expect(s.text).toMatch(/ECMWF/);
  });

  it('ICON past its horizon is disclosed the same way', () => {
    expect(describeSubstitution('ICON', 'ncep_gfs013').rendered).toBe('GFS');
  });

  it('carries WORDS, not a colour — information may never be colour-alone', () => {
    const s = describeSubstitution('EURO', 'ncep_gfs025');
    expect(typeof s.text).toBe('string');
    expect(s.text.length).toBeGreaterThan(10);
    expect(s.short).toBe('GFS shown');
  });

  it('says nothing when the model id is unrecognised', () => {
    expect(describeSubstitution('EURO', 'mystery_model')).toBeNull();
  });
});

describe('describeLayerSubstitution — reads the SLOT, not a horizon constant', () => {
  it('discloses the fog pin on EURO', () => {
    const s = describeLayerSubstitution('EURO', 'fog', { map: makeMap({ model: 'ncep_gfs025' }) });
    expect(s && s.rendered).toBe('GFS');
  });

  it('stays silent on GFS, where the same pin is not a substitution', () => {
    expect(describeLayerSubstitution('GFS', 'fog', { map: makeMap({ model: 'ncep_gfs025' }) }))
      .toBeNull();
  });

  it('follows the ACTIVE slot, so a stale neighbouring slot cannot speak for the screen', () => {
    const map = makeMap({ model: 'ecmwf_ifs025', activeSlot: 2 });
    expect(describeLayerSubstitution('EURO', 'fog', { map })).toBeNull();
  });

  it('is ABSENT (not a false "no substitution") before a slot resolves', () => {
    // Mid-mount the sources do not exist yet. A caller must not paint an empty banner.
    expect(describeLayerSubstitution('EURO', 'fog', { map: { getSource: () => null } })).toBeNull();
    expect(describeLayerSubstitution('EURO', 'fog', { map: null })).toBeNull();
    expect(describeLayerSubstitution('EURO', null, { map: makeMap() })).toBeNull();
  });
});


describe('describeStaleHour — the half describeSubstitution is blind to', () => {
  const T0 = Date.parse('2026-08-09T00:00:00Z');
  const axis = (n) => Array.from({ length: n }, (_, i) => new Date(T0 + i * 3600000).toISOString());
  const deps = (n, live = true) => ({
    metadataCache: { dwd_icon: { validTimes: axis(n) } },
    liveModels: new Set(live ? ['dwd_icon'] : []),
    nowMs: T0,
  });

  it('SILENT while the model still carries the hour', () => {
    expect(describeStaleHour('dwd_icon', 100, deps(169))).toBeNull();
    expect(describeStaleHour('dwd_icon', 168, deps(169))).toBeNull();   // exactly the last: real
  });

  it('SPEAKS past the axis, and names the hour it is actually showing', () => {
    const s = describeStaleHour('dwd_icon', 300, deps(169));
    expect(s).not.toBeNull();
    expect(s.carriesH).toBe(168);
    expect(s.requestedH).toBe(300);
    expect(s.text).toMatch(/168/);
    expect(s.text).toMatch(/300/);      // "stale" without a number is just anxiety
  });

  it('⛔ REFUSES on bootstrap placeholder axes — a false banner is not better than silence', () => {
    // LayerRegistry seeds every model with generateDefaultTimes before anything is fetched. Reading
    // one of those as evidence would warn "stale" about a model whose real axis is longer.
    expect(describeStaleHour('dwd_icon', 300, deps(169, /* live */ false))).toBeNull();
  });

  it('refuses on an unknown model, absent metadata, or a non-numeric hour', () => {
    expect(describeStaleHour('mystery', 300, deps(169))).toBeNull();
    expect(describeStaleHour('dwd_icon', 300,
      { metadataCache: {}, liveModels: new Set(['dwd_icon']), nowMs: T0 })).toBeNull();
    expect(describeStaleHour('dwd_icon', NaN, deps(169))).toBeNull();
    expect(describeStaleHour('dwd_icon', undefined, deps(169))).toBeNull();
  });

  it('carries WORDS, per the colour-alone ban', () => {
    const s = describeStaleHour('dwd_icon', 300, deps(169));
    expect(typeof s.text).toBe('string');
    expect(s.short).toBe('+168 h shown');
  });
});
