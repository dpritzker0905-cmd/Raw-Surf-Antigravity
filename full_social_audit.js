/**
 * full_social_audit.js — Comprehensive social flow bug finder
 * Run: node full_social_audit.js
 */
const fs = require('fs');
const path = require('path');

const BACKEND = 'backend';
const FRONTEND_SRC = 'frontend/src';
const COMPONENTS = path.join(FRONTEND_SRC, 'components');
const ROUTES = path.join(BACKEND, 'routes');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function readFile(f) {
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
}

function findLines(content, testFn) {
  return content.split('\n').map((l, i) => ({ ln: i + 1, line: l })).filter(({ line }) => testFn(line));
}

function walkDir(dir, ext = ['.js', '.jsx', '.py']) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  fs.readdirSync(dir).forEach(f => {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory() && !f.includes('__pycache__') && f !== 'node_modules') {
      results.push(...walkDir(full, ext));
    } else if (ext.some(e => f.endsWith(e))) {
      results.push(full);
    }
  });
  return results;
}

// ─── 1. CRITICAL: netlify.toml missing BACKEND_URL env var ────────────────────
console.log('\n============================================================');
console.log('1. DEPLOY CONFIG — REACT_APP_BACKEND_URL');
console.log('============================================================');
const netlify = readFile('netlify.toml');
if (netlify.includes('REACT_APP_BACKEND_URL')) {
  console.log('  ✅ REACT_APP_BACKEND_URL found in netlify.toml');
} else {
  console.log('  ❌ MISSING: REACT_APP_BACKEND_URL not in netlify.toml [build.environment]');
  console.log('     → getFullUrl() returns bare relative path /api/... → Netlify 404');
  console.log('     FIX: Add REACT_APP_BACKEND_URL = "https://raw-surf-antigravity.onrender.com"');
}

// ─── 2. RAW MEDIA SRCS without getFullUrl ────────────────────────────────────
console.log('\n============================================================');
console.log('2. RAW MEDIA SRCS (missing getFullUrl wrapper)');
console.log('============================================================');
const rawMediaPattern = /src=\{[a-zA-Z_][a-zA-Z_.]*\.(avatar_url|media_url|thumbnail_url|image_url|photo_url|cover_url|preview_url)\}/;
const allJsFiles = walkDir(COMPONENTS).filter(f => f.endsWith('.js') || f.endsWith('.jsx'));
let rawSrcCount = 0;
allJsFiles.forEach(f => {
  const c = readFile(f);
  const hits = findLines(c, l => rawMediaPattern.test(l) && !l.includes('getFullUrl'));
  hits.forEach(({ ln, line }) => {
    const rel = f.replace(COMPONENTS + path.sep, '');
    console.log(`  ${rel}:L${ln}: ${line.trim().substring(0, 85)}`);
    rawSrcCount++;
  });
});
console.log(`  Total: ${rawSrcCount} raw media srcs without getFullUrl`);

// ─── 3. BACKEND posts.py — media_url stored correctly? ───────────────────────
console.log('\n============================================================');
console.log('3. BACKEND: media_url storage pattern');
console.log('============================================================');
const postsPy = readFile(path.join(ROUTES, 'posts.py'));
const postsLines = findLines(postsPy, l => /media_url.*=|\.media_url\s*=/.test(l));
postsLines.slice(0, 10).forEach(({ ln, line }) => {
  console.log(`  posts.py:L${ln}: ${line.trim().substring(0, 80)}`);
});

// ─── 4. BACKEND — video posts handling ────────────────────────────────────────
console.log('\n============================================================');
console.log('4. VIDEO POSTS — backend route check');
console.log('============================================================');
const videoLines = findLines(postsPy, l => /video|mp4|media_type.*video/.test(l));
videoLines.slice(0, 15).forEach(({ ln, line }) => {
  console.log(`  posts.py:L${ln}: ${line.trim().substring(0, 80)}`);
});

