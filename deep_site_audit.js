/**
 * deep_site_audit.js - Comprehensive site feature audit
 */
const fs = require('fs');
const path = require('path');

function walkDir(dir, ext) {
  const r = [];
  if (!fs.existsSync(dir)) return r;
  fs.readdirSync(dir).forEach(function(f) {
    var full = path.join(dir, f);
    if (fs.statSync(full).isDirectory() && !['node_modules','__pycache__','build','.git','_deprecated'].includes(f)) {
      r.push.apply(r, walkDir(full, ext));
    } else if (ext.some(function(e) { return f.endsWith(e); })) {
      r.push(full);
    }
  });
  return r;
}

var frontendFiles = walkDir('frontend/src', ['.js', '.jsx']);
var backendFiles = walkDir('backend/routes', ['.py']);

// 1. Frontend routes
var appJs = fs.readFileSync('frontend/src/App.js', 'utf8');
var routeMatches = appJs.match(/path="([^"]+)"/g) || [];
var routes = routeMatches.map(function(m) { return m.replace(/path="|"/g, ''); }).filter(function(r) { return r !== '*'; });

console.log('=== FRONTEND ROUTES (' + routes.length + ') ===');
routes.forEach(function(r) { console.log('  ' + r); });

// 2. Backend route files
console.log('\n=== BACKEND ROUTE FILES (' + backendFiles.length + ') ===');
backendFiles.forEach(function(f) { console.log('  ' + f.replace('backend\\routes\\', '').replace('backend/routes/', '')); });

// 3. API endpoint counts from backend
var totalEndpoints = 0;
backendFiles.forEach(function(f) {
  var c = fs.readFileSync(f, 'utf8');
  var matches = c.match(/@router\.(get|post|put|patch|delete)/g) || [];
  totalEndpoints += matches.length;
});
console.log('\n=== BACKEND ENDPOINTS: ' + totalEndpoints + ' total ===');

// 4. Mock data usage
console.log('\n=== MOCK DATA USAGE ===');
frontendFiles.forEach(function(f) {
  var c = fs.readFileSync(f, 'utf8');
  var lines = c.split('\n');
  lines.forEach(function(l, i) {
    if (/mock\s*data|Use mock data|mockData/i.test(l) && !/\/\/.*mock/i.test(l.substring(0, l.indexOf('mock')))) {
      console.log('  ' + f.replace('frontend/src/components/', '') + ':L' + (i+1) + ': ' + l.trim().substring(0, 70));
    }
  });
});

// 5. TODO/FIXME/BROKEN
console.log('\n=== TODO / FIXME / BROKEN ===');
var todoCount = 0;
frontendFiles.forEach(function(f) {
  var c = fs.readFileSync(f, 'utf8');
  var lines = c.split('\n');
  lines.forEach(function(l, i) {
    if (/\bTODO\b|\bFIXME\b|\bBROKEN\b|\bHACK\b/.test(l)) {
      console.log('  ' + f.replace('frontend/src/components/', '') + ':L' + (i+1) + ': ' + l.trim().substring(0, 80));
      todoCount++;
    }
  });
});
console.log('  Total: ' + todoCount);

// 6. Coming soon / not implemented
console.log('\n=== COMING SOON / NOT IMPLEMENTED ===');
frontendFiles.forEach(function(f) {
  var c = fs.readFileSync(f, 'utf8');
  var lines = c.split('\n');
  lines.forEach(function(l, i) {
    if (/coming soon|not yet implemented|under construction/i.test(l)) {
      console.log('  ' + f.replace('frontend/src/components/', '') + ':L' + (i+1) + ': ' + l.trim().substring(0, 80));
    }
  });
});

