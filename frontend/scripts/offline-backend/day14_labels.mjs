// day14_labels.mjs — the status-line words the user would see for each row of day14_arms.py's arm files.
//
// Runs the CLIENT'S OWN describeDrawnFrame (src/components/map/drawnFrameReadout.js, #560's drawn-frame truth) on each row's
// label inputs: the drawn record as marineDrawnFrame.publishMarineDrawn builds it from the /grid response (the served time is the
// data instant, is_estimated, estimate_basis.type, the ASKED model), against the selection's instant with the lattice half-step
// (latticeNearestMaxHours). The module has no imports; it is copied to a temporary .mjs because the frontend package is not
// ESM-typed. Times are worded in the owner's zone: TZ=America/New_York node day14_labels.mjs arm0.json arm1.json ...
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'src', 'components', 'map', 'drawnFrameReadout.js');
const copy = join(mkdtempSync(join(tmpdir(), 'day14-labels-')), 'drawnFrameReadout.mjs');
writeFileSync(copy, readFileSync(src, 'utf8'));
const { describeDrawnFrame, latticeNearestMaxHours, formatInstant } = await import(pathToFileURL(copy).href);

for (const file of process.argv.slice(2)) {
  const arm = JSON.parse(readFileSync(file, 'utf8'));
  for (const row of arm.rows) {
    if (!row.label_inputs) { row.label = { state: 'error', text: `HTTP ${row.status}` }; continue; }
    const { requested, drawn } = row.label_inputs;
    const req = { ...requested, nearestMaxHours: latticeNearestMaxHours(requested.model, requested.hour) };
    const r = describeDrawnFrame(req, drawn, { nowMs: Date.parse(arm.now) });
    row.label = r || { state: 'none', text: '(no status line: the drawn frame is the selection)' };
    row.label.selected = formatInstant(requested.labelMs);
  }
  writeFileSync(file, JSON.stringify(arm, null, 1));
  for (const row of arm.rows) console.log(`arm ${arm.arm} ${row.model} +${row.hour}h [${row.label.selected}] ${row.label.state}: ${row.label.text}`);
}
