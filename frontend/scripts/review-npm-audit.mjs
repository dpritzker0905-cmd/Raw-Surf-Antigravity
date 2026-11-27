import { readFileSync } from 'node:fs';

const severityRank = { high: 1, critical: 2 };

function advisories(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  if (report.error || report.auditReportVersion !== 2 || !report.metadata?.vulnerabilities ||
      !report.vulnerabilities || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)) {
    throw new Error('npm did not return a complete advisory report');
  }
  const found = new Map();
  for (const entry of Object.values(report.vulnerabilities)) {
    for (const advisory of entry.via) {
      // String entries inherit findings already listed on the underlying package.
      if (typeof advisory === 'string' || !severityRank[advisory.severity]) continue;
      if (!advisory.url || !advisory.name) throw new Error('npm returned an incomplete advisory');
      const key = advisory.name + ' ' + advisory.url;
      if ((found.get(key) ?? 0) < severityRank[advisory.severity]) {
        found.set(key, severityRank[advisory.severity]);
      }
    }
  }
  return found;
}

const base = advisories(process.argv[2]);
const proposed = advisories(process.argv[3]);
let regressions = 0;
for (const [key, rank] of proposed) {
  if (rank <= (base.get(key) ?? 0)) continue;
  regressions++;
  console.log(rank === 2 ? 'critical' : 'high', key);
}
console.log(`High/critical package-advisory pairs: ${base.size} before, ${proposed.size} after, ${regressions} new or escalated.`);
if (regressions) process.exitCode = 1;
