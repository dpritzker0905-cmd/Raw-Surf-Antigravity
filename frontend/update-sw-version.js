const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const swPath = path.join(__dirname, 'public', 'service-worker.js');
let version = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 12); // Fallback: YYYYMMDDHHMM

try {
  version = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch (e) {
  console.log('Warning: Failed to get git commit hash, using timestamp instead:', e.message);
}

if (fs.existsSync(swPath)) {
  let content = fs.readFileSync(swPath, 'utf8');
  content = content.replace(/const BUILD_VERSION = .*/, `const BUILD_VERSION = '${version}';`);
  fs.writeFileSync(swPath, content, 'utf8');
  console.log(`Successfully updated BUILD_VERSION in service-worker.js to: ${version}`);
} else {
  console.error(`Error: Service worker file not found at: ${swPath}`);
}
