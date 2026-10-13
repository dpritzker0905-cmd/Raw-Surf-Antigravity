// Copies only: replay baseline and unsafe-time counterfactual without modifying app source.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../../..');
const dir = path.join(__dirname, 'variants');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(root, 'frontend/src/components/map/marineGlobalPrewarm.js');
const source = fs.readFileSync(file, 'utf8');
const rewrite = text => text.replace(/from '(\.\/[^']+)'/g, (_, spec) =>
  'from ' + JSON.stringify(path.resolve(path.dirname(file), spec).replaceAll('\\', '/')));
const start = source.indexOf('    // The global series page may already hold');
const end = source.indexOf('    _globalGridPrewarmInFlight.add(key);', start);
if (start < 0 || end < 0) throw Error('Expected reuse block not found');
const variants = {
  baseline: source.slice(0, start) + source.slice(end),
  'candidate-control': source,
  'unsafe-time': source
    .replace('sg.hourOffset === hourOffset && Date.parse(sg.valid_time) === targetTime &&', 'true &&')
    .replace('(!sg.served_valid_time || Date.parse(sg.served_valid_time) === targetTime) &&', 'true &&')
    .replace('!sg.frame_substituted) {', 'true) {'),
};
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const receipt = { source: path.relative(root, file), sourceSha256: sha256(source), variants: {} };
for (const [name, text] of Object.entries(variants)) {
  const content = rewrite(text);
  fs.writeFileSync(path.join(dir, `${name}.js`), content);
  receipt.variants[name] = sha256(content);
}
receipt.testSha256 = sha256(fs.readFileSync(path.join(root, 'frontend/src/components/map/marineGlobalPrewarm.seriesReuse.test.js')));
fs.writeFileSync(path.join(__dirname, 'variant-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log('Prepared audit-only variants; app source unchanged.');
