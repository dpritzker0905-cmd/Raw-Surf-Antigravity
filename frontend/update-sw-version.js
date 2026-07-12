const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Trigger Netlify redeployment after backend security hardening updates

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

// Stamp the SAME version into the app bundle (src/buildVersion.js) so the running page can
// self-identify its build in console logs and forensic dumps — a session on a stale service-worker
// cache is then provable from one log line instead of a re-diagnosis (verify-bundle-hash-first).
const bvPath = path.join(__dirname, 'src', 'buildVersion.js');
if (fs.existsSync(bvPath)) {
  let bv = fs.readFileSync(bvPath, 'utf8');
  bv = bv.replace(/export const BUILD_VERSION = .*/, `export const BUILD_VERSION = '${version}';`);
  fs.writeFileSync(bvPath, bv, 'utf8');
  console.log(`Successfully updated BUILD_VERSION in src/buildVersion.js to: ${version}`);
} else {
  console.error(`Error: buildVersion module not found at: ${bvPath}`);
}
