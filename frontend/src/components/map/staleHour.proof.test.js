/**
 * PROOF HARNESS — executes the claims made about the undisclosed stale frame, against the SHIPPED
 * modules. Written to be run BEFORE the disclosure is wired and again AFTER, so the change is
 * demonstrated rather than asserted. The `console.log`s are the point: this file is evidence.
 */
import fs from 'fs';
import path from 'path';

import { closestAxisIndex, isBeyondAxis, axisHorizonHours } from './modelHorizons';
import { describeSubstitution } from './modelProvenance';

const T0 = Date.parse('2026-08-09T00:00:00Z');
const axis = (n) => Array.from({ length: n }, (_, i) => new Date(T0 + i * 3600000).toISOString());
const ICON_ATMO_AXIS = axis(169);            // a model carrying 0..168 h

const SRC_DIR = __dirname;
const readSrc = (f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8');

describe('PROOF: what the map does past the end of a model axis', () => {
  it('CLAIM 1 — asking for hour 300 on a 168 h axis returns the 168 h frame', () => {
    const idx = closestAxisIndex(ICON_ATMO_AXIS, T0 + 300 * 3600000);
    const painted = ICON_ATMO_AXIS[idx];
    const paintedHour = Math.round((Date.parse(painted) - T0) / 3600000);
    console.log(`  [1] requested hour 300 -> index ${idx} -> paints hour ${paintedHour}`);
    expect(idx).toBe(168);
    expect(paintedHour).toBe(168);
  });

  it('CLAIM 2 — the model-substitution disclosure is BLIND to it (family unchanged)', () => {
    // Still true, and still the reason describeStaleHour had to exist as a separate check.
    // Past ICON's atmospheric cutover the tile lane swaps to GFS and modelProvenance speaks up.
    const swapped = describeSubstitution('ICON', 'ncep_gfs013');
    // But when the axis simply runs out on the SELECTED model, nothing swaps, so nothing is said.
    const notSwapped = describeSubstitution('ICON', 'dwd_icon');
    console.log(`  [2] model swapped -> ${swapped ? JSON.stringify(swapped.short) : 'null'}`);
    console.log(`  [2] axis ran out, same model -> ${notSwapped === null ? 'null (SILENT)' : 'spoke'}`);
    expect(swapped).not.toBeNull();
    expect(notSwapped).toBeNull();
  });

  it('CLAIM 3 — the discriminator exists and separates the two cases the clamp conflates', () => {
    const lastReal = isBeyondAxis(ICON_ATMO_AXIS, T0 + 168 * 3600000);
    const standIn = isBeyondAxis(ICON_ATMO_AXIS, T0 + 169 * 3600000);
    console.log(`  [3] hour 168 beyond? ${lastReal}   hour 169 beyond? ${standIn}`);
    console.log(`  [3] axis horizon from T0: ${axisHorizonHours(ICON_ATMO_AXIS, T0)} h`);
    expect(lastReal).toBe(false);
    expect(standIn).toBe(true);
  });

  it('CLAIM 4 — the shipped selector is the one under test (no inline copy survives)', () => {
    const src = readSrc('useOpenMeteoTileUrls.js');
    const callSites = (src.match(/closestAxisIndex\(/g) || []).length;
    console.log(`  [4] inline 'minDiff' copies: ${(src.match(/minDiff/g) || []).length}` +
                `   shared-selector call sites: ${callSites}`);
    expect(src).not.toMatch(/minDiff/);
    expect(callSites).toBe(2);
  });

  it('CLAIM 5 — AFTER: the discriminator now reaches a rendering consumer', () => {
    // The whole point of the next commit. Counted over real components, excluding tests and the
    // module that defines it.
    const files = fs.readdirSync(SRC_DIR)
      .filter((f) => f.endsWith('.js') && !f.includes('.test.') && !f.includes('.proof.')
                     && f !== 'modelHorizons.js');
    // ⚠️ TWO PROBE BUGS FOUND HERE, BOTH BY DISTRUSTING THE PROBE:
    //  1. A STRING MATCH IS NOT A CONSUMER -- the first version counted useOpenMeteoTileUrls.js,
    //     which only MENTIONS isBeyondAxis in a comment I had written minutes earlier.
    //  2. A regex with the /s flag matched under plain node and NOT under jest's transform, so the
    //     corrected probe still reported 0 while the import was plainly there.
    // Line-based scanning instead: simple enough that it cannot quietly mean something else.
    const importsIt = (src) => src.split(/\r?\n/).some((line) =>
      line.startsWith('import ') && line.includes("from './modelHorizons'")
      && (line.includes('isBeyondAxis') || line.includes('axisHorizonHours')));
    const consumers = files.filter((f) => importsIt(readSrc(f)));
    console.log(`  [5] product files consuming isBeyondAxis/axisHorizonHours: ` +
                `${consumers.length}${consumers.length ? ' -> ' + consumers.join(', ') : ' (NONE)'}`);
    // ⭐ A field in a payload is not reach — only a RENDERING CONSUMER is. So this asserts the
    // whole chain: the discriminator reaches modelProvenance, and the overlay renders its text.
    expect(consumers).toContain('modelProvenance.js');
    const overlay = readSrc('MapForecastOverlay.js');
    expect(overlay).toMatch(/describeStaleHour/);
    expect(overlay).toMatch(/staleHour\.text/);
    console.log('  [5] MapForecastOverlay renders staleHour.text: YES');
  });
});
