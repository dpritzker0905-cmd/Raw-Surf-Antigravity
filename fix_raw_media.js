/**
 * fix_all_raw_media_srcs.js
 * Automatically finds and fixes all raw media src attributes missing getFullUrl()
 * Run: node fix_all_raw_media_srcs.js
 */
const fs = require('fs');
const path = require('path');

const COMPONENTS = 'frontend/src/components';

// Map of file -> list of {lineNum, oldSrc, field, varName}
const fixes = [
  // Stories.js — story media
  { file: 'Stories.js', oldStr: '              src={currentStory.media_url}', newStr: '              src={getFullUrl(currentStory.media_url)}', import: true },
  { file: 'Stories.js', oldStr: '              src={authorGroup.author_avatar}', newStr: '              src={getFullUrl(authorGroup.author_avatar)}', import: true },
  { file: 'Stories.js', oldStr: '            <img src={authorGroup.author_avatar} alt=""', newStr: '            <img src={getFullUrl(authorGroup.author_avatar)} alt=""', import: true },

  // GromLimitedFeed.js
  { file: 'GromLimitedFeed.js', oldStr: '                        src={post.media_url} ', newStr: '                        src={getFullUrl(post.media_url)} ', import: true },
  { file: 'GromLimitedFeed.js', oldStr: '                        <img src={post.author_avatar}', newStr: '                        <img src={getFullUrl(post.author_avatar)}', import: true },

  // GromHQ.js
  { file: 'GromHQ.js', oldStr: '              <video src={activity.media_url}', newStr: '              <video src={getFullUrl(activity.media_url)}', import: true },
  { file: 'GromHQ.js', oldStr: '              <img src={activity.media_url}', newStr: '              <img src={getFullUrl(activity.media_url)}', import: true },

  // LivePhotographers.js
  { file: 'LivePhotographers.js', oldStr: '                  src={user.avatar_url}', newStr: '                  src={getFullUrl(user.avatar_url)}', import: true },

  // GromSafetyGate.js
  { file: 'GromSafetyGate.js', oldStr: '                src={gromStatus.parent_info.avatar_url}', newStr: '                src={getFullUrl(gromStatus.parent_info.avatar_url)}', import: true },

  // ImpersonationBanner.js
  { file: 'ImpersonationBanner.js', oldStr: '            src={targetUser.avatar_url}', newStr: '            src={getFullUrl(targetUser.avatar_url)}', import: true },

  // CrewPaymentModal.js
  { file: 'CrewPaymentModal.js', oldStr: '                src={invite.captain.avatar_url}', newStr: '                src={getFullUrl(invite.captain.avatar_url)}', import: true },

  // ExploreSpotCard.js
  { file: 'ExploreSpotCard.js', oldStr: '              src={spot.image_url}', newStr: '              src={getFullUrl(spot.image_url)}', import: true },
];

const IMPORT_STMT = "import { getFullUrl } from '../utils/media';";

let totalFixed = 0;
let skipped = [];

fixes.forEach(({ file, oldStr, newStr, import: needImport }) => {
  const filepath = path.join(COMPONENTS, file);
  if (!fs.existsSync(filepath)) {
    // Try subdirectories
    const found = findFile(COMPONENTS, file);
    if (!found) { skipped.push(file + ' (not found)'); return; }
  }
  
  const realPath = fs.existsSync(filepath) ? filepath : findFile(COMPONENTS, file);
  if (!realPath) { skipped.push(file + ' (not found)'); return; }

  let c = fs.readFileSync(realPath, 'utf8');
  
  if (!c.includes(oldStr)) {
    skipped.push(file + ': "' + oldStr.trim().substring(0, 40) + '" not found');
    return;
  }

  c = c.replace(oldStr, newStr);
  
  // Add import if needed and not already there
  if (needImport && !c.includes('getFullUrl')) {
    // Add after last import line
    const lines = c.split('\n');
    let lastImportIdx = -1;
    lines.forEach((l, i) => { if (/^import /.test(l)) lastImportIdx = i; });
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, IMPORT_STMT);
      c = lines.join('\n');
    }
  }

  fs.writeFileSync(realPath, c, 'utf8');
  totalFixed++;
  console.log('✅ Fixed: ' + file + ' — ' + oldStr.trim().substring(0, 50));
});

if (skipped.length > 0) {
  console.log('\n⚠️  Skipped (need manual fix):');
  skipped.forEach(s => console.log('  ' + s));
}
console.log('\nTotal fixed: ' + totalFixed);

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
