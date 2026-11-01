// day14_pick_check.mjs: replays the CLIENT's own pickIndexFrame (staticFrameCodec.js) on every ask day14_arms.py `asks` graded,
// and fails if any pick differs from the harness's Python mirror. Usage: node day14_pick_check.mjs <asks_picks.json>
// staticFrameCodec.js imports nothing, so a copy under an .mjs name loads in plain node.
import { readFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'pickcheck-'));
copyFileSync(join(here, '..', '..', 'src', 'components', 'map', 'staticFrameCodec.js'), join(dir, 'codec.mjs'));
const { pickIndexFrame } = await import(pathToFileURL(join(dir, 'codec.mjs')).href);
const sets = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let n = 0;
let bad = 0;
for (const [key, { index, picks }] of Object.entries(sets)) {
  const idx = JSON.parse(readFileSync(index, 'utf8'));
  for (const p of picks) {
    const f = pickIndexFrame(idx, Date.parse(p.ask));
    const got = f ? f.valid_time : null;
    n += 1;
    if (got !== p.pick) {
      bad += 1;
      console.log(`${key} ask ${p.ask}: client ${got} vs mirror ${p.pick}`);
    }
  }
}
console.log(JSON.stringify({ asks: n, disagree: bad }));
process.exit(bad ? 1 : 0);
