/**
 * Frontend Migration: Strip admin_id query parameters from API calls
 * 
 * The backend now reads admin identity from JWT Bearer tokens,
 * so we no longer need to send admin_id as query parameters.
 * 
 * Run: node migrate_frontend_admin.js
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const original = content;
  
  // Pattern 1: ?admin_id=${...} at end of URL (before backtick or quote)
  // `...?admin_id=${user.id}` -> `...`
  content = content.replace(/\?admin_id=\$\{[^}]+\}`/g, '`');
  content = content.replace(/\?admin_id=\$\{[^}]+\}'/g, "'");
  content = content.replace(/\?admin_id=\$\{[^}]+\}"/g, '"');
  
  // Pattern 2: ?admin_id=${...}&other=... -> ?other=...
  content = content.replace(/\?admin_id=\$\{[^}]+\}&/g, '?');
  
  // Pattern 3: &admin_id=${...} in middle or end of URL
  content = content.replace(/&admin_id=\$\{[^}]+\}/g, '');
  
  // Pattern 4: ?admin_id=${...}, with params followed by more template literal
  // e.g., `...?admin_id=${user.id}&days=30`  -> `...?days=30`
  // Already handled by patterns 2 and 3 above
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf-8');
    const changes = (original.match(/admin_id=/g) || []).length - (content.match(/admin_id=/g) || []).length;
    console.log(`  ✅ ${path.relative(SRC_DIR, filePath)}: removed ${changes} admin_id param(s)`);
    return changes;
  }
  return 0;
}

function walkDir(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      total += walkDir(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.jsx') || entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      total += processFile(fullPath);
    }
  }
  return total;
}

console.log('🔒 Frontend Migration — Stripping admin_id query params\n');
const totalRemoved = walkDir(SRC_DIR);
console.log(`\n📊 Total admin_id params removed: ${totalRemoved}`);
console.log('✅ apiClient already sends Bearer token for auth — no admin_id needed');