// ─── 5. FEED — video rendering ────────────────────────────────────────────────
console.log('\n============================================================');
console.log('5. FEED — video post rendering');
console.log('============================================================');
const feedJs = readFile(path.join(COMPONENTS, 'Feed.js'));
const feedVideoLines = findLines(feedJs, l => /<video|media_type.*video|video.*media_type/.test(l));
feedVideoLines.slice(0, 10).forEach(({ ln, line }) => {
  console.log(`  Feed.js:L${ln}: ${line.trim().substring(0, 80)}`);
});

// ─── 6. BACKEND — feed route for videos ──────────────────────────────────────  
console.log('\n============================================================');
console.log('6. BACKEND feed route for video posts');
console.log('============================================================');
const feedBackend = readFile(path.join(ROUTES, 'posts.py'));
const feedRoutes = findLines(feedBackend, l => /router.*get.*feed|router.*post.*feed|def.*feed/.test(l));
feedRoutes.slice(0, 10).forEach(({ ln, line }) => {
  console.log(`  posts.py:L${ln}: ${line.trim().substring(0, 80)}`);
});

// ─── 7. PostCard — video player rendering ────────────────────────────────────
console.log('\n============================================================');
console.log('7. PostCard — video player');
console.log('============================================================');
const postCardJs = readFile(path.join(COMPONENTS, 'PostCard.js'));
const videoRenderLines = findLines(postCardJs, l => /<video|getVideoPoster|media_type.*video|video.*src/.test(l));
videoRenderLines.slice(0, 10).forEach(({ ln, line }) => {
  console.log(`  PostCard.js:L${ln}: ${line.trim().substring(0, 85)}`);
});

// ─── 8. STORIES feature ───────────────────────────────────────────────────────
console.log('\n============================================================');
console.log('8. STORIES — backend + frontend check');
console.log('============================================================');
const storiesPy = readFile(path.join(ROUTES, 'stories.py'));
const storiesJs = readFile(path.join(COMPONENTS, 'Stories.js'));
const storiesBackend = readFile(path.join(ROUTES, 'stories.py'));

const storyRoutes = findLines(storiesPy, l => /@router/.test(l));
console.log(`  Backend: ${storyRoutes.length} story routes`);
storyRoutes.forEach(({ ln, line }) => console.log(`    L${ln}: ${line.trim().substring(0, 70)}`));

