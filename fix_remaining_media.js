/**
 * fix_remaining_media.js - Fix the remaining raw media srcs that couldn't be done inline
 * Uses string replacement with exact context - safe to run multiple times (idempotent)
 */
const fs = require('fs');
const path = require('path');

const COMPONENTS_DIR = 'frontend/src/components';
const IMPORT_LINE = "import { getFullUrl } from '../utils/media';";

function findFile(dir, name) {
  const entries = fs.readdirSync(dir);
  for (const e of entries) {
    const full = path.join(dir, e);
    if (fs.statSync(full).isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (e === name) {
      return full;
    }
  }
  return null;
}

function addImportIfMissing(content, importLine) {
  if (content.includes('getFullUrl')) return content; // already imported
  const lines = content.split('\n');
  let lastImportIdx = -1;
  lines.forEach((l, i) => { if (/^import /.test(l)) lastImportIdx = i; });
  if (lastImportIdx >= 0) {
    lines.splice(lastImportIdx + 1, 0, importLine);
  }
  return lines.join('\n');
}

// List of [filename, oldStr, newStr] - use exact whitespace from the file
const patches = [
  // CrewPaymentModal.js L153
  ['CrewPaymentModal.js', 
    '                src={invite.captain.avatar_url}',
    '                src={getFullUrl(invite.captain.avatar_url)}'],

  // GlobalSearchBar.js L362 — post image_url 
  ['GlobalSearchBar.js', 
    '                  src={post.image_url}',
    '                  src={getFullUrl(post.image_url)}'],
    
  // SpotHub.js L317
  ['SpotHub.js', 
    '              src={spot.image_url} alt={spot.name} className="w-14 h-14 rounded-lg object-cove',
    null], // Need to read and check exact string

  // GearHub.js L192 and L308
  ['GearHub.js',
    'src={targetGear.image_url}',
    'src={getFullUrl(targetGear.image_url)}'],

  // settings/AccountBillingHub.js - grom avatar
  ['settings/AccountBillingHub.js',
    'src={grom.avatar_url}',
    'src={getFullUrl(grom.avatar_url)}'],

  // AIProposedMatches.js
  ['AIProposedMatches.js',
    'src={match.preview_url}',
    'src={getFullUrl(match.preview_url)}'],
];

let fixed = 0;
let skipped = [];

patches.forEach(([filename, oldStr, newStr]) => {
  if (!newStr) { skipped.push(filename + ': needs manual check'); return; }
  
  const filepath = path.join(COMPONENTS_DIR, filename);
  let realPath = fs.existsSync(filepath) ? filepath : findFile(COMPONENTS_DIR, filename.includes('/') ? path.basename(filename) : filename);
  
  if (!realPath) { skipped.push(filename + ': not found'); return; }
  
  let c = fs.readFileSync(realPath, 'utf8');
  
  if (!c.includes(oldStr)) {
    // Try with different whitespace - check for partial match
    const shortOld = oldStr.trim();
    const lines = c.split('\n');
    const matchLine = lines.find(l => l.trim() === shortOld);
    if (matchLine) {
      c = c.replace(matchLine, matchLine.replace(shortOld, newStr.trim()));
    } else {
      skipped.push(filename + ': "' + oldStr.trim().substring(0, 40) + '" NOT FOUND');
      return;
    }
  } else {
    c = c.replace(oldStr, newStr);
  }
  
  // Add getFullUrl import if it wasn't already present
  c = addImportIfMissing(c, IMPORT_LINE);
  
  fs.writeFileSync(realPath, c, 'utf8');
  fixed++;
  console.log('✅ ' + filename);
});

// GalleryPage.js - multiple preview_url fixes
const galleryPath = path.join(COMPONENTS_DIR, 'GalleryPage.js');
if (fs.existsSync(galleryPath)) {
  let c = fs.readFileSync(galleryPath, 'utf8');
  const before = c;
  // Replace all raw preview_url srcs
  c = c.replace(/src=\{item\.preview_url\}/g, 'src={getFullUrl(item.preview_url)}');
  c = addImportIfMissing(c, IMPORT_LINE);
  if (c !== before) {
    fs.writeFileSync(galleryPath, c, 'utf8');
    console.log('✅ GalleryPage.js (preview_url x3)');
    fixed++;
  } else {
    skipped.push('GalleryPage.js: no changes needed');
  }
}

// GalleryFolderCard.js
const gfcPath = findFile(COMPONENTS_DIR, 'GalleryFolderCard.js');
if (gfcPath) {
  let c = fs.readFileSync(gfcPath, 'utf8');
  if (c.includes('src={folder.thumbnail_url}')) {
    c = c.replace('src={folder.thumbnail_url}', 'src={getFullUrl(folder.thumbnail_url)}');
    c = addImportIfMissing(c, IMPORT_LINE);
    fs.writeFileSync(gfcPath, c, 'utf8');
    console.log('✅ GalleryFolderCard.js');
    fixed++;
  }
}

// SurferGallery.js
const sgPath = path.join(COMPONENTS_DIR, 'SurferGallery.js');
if (fs.existsSync(sgPath)) {
  let c = fs.readFileSync(sgPath, 'utf8');
  const before = c;
  c = c.replace(/src=\{purchase\.thumbnail_url\}/g, 'src={getFullUrl(purchase.thumbnail_url)}');
  c = c.replace(/src=\{session\.thumbnail_url\}/g, 'src={getFullUrl(session.thumbnail_url)}');
  c = addImportIfMissing(c, IMPORT_LINE);
  if (c !== before) {
    fs.writeFileSync(sgPath, c, 'utf8');
    console.log('✅ SurferGallery.js');
    fixed++;
  }
}

// PhotographerGalleryManager.js
const pgmPath = path.join(COMPONENTS_DIR, 'PhotographerGalleryManager.js');
if (fs.existsSync(pgmPath)) {
  let c = fs.readFileSync(pgmPath, 'utf8');
  if (c.includes('src={selectedItem.preview_url}')) {
    c = c.replace(/src=\{selectedItem\.preview_url\}/g, 'src={getFullUrl(selectedItem.preview_url)}');
    c = addImportIfMissing(c, IMPORT_LINE);
    fs.writeFileSync(pgmPath, c, 'utf8');
    console.log('✅ PhotographerGalleryManager.js');
    fixed++;
  }
}

// SpotHub.js
const shPath = path.join(COMPONENTS_DIR, 'SpotHub.js');
if (fs.existsSync(shPath)) {
  let c = fs.readFileSync(shPath, 'utf8');
  if (c.includes('src={spot.image_url}')) {
    c = c.replace(/src=\{spot\.image_url\}/g, 'src={getFullUrl(spot.image_url)}');
    c = addImportIfMissing(c, IMPORT_LINE);
    fs.writeFileSync(shPath, c, 'utf8');
    console.log('✅ SpotHub.js');
    fixed++;
  }
}

// GearHub.js - item.image_url too
const ghPath = path.join(COMPONENTS_DIR, 'GearHub.js');
if (fs.existsSync(ghPath)) {
  let c = fs.readFileSync(ghPath, 'utf8');
  const before = c;
  c = c.replace(/src=\{item\.image_url\}/g, 'src={getFullUrl(item.image_url)}');
  c = addImportIfMissing(c, IMPORT_LINE);
  if (c !== before) {
    fs.writeFileSync(ghPath, c, 'utf8');
    console.log('✅ GearHub.js (item.image_url)');
    fixed++;
  }
}

// Explore.js - spot.image_url inside
const explorePath = path.join(COMPONENTS_DIR, 'Explore.js');
if (fs.existsSync(explorePath)) {
  let c = fs.readFileSync(explorePath, 'utf8');
  const hasImport = c.includes('getFullUrl');
  const before = c;
  c = c.replace(/src=\{spot\.image_url\}/g, 'src={getFullUrl(spot.image_url)}');
  c = addImportIfMissing(c, IMPORT_LINE);
  if (c !== before) {
    fs.writeFileSync(explorePath, c, 'utf8');
    console.log('✅ Explore.js');
    fixed++;
  }
}

// admin/AdminContentModDashboard.js
const acdPath = findFile(COMPONENTS_DIR, 'AdminContentModDashboard.js');
if (acdPath) {
  let c = fs.readFileSync(acdPath, 'utf8');
  if (c.includes('src={selectedItem.media_url}')) {
    c = c.replace(/src=\{selectedItem\.media_url\}/g, 'src={getFullUrl(selectedItem.media_url)}');
    c = addImportIfMissing(c, IMPORT_LINE.replace("'../utils/media'", "'../../utils/media'"));
    fs.writeFileSync(acdPath, c, 'utf8');
    console.log('✅ AdminContentModDashboard.js');
    fixed++;
  }
}

// UnifiedAdminConsole.js
const uacPath = path.join(COMPONENTS_DIR, 'UnifiedAdminConsole.js');
if (fs.existsSync(uacPath)) {
  let c = fs.readFileSync(uacPath, 'utf8');
  if (c.includes('src={ad.image_url}')) {
    c = c.replace(/src=\{ad\.image_url\}/g, 'src={getFullUrl(ad.image_url)}');
    c = addImportIfMissing(c, IMPORT_LINE);
    fs.writeFileSync(uacPath, c, 'utf8');
    console.log('✅ UnifiedAdminConsole.js');
    fixed++;
  }
}

if (skipped.length > 0) {
  console.log('\n⚠️  Skipped:');
  skipped.forEach(s => console.log('  ' + s));
}
console.log('\nFixed: ' + fixed + ' components');
