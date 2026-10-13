/**
 * F-13 (audit 14.0) — the forecast-raster host must be the live one, named in exactly one place.
 *
 * THE DEFECT THIS PINS. Every forecast raster (precipitation, pressure, air temperature, water
 * temperature, fog, satellite cloud) rendered blank because the configured host
 * `map-tiles.open-meteo.com` is GONE — measured 2026-09-20, DNS resolution fails and curl returns
 * http=000, so every metadata and tile request died before reaching the network. The owner saw six
 * dead layers; nothing in the app said why, because a failed metadata fetch looked like "no data".
 *
 * These are STRUCTURAL assertions, deliberately. They cannot prove the endpoint is reachable —
 * that needs the network and would make the suite flaky and time-dependent. What they can prove is
 * that the dead host has not crept back and that the host is named once rather than scattered
 * across nine files, which is what let a single upstream move break six layers at once.
 */
const fs = require('fs');
const path = require('path');

const {
  OPEN_METEO_SPATIAL_HOST,
  OPEN_METEO_SPATIAL_BASE_URL,
  isOpenMeteoSpatialUrl,
} = require('./openMeteoEndpoints');

const SRC_ROOT = path.join(__dirname, '..', '..');
const DEAD_HOST = 'map-tiles.open-meteo.com';

function walkJs(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkJs(p, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

describe('F-13 Open-Meteo spatial endpoint', () => {
  it('points at the documented live host, not the dead one', () => {
    expect(OPEN_METEO_SPATIAL_HOST).toBe('openmeteo.s3.amazonaws.com');
    expect(OPEN_METEO_SPATIAL_BASE_URL).toBe('https://openmeteo.s3.amazonaws.com/data_spatial');
    expect(OPEN_METEO_SPATIAL_BASE_URL).not.toContain(DEAD_HOST);
  });

  it('the dead host appears NOWHERE in src except the comment that documents it', () => {
    const offenders = [];
    for (const file of walkJs(SRC_ROOT)) {
      const text = fs.readFileSync(file, 'utf8');
      if (!text.includes(DEAD_HOST)) continue;
      // Two files name it legitimately: the endpoint module records what broke and why, and THIS
      // file has to spell it out in order to search for it. Everything else is an offender.
      const base = path.basename(file);
      if (base === 'openMeteoEndpoints.js' || base === 'openMeteoEndpoints.test.js') continue;
      offenders.push(path.relative(SRC_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('recognises spatial URLs by host so a future move needs one edit, not nine', () => {
    expect(isOpenMeteoSpatialUrl(`${OPEN_METEO_SPATIAL_BASE_URL}/ncep_gfs025/latest.json`)).toBe(true);
    // The om:// protocol wraps the https URL, and the guards test the string, not just a prefix.
    expect(isOpenMeteoSpatialUrl(`om://${OPEN_METEO_SPATIAL_BASE_URL}/dwd_icon/latest.json?variable=precipitation`)).toBe(true);
    expect(isOpenMeteoSpatialUrl(`https://${DEAD_HOST}/data_spatial/ncep_gfs025/latest.json`)).toBe(false);
    expect(isOpenMeteoSpatialUrl(null)).toBe(false);
    expect(isOpenMeteoSpatialUrl(undefined)).toBe(false);
    expect(isOpenMeteoSpatialUrl(42)).toBe(false);
  });

  it('every live URL builder and protocol guard takes the host from this module', () => {
    // ⚠️ CORRECTED 2026-09-26 (audit 15.0 A15-20). This test used to assert that each builder
    // CONTAINED the live host literal, which pinned the very duplication this module exists to end:
    // nothing imported openMeteoEndpoints.js, and the host stayed spelled out 14 times across six
    // files, so a future move still needed fourteen edits, not one. The builders now import it.
    const builders = [
      'components/map/openMeteoMetadata.js',
      'components/map/openMeteoProtocol.js',
      'components/map/useOpenMeteoTileUrls.js',
      'components/map/useTemporalPreloader.js',
      'components/map/WeatherTelemetry.js',
      'index.js',
    ];
    for (const rel of builders) {
      const text = fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8');
      expect({ file: rel, dead: text.includes(DEAD_HOST) }).toEqual({ file: rel, dead: false });
      expect({ file: rel, imports: /from '\.\/(components\/map\/)?openMeteoEndpoints'/.test(text) })
        .toEqual({ file: rel, imports: true });
    }
  });

  it('the live host is spelled out in exactly one module, so a move is one edit', () => {
    const spelled = walkJs(SRC_ROOT)
      .filter((f) => !/\.test\.js$/.test(f) && fs.readFileSync(f, 'utf8').includes(OPEN_METEO_SPATIAL_HOST))
      .map((f) => path.relative(SRC_ROOT, f).split(path.sep).join('/'));
    expect(spelled).toEqual(['components/map/openMeteoEndpoints.js']);
  });
});
