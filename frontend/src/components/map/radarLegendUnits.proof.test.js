/**
 * PROOF: the radar layer disagrees with itself in THREE places (R11-11 item 7, 2026-08-09).
 *
 * Established by reading the shipped source, not by inference:
 *
 *   THE RASTER    LayerRegistry.radar.source = "RAINVIEWER_REFLECTIVITY", fetched through
 *                 rainviewerTileTemplate as `.../{px}/{z}/{x}/{y}/7/1_0.png` — RainViewer colour
 *                 scheme 7, an EXTERNAL palette keyed on reflectivity (dBZ).
 *   THE LEGEND    label 'Live Radar (dBZ)'  ✓ correct for that raster
 *                 stops ['0', '.1', '.3', '.5', '2+']  ✗ those are rain-RATE shaped, not dBZ
 *                 (dBZ runs ~5..75; a 0-to-2 axis cannot be reflectivity), over a hand-authored
 *                 5-colour gradient that only APPROXIMATES scheme 7.
 *   THE READOUT   the infobox prints `${precip} mm/h` from wx.precipitation — the MODEL, not the
 *                 radar. So observed pixels sit beside a modelled number.
 *
 * ⛔ NO FIX IS APPLIED, AND THAT IS THE FINDING. Correcting the stops requires RainViewer's
 * scheme-7 dBZ thresholds — a PRIMARY SOURCE that is not in this repo. Writing plausible dBZ
 * numbers would be inventing data to make a legend look consistent, which is a worse defect than
 * the one being fixed: it would read as measured. The alternative (relabelling to mm/h) is also
 * wrong, because the raster genuinely is reflectivity.
 *
 * TO CLOSE THIS, someone needs the scheme-7 palette spec, and then either (a) real dBZ stops, or
 * (b) qualitative bands (Light/Moderate/Heavy) which claim no precision the approximation cannot
 * support. Until then these assertions keep the mismatch VISIBLE instead of forgotten.
 */
import fs from 'fs';
import path from 'path';

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

describe('the radar legend, the radar raster, and the radar readout', () => {
  it('the RASTER is reflectivity from RainViewer colour scheme 7', () => {
    expect(read('LayerRegistry.js')).toMatch(/radar:[\s\S]{0,200}RAINVIEWER_REFLECTIVITY/);
    // The trailing `/7/` is the colour scheme; `1_0` is smooth=1, snow=0.
    expect(read('radarForecastSources.js')).toMatch(/\$\{px\}\/\{z\}\/\{x\}\/\{y\}\/7\/1_0\.png/);
  });

  it('the LEGEND labels it dBZ — correct for the raster', () => {
    expect(read('MapWeatherControls.js')).toMatch(/radar: 'Live Radar \(dBZ\)'/);
  });

  it('⚠️ but its STOPS are not dBZ: a 0..2 axis cannot be reflectivity (dBZ runs ~5..75)', () => {
    const stops = read('MapWeatherControls.js')
      .match(/radar[\s\S]{0,220}?stops: evenStops\(\[([^\]]+)\]\)/);
    expect(stops).not.toBeNull();                     // setup: the config moved, re-derive
    const values = stops[1].split(',').map((s) => parseFloat(s.replace(/['\s+]/g, '')));
    expect(Math.max(...values)).toBeLessThan(5);      // the whole axis sits below the dBZ floor
  });

  it('⚠️ and the READOUT under those observed pixels is a MODEL number in mm/h', () => {
    const compiler = read('forecastCardCompiler.js');
    expect(compiler).toMatch(/activeLayer === 'rain' \|\| activeLayer === 'radar'/);
    expect(compiler).toMatch(/mm\/h/);
  });

  it('the three-way mismatch is still open (this test is the record, not the fix)', () => {
    // Deliberately a documentation assertion: it fails only if someone removes the dBZ label or
    // the sub-5 stops WITHOUT resolving which one was authoritative, i.e. if the evidence is
    // silently discarded rather than acted on.
    const src = read('MapWeatherControls.js');
    const labelsDbz = /radar: 'Live Radar \(dBZ\)'/.test(src);
    const stopsAreRates = /radar[\s\S]{0,220}?stops: evenStops\(\['0', '\.1'/.test(src);
    expect(labelsDbz && stopsAreRates).toBe(true);
  });
});
