/**
 * Fix garbled encoding across all component files.
 * Run: node fix-encoding.js
 */
const fs = require('fs');
const path = require('path');

const componentsDir = path.join('C:', 'Users', 'dprit', 'Raw-Surf', 'frontend', 'src', 'components');

function getAllJsFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllJsFiles(fullPath));
    } else if (entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Common garbled patterns and their replacements
const replacements = [
  // Garbled middle dot (·) - various encoding levels
  [/\u00c3\u0192\u00c2\u00a2\u00c3\u201a\u00c2\u00b7/g, '\u00B7'],
  [/\u00c3\u00a2\u0080\u00a2/g, '\u00B7'],
  // Garbled arrow (→) patterns in comments
  [/\u00c3\u00af\u00c2\u00bf\u00c2\u00bd/g, '-'],
  // Generic: any sequence of Ã followed by mangled text that looks like garbled encoding
  // Target: comments only (lines starting with // or containing {/* ... */})
];

let totalFixed = 0;
const files = getAllJsFiles(componentsDir);

for (const filePath of files) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const original = content;

  // Fix garbled characters in comments - replace known garbled sequences
  // Pattern: lines containing Ã characters (indicator of double/triple encoding)
  const lines = content.split('\n');
  let fileModified = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Only fix lines that are comments or contain garbled text in string literals
    if (line.includes('\u00C3')) {
      let fixed = line;
      
      // Fix garbled separators in .join() calls: replace garbled dot with Unicode middot
      fixed = fixed.replace(/\.join\('[^']*\u00C3[^']*'\)/g, (match) => {
        return ".join(' \\u00B7 ')";
      });
      
      // Fix garbled text in comments (// or {/* ... */})
      if (fixed.match(/^\s*(\/\/|{\s*\/\*|\*)/)) {
        // Replace garbled sequences in comment lines with clean ASCII
        fixed = fixed.replace(/\u00C3[\u0080-\u00FF\u0100-\u024F]+/g, '-');
      }
      
      // Fix garbled text inside JSX comments {/* ... */}
      fixed = fixed.replace(/\{\/\*[^*]*\u00C3[^*]*\*\/\}/g, (match) => {
        return match.replace(/\u00C3[\u0080-\u00FF\u0100-\u024F]+/g, '-');
      });
      
      // Fix garbled emoji in <span> text content
      fixed = fixed.replace(/<span[^>]*>\u00C3[^<]*<\/span>/g, (match) => {
        return match.replace(/\u00C3[\u0080-\u00FF\u0100-\u024F]{3,}/g, '\u00B7');
      });
      
      if (fixed !== line) {
        lines[i] = fixed;
        fileModified = true;
      }
    }
  }

  if (fileModified) {
    content = lines.join('\n');
    fs.writeFileSync(filePath, content, 'utf-8');
    const name = path.relative(componentsDir, filePath);
    console.log(`Fixed: ${name}`);
    totalFixed++;
  }
}

console.log(`\nTotal files fixed: ${totalFixed}`);
