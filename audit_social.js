const fs = require('fs');
const path = require('path');

const socialFiles = [
  'frontend/src/components/PostCard.js',
  'frontend/src/components/PostModal.js',
  'frontend/src/components/SinglePost.js',
  'frontend/src/components/Profile.js',
  'frontend/src/components/Feed.js',
];

console.log('=== RAW AVATAR SRCS (no getFullUrl) ===');
socialFiles.forEach(f => {
  if (!fs.existsSync(f)) return;
  const c = fs.readFileSync(f, 'utf8');
  const lines = c.split('\n');
  lines.forEach((l, i) => {
    if (/src=\{[^)]*avatar[^)]*\}/.test(l) && !l.includes('getFullUrl')) {
      console.log('  ' + path.basename(f) + ' L' + (i+1) + ': ' + l.trim().substring(0, 80));
    }
  });
});

// Profile.js API var
const prC = fs.readFileSync('frontend/src/components/Profile.js', 'utf8');
const hasAPIVar = prC.includes('apiClient.get(`${API}${');
const hasAPIDef = prC.includes('const API ') || prC.includes('let API ');
console.log('\nProfile.js API var bug: ' + (hasAPIVar && !hasAPIDef ? 'YES - CONFIRMED BUG' : 'No'));

// Check PostCard L738
const pcC = fs.readFileSync('frontend/src/components/PostCard.js', 'utf8');
const pcLines = pcC.split('\n');
const target = pcLines.find(l => l.includes('src={post.author_avatar}'));
console.log('PostCard raw author_avatar: ' + (target ? 'FOUND - MISSING getFullUrl' : 'Not found'));

// Check for any raw media_url without getFullUrl in PostCard 
const pcRawMedia = pcLines.filter(l => /src=\{post\.(media_url|thumbnail_url|image_url)\}/.test(l));
console.log('PostCard raw media_url (no getFullUrl): ' + pcRawMedia.length + ' instances');
pcRawMedia.forEach(l => console.log('  ' + l.trim().substring(0, 80)));

// Check Feed.js for how posts are passed to PostCard
const feedC = fs.readFileSync('frontend/src/components/Feed.js', 'utf8');
const feedLines = feedC.split('\n');
const postCardUsage = feedLines.filter((l, i) => l.includes('<PostCard'));
console.log('\nFeed.js PostCard renders: ' + postCardUsage.length);
postCardUsage.forEach(l => console.log('  ' + l.trim().substring(0, 80)));

// Check backend posts.py for what author_avatar field contains
const postsBackend = fs.readFileSync('backend/routes/posts.py', 'utf8');
const postsLines = postsBackend.split('\n');
const authorAvatarLine = postsLines.find(l => l.includes('author_avatar='));
console.log('\nBackend posts.py author_avatar: ' + (authorAvatarLine ? authorAvatarLine.trim() : 'NOT FOUND'));

// Find what the backend feed route sends
console.log('\n=== Backend feed route ===');
const feedBackend = postsLines.filter(l => /author_avatar|media_url/.test(l)).slice(0, 10);
feedBackend.forEach(l => console.log('  ' + l.trim().substring(0, 80)));
