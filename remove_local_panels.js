/**
 * remove_local_panels.js
 * Removes the local AdControlsPanel and AdminSpotsPanel definitions from 
 * UnifiedAdminConsole.js now that they are extracted to standalone files.
 */
const fs = require('fs');

const MAIN_FILE = 'frontend/src/components/UnifiedAdminConsole.js';
let content = fs.readFileSync(MAIN_FILE, 'utf8');
const lines = content.split('\n');

// Find exact line ranges to remove
let adCommentStart = -1, adCodeStart = -1, spotsCommentStart = -1, exportLine = -1;

lines.forEach((l, i) => {
  const t = l.trim();
  if (t === '// Ad Controls Panel Component with Approval Queue') adCommentStart = i;
  if (t === 'const AdControlsPanel = ({ user }) => {' && adCodeStart === -1) adCodeStart = i;
  if (t === '// Admin Spots Panel - Global Spot Manager') spotsCommentStart = i;
  if (t === 'export default UnifiedAdminConsole;') exportLine = i;
});

// Use the earlier of the two as the start of the block to remove
const removeStart = Math.min(
  adCommentStart !== -1 ? adCommentStart : adCodeStart,
  adCodeStart
);
const removeEnd = exportLine - 1; // keep one blank line + export

if (removeStart === -1 || removeEnd === -1) {
  console.error('Could not find block boundaries:', { adCommentStart, adCodeStart, spotsCommentStart, exportLine });
  process.exit(1);
}

console.log('Removing lines ' + (removeStart+1) + ' to ' + (removeEnd+1) + ' (' + (removeEnd - removeStart + 1) + ' lines)');

const newLines = [
  ...lines.slice(0, removeStart),
  '\n// AdControlsPanel and AdminSpotsPanel are extracted to admin/AdControlsPanel.js and admin/AdminSpotsPanel.js\n',
  ...lines.slice(exportLine)
];

fs.writeFileSync(MAIN_FILE, newLines.join('\n'), 'utf8');
console.log('✅ Removed local panel definitions from UnifiedAdminConsole.js');
console.log('New total lines:', newLines.length);
