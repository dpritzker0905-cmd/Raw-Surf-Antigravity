const fs = require('fs');
const files = [
  'DispatchLobby.js', 'Explore.js', 'GalleryStorefront.js',
  'NotificationsDrawer.js', 'PhotographerGalleryManager.js',
  'SurferGallery.js', 'GalleryItemModal.js', 'PostSessionSummary.js',
  'SessionRosterCard.js'
];

const base = 'C:/Users/dprit/Raw-Surf/frontend/src/components';
let totalFixes = 0;

// Common garbled patterns and their correct Unicode replacements
const garbledPatterns = [
  // Middle dot (·) - various corruption levels
  [/Ã‚Â·/g, '\u00B7'],
  [/Ã¯Â¿Â½/g, '\u00B7'],
  // Right arrow (→)
  [/Ã¢â€"\u0080Â†â€™Ã‚Â/g, '\u2192'],
  // Any remaining multi-level garbled sequences (aggressive cleanup)
  [/ÃƒÆ'[^A-Za-z0-9\s<>{}()\[\].,;:!?@#\$%^&*+=\-_\/\\'"`~|]{3,}/g, ''],
];

for (const file of files) {
  const filePath = base + '/' + file;
  if (!fs.existsSync(filePath)) {
    // Check subdirectories
    const subdirs = ['explore', 'gallery', 'spot-drawer', 'on-demand', 'booking'];
    let found = false;
    for (const sub of subdirs) {
      const subPath = base + '/' + sub + '/' + file;
      if (fs.existsSync(subPath)) {
        processFile(subPath, file);
        found = true;
        break;
      }
    }
    if (!found) console.log('NOT FOUND: ' + file);
  } else {
    processFile(filePath, file);
  }
}

function processFile(path, name) {
  let content = fs.readFileSync(path, 'utf8');
  let fixes = 0;
  for (const [pattern, replacement] of garbledPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      fixes += matches.length;
      content = content.replace(pattern, replacement);
    }
  }
  if (fixes > 0) {
    fs.writeFileSync(path, content, 'utf8');
    console.log(name + ': ' + fixes + ' fixes');
    totalFixes += fixes;
  } else {
    console.log(name + ': no common patterns (manual check needed)');
  }
}

console.log('Total fixes: ' + totalFixes);
