/**
 * stallLedger — a measured stall must not be retried away (2026-09-26).
 *
 * CI runs Playwright with `retries: 2`. That is right for INFRASTRUCTURE flakes (a cold map load,
 * a 65 s map-ready wait, a slow runner), and wrong for the defect the continuity gate measures: after
 * #78 the Chrome burst at Sebastian Inlet z12 stopped drawing for 22,058 ms and then 30,415 ms, passed
 * on the third attempt, and the run reported success as "1 flaky". A stall is an observation of the
 * app, not of the runner; a later clean attempt does not undo it.
 *
 * So each attempt that measures an over-budget stall records it here, and every later attempt of the
 * same test in the same run fails if one was recorded. Attempts that die BEFORE sampling (the
 * infrastructure class) never write, so retries still rescue those.
 *
 * Retries run in a fresh worker process, so the ledger lives on disk under the project's outputDir
 * (shared across retries), scoped to one CI run by GITHUB_RUN_ID + GITHUB_RUN_ATTEMPT so a stale file
 * can never fail a new run.
 */
const fs = require('fs');
const path = require('path');

function runKey(env = process.env) {
  return `${env.GITHUB_RUN_ID || 'local'}-${env.GITHUB_RUN_ATTEMPT || '0'}`;
}

function ledgerFile(dir, parts) {
  const slug = parts.join(' ').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 150);
  return path.join(dir, 'continuity-stalls', `${slug}.json`);
}

function readEarlierStalls(file, key) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return d && d.runKey === key && Array.isArray(d.stalls) ? d.stalls : [];
  } catch (e) {
    return [];
  }
}

function recordStall(file, key, stall) {
  const stalls = [...readEarlierStalls(file, key), stall];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ runKey: key, stalls }, null, 2));
  return stalls;
}

module.exports = { runKey, ledgerFile, readEarlierStalls, recordStall };
