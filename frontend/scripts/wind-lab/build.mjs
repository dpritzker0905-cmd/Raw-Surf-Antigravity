// Builds the Ground Truth lab (one self-contained page) from its parts.
// Usage: node build.mjs   -> out/ground-truth.html (p5 from cdnjs) and out/ground-truth.local.html (p5 from ./p5.min.js)
import fs from 'fs';
import path from 'path';
const HERE = path.dirname(new URL(import.meta.url).pathname), OUT = path.join(HERE, 'out');
const read = (f) => fs.readFileSync(path.join(HERE, f), 'utf8');
const strip = (f) => read(f).replace(/^if \(typeof module[\s\S]*$/m, '');
const out = read('page.src.html').replace('/*__CORE__*/', strip('core.js')).replace('/*__SIM__*/', strip('sim.js'))
  .replace('/*__GL__*/', strip('gl.js')).replace('/*__MAIN__*/', strip('main.js'));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'ground-truth.html'), out);
fs.writeFileSync(path.join(OUT, 'ground-truth.local.html'), out.replace('https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/p5.min.js', 'p5.min.js'));
console.log('bytes', out.length);
