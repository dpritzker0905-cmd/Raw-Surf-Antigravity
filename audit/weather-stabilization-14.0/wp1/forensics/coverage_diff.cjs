const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../../..');
const coverage = JSON.parse(fs.readFileSync(path.join(__dirname, 'coverage/coverage-final.json'), 'utf8'));
const result = { baselineRevision: '91b90ae9', note: 'Istanbul statement start lines intersecting changed lines; not branch coverage.', files: [] };
for (const [file, data] of Object.entries(coverage)) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const changed = new Set();
  if (relative.endsWith('/marineTimelineCoverage.js')) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((_, i) => changed.add(i + 1));
  } else {
    const diff = execFileSync('git', ['diff', '91b90ae9', '--unified=0', '--', relative], { cwd: root, encoding: 'utf8' });
    for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
      const start = Number(match[1]), count = match[2] === undefined ? 1 : Number(match[2]);
      for (let line = start; line < start + count; line++) changed.add(line);
    }
  }
  const lines = new Map();
  for (const [id, span] of Object.entries(data.statementMap)) {
    if (changed.has(span.start.line)) lines.set(span.start.line, (lines.get(span.start.line) || 0) + data.s[id]);
  }
  const executable = [...lines.keys()].sort((a, b) => a - b);
  const uncovered = executable.filter(line => !lines.get(line));
  result.files.push({ file: relative, changedStatementLines: executable.length, covered: executable.length - uncovered.length,
    uncovered, executable });
}
result.total = result.files.reduce((total, file) => total + file.changedStatementLines, 0);
result.covered = result.files.reduce((total, file) => total + file.covered, 0);
fs.writeFileSync(path.join(__dirname, 'changed-line-coverage.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.covered !== result.total) process.exitCode = 1;