// 7. Feature coverage - what key features do we have
console.log('\n=== KEY FEATURE FILE CHECK ===');
var features = [
  { name: 'Social Feed', files: ['Feed.js', 'PostCard.js', 'PostMenu.js'] },
  { name: 'Stories', files: ['Stories.js'] },
  { name: 'Messaging/DMs', files: ['MessagesPage.js', 'messages/'] },
  { name: 'Notifications', files: ['NotificationsPage.js'] },
  { name: 'User Profile', files: ['Profile.js'] },
  { name: 'Explore', files: ['Explore.js'] },
  { name: 'Live Streaming', files: ['LiveStreamViewer.js', 'GoLiveModal.js'] },
  { name: 'Search', files: ['GlobalSearchBar.js'] },
  { name: 'Request a Pro (On-Demand)', files: ['OnDemandRequestDrawer.js', 'map/RequestProModal.js'] },
  { name: 'Scheduled Booking', files: ['ScheduledBookingDrawer.js'] },
  { name: 'Crew / Split Payment', files: ['CrewHub.js', 'CrewPaymentDashboard.js', 'CrewPaymentModal.js'] },
  { name: 'Photographer Gallery', files: ['PublicPhotographerGallery.js', 'PhotographerGalleryManager.js'] },
  { name: 'Surfer Gallery', files: ['SurferGallery.js'] },
  { name: 'Spot Hub', files: ['SpotHub.js'] },
  { name: 'Gear Hub', files: ['GearHub.js'] },
  { name: 'Surf Alerts', files: ['SurfAlerts.js'] },
  { name: 'Leaderboards', files: ['XPLeaderboard.js', 'CrewLeaderboard.js'] },
  { name: 'Impact Zone (Contests)', files: ['ImpactZoneHub.js', 'ImpactDashboard.js'] },
  { name: 'Grom HQ (Parental Controls)', files: ['GromHQ.js', 'GromLimitedFeed.js', 'GromSafetyGate.js'] },
  { name: 'Admin Console', files: ['UnifiedAdminConsole.js', 'admin/'] },
  { name: 'Stripe Payments', files: ['StripePayment.js', 'stripe/'] },
  { name: 'Map View', files: ['map/MapPage.js', 'map/MapFilterTabs.js'] },
  { name: 'Settings', files: ['Settings.js', 'settings/'] },
  { name: 'Stoke Sponsor', files: ['StokeSponsorDashboard.js'] },
  { name: 'Authentication', files: ['AuthPage.js', 'AuthContext.js'] },
  { name: 'PWA / App Install', files: ['pwa/', 'install'] },
  { name: 'Push Notifications', files: ['notifications/'] },
  { name: 'Watermark Tool', files: ['WatermarkSettings.js'] },
  { name: 'Photographer Directory', files: ['PhotographerDirectory.js'] },
  { name: 'AI Matches', files: ['AIProposedMatches.js'] },
  { name: 'XP / Gamification', files: ['XPLeaderboard.js', 'ThePeakHub.js', 'TheInsideHub.js'] }
];

features.forEach(function(feat) {
  var found = feat.files.some(function(filename) {
    return frontendFiles.some(function(f) { return f.includes(filename); });
  });
  console.log('  ' + (found ? '✅' : '❌') + ' ' + feat.name + ' - ' + feat.files[0]);
});

// 8. Backend feature coverage
console.log('\n=== BACKEND FEATURE CHECK ===');
var backendFeatures = [
  { name: 'Posts/Feed', files: ['posts.py', 'social.py'] },
  { name: 'Stories', files: ['stories.py'] },
  { name: 'Messaging', files: ['messages.py'] },
  { name: 'Notifications', files: ['notifications.py'] },
  { name: 'Bookings/Dispatch', files: ['dispatch.py', 'bookings/'] },
  { name: 'Payments/Stripe', files: ['payments.py', 'stripe'] },
  { name: 'Users/Auth', files: ['users.py', 'auth.py'] },
  { name: 'Spots', files: ['spots.py'] },
  { name: 'Gallery', files: ['gallery.py'] },
  { name: 'Analytics/Admin', files: ['admin.py'] },
  { name: 'Live Streaming', files: ['livekit.py', 'social_live.py'] },
  { name: 'Surf Alerts', files: ['surf_alerts.py'] },
  { name: 'Leaderboard/XP', files: ['leaderboard.py', 'xp.py'] },
  { name: 'Contests/Impact', files: ['contests.py', 'impact'] },
  { name: 'Grom/Parental', files: ['grom.py', 'parental'] },
  { name: 'Crew/Split', files: ['crew.py', 'split'] },
  { name: 'Gear', files: ['gear.py'] },
];

backendFeatures.forEach(function(feat) {
  var found = feat.files.some(function(filename) {
    return backendFiles.some(function(f) { return f.toLowerCase().includes(filename.toLowerCase()); });
  });
  console.log('  ' + (found ? '✅' : '❌') + ' ' + feat.name + ' - ' + feat.files[0]);
});