if (!storiesJs && !readFile(path.join(COMPONENTS, 'Stories.js'))) {
  console.log('  ❌ Stories.js MISSING');
} else {
  const storyApiCalls = findLines(storiesJs, l => /apiClient\.|fetch\(/.test(l));
  console.log(`  Frontend Stories.js: ${storyApiCalls.length} API calls`);
}

// ─── 9. LIKES / REACTIONS system ──────────────────────────────────────────────
console.log('\n============================================================');
console.log('9. LIKES & REACTIONS — backend routes');
console.log('============================================================');
const reactionRoutes = findLines(postsPy, l => /@router.*reaction|@router.*like/.test(l));
reactionRoutes.forEach(({ ln, line }) => console.log(`  posts.py:L${ln}: ${line.trim().substring(0, 80)}`));

// ─── 10. COMMENTS system ─────────────────────────────────────────────────────
console.log('\n============================================================');
console.log('10. COMMENTS — backend routes');
console.log('============================================================');
const commentRoutes = findLines(postsPy, l => /@router.*comment/.test(l));
commentRoutes.forEach(({ ln, line }) => console.log(`  posts.py:L${ln}: ${line.trim().substring(0, 80)}`));

// ─── 11. FOLLOW system ────────────────────────────────────────────────────────
console.log('\n============================================================');
console.log('11. FOLLOW SYSTEM — backend');
console.log('============================================================');
const followFiles = walkDir(ROUTES).filter(f => f.includes('follow'));
console.log(`  Follow backend files: ${followFiles.map(f => path.basename(f)).join(', ')}`);
followFiles.forEach(f => {
  const routes = findLines(readFile(f), l => /@router/.test(l));
  routes.forEach(({ ln, line }) => console.log(`    ${path.basename(f)}:L${ln}: ${line.trim().substring(0, 70)}`));
});

// ─── 12. NOTIFICATIONS ────────────────────────────────────────────────────────
console.log('\n============================================================');
console.log('12. NOTIFICATIONS — push + in-app');
console.log('============================================================');
const notifFiles = walkDir(ROUTES).filter(f => f.includes('notif') || f.includes('push') || f.includes('onesignal'));
console.log(`  Notification backend files: ${notifFiles.map(f => path.basename(f)).join(', ')}`);
const notifServiceJs = readFile(path.join(FRONTEND_SRC, 'services/notificationService.js'));
if (notifServiceJs) {
  console.log('  ✅ notificationService.js exists');
  const notifFns = findLines(notifServiceJs, l => /^export (const|async function|function)/.test(l));
  notifFns.forEach(({ ln, line }) => console.log(`    L${ln}: ${line.trim().substring(0, 70)}`));
} else {
  console.log('  ❌ notificationService.js MISSING');
}

// ─── 13. SEARCH ───────────────────────────────────────────────────────────────
console.log('\n============================================================');
console.log('13. SEARCH — backend');
console.log('============================================================');
const searchPy = readFile(path.join(ROUTES, 'search.py'));
const searchRoutes = findLines(searchPy, l => /@router/.test(l));
searchRoutes.forEach(({ ln, line }) => console.log(`  search.py:L${ln}: ${line.trim().substring(0, 70)}`));

// ─── 14. MISSING SOCIAL FEATURES vs Instagram/TikTok baseline ────────────────
console.log('\n============================================================');
console.log('14. SOCIAL FEATURE BASELINE AUDIT');
console.log('============================================================');

const features = [
  ['Stories (24h posts)', 'stories.py', 'Stories.js'],
  ['Live streaming', 'social_live.py', 'LiveStreamViewer.js'],
  ['DMs / Messaging', 'messages.py', 'MessagesPage.js'],
  ['Feed / Timeline', 'posts.py', 'Feed.js'],
  ['Explore / Discover', 'explore.py', 'Explore.js'],  
  ['User Search', 'search.py', 'SearchOverlay.js'],
  ['Follow / Unfollow', 'follow.py', 'Profile.js'],
  ['Post Likes', 'posts.py', 'PostCard.js'],
  ['Post Comments', 'posts.py', 'PostCard.js'],
  ['Post Share', 'posts.py', 'PostMenu.js'],
  ['Post Save/Bookmark', 'posts.py', 'Feed.js'],
  ['Notifications', 'notifications.py', 'NotificationsPage.js'],
  ['Profile Grid', 'profile_content.py', 'Profile.js'],
  ['Reels/Videos', 'posts.py', 'PostCard.js'],
  ['Hashtags', null, 'RichText.js'],
  ['@Mentions', null, 'RichText.js'],
  ['Post Reactions (Shaka)', 'posts.py', 'PostCard.js'],
];

features.forEach(([name, backendFile, frontendFile]) => {
  const beExists = backendFile ? walkDir(ROUTES).some(f => f.endsWith(backendFile)) : true;
  const feExists = frontendFile ? walkDir(COMPONENTS).some(f => f.endsWith(frontendFile)) : true;
  const status = beExists && feExists ? '✅' : '❌';
  const missing = [!beExists ? `backend/${backendFile} MISSING` : null, !feExists ? `${frontendFile} MISSING` : null].filter(Boolean).join(', ');
  console.log(`  ${status} ${name}${missing ? ' — ' + missing : ''}`);
});

// ─── 15. Backend routes/__init__.py registration ──────────────────────────────
console.log('\n============================================================');
console.log('15. ROUTE REGISTRATION — all backends registered?');
console.log('============================================================');
const routesInit = readFile(path.join(BACKEND, 'routes', '__init__.py'));
if (!routesInit) {
  const mainPy = readFile(path.join(BACKEND, 'main.py'));
  const routerIncludes = findLines(mainPy, l => /include_router|app\.include/.test(l));
  console.log('  Registered routers in main.py:');
  routerIncludes.forEach(({ ln, line }) => console.log(`    L${ln}: ${line.trim().substring(0, 80)}`));
} else {
  console.log('  routes/__init__.py exists');
}

console.log('\n============================================================');
console.log('AUDIT COMPLETE');
console.log('============================================================\n');
