// HTML reports are written at the end; retain completed attempts if CI kills the process.
const fs = require('node:fs');
const path = require('node:path');

class ProgressReporter {
  onBegin() {
    this.file = path.resolve('e2e-metadata', 'completed-attempts.jsonl');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, '');
  }
  onTestEnd(test, result) {
    const projects = ['Mobile Safari', 'Desktop Chrome', 'Desktop Firefox', 'Desktop Safari'];
    const project = test.parent.project()?.name;
    const statuses = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];
    fs.appendFileSync(this.file, JSON.stringify({
      file: path.basename(test.location.file), line: test.location.line,
      project: projects.includes(project) ? project : 'other',
      status: statuses.includes(result.status) ? result.status : 'other',
      retry: result.retry, durationMs: result.duration,
    }) + '\n');
  }
}

module.exports = ProgressReporter;
