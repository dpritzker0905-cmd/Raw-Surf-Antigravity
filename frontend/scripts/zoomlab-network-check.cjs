/** Exercise the recorder with real Chromium events and a loopback server; no live app data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('@playwright/test');
const { runWithNetworkEvidence } = require('./zoomlab-network-evidence');
const { analyzeTrace } = require('./zoomlab-verdict');
const out = process.argv[2];
if (!out) throw new Error('Usage: node zoomlab-network-check.cjs <evidence-directory>');
fs.mkdirSync(out, { recursive: true });

async function main() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://loopback').pathname;
    if (pathname === '/held') return; // Intentionally incomplete until context teardown.
    if (pathname === '/api/weather/grid') { res.writeHead(503); res.end('controlled unavailable'); return; }
    if (pathname.startsWith('/api/explore/spot-details/')) {
      setTimeout(() => { res.writeHead(200); res.end('controlled slow success'); }, 250); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Request evidence control</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const base = `http://127.0.0.1:${server.address().port}`;
  const captures = [];
  try {
    browser = await chromium.launch({ headless: true, channel: process.env.ZL_CHECK_CHANNEL || undefined,
      args: ['--no-proxy-server', '--host-resolver-rules=MAP weather-evidence.invalid ~NOTFOUND'] });
    for (const earlyFailure of [false, true]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      let threw = false;
      try {
        await runWithNetworkEvidence(page, {
          recorderOptions: { slowMs: 100 },
          run: async () => {
            if (earlyFailure) {
              await page.goto('http://weather-evidence.invalid/private-id?token=secret', { timeout: 10000 });
              throw new Error('Expected navigation DNS failure was not delivered');
            }
            await page.goto(base);
            const slowFinished = page.waitForEvent('requestfinished', {
              predicate: r => new URL(r.url()).pathname.startsWith('/api/explore/spot-details/'), timeout: 10000,
            });
            await page.evaluate(async () => {
              await Promise.allSettled([
                fetch('http://weather-evidence.invalid/private-id?token=secret'),
                fetch('/api/weather/grid?token=secret').then(r => r.text()),
                fetch('/api/explore/spot-details/private-id?token=secret').then(r => r.text()),
              ]);
            });
            await slowFinished; // fetch() alone resolves at headers, before requestfinished.
            const started = page.waitForRequest(r => new URL(r.url()).pathname === '/held');
            await page.evaluate(() => { window.heldRequest = fetch('/held?token=secret').catch(() => {}); });
            await started;
          },
          close: () => context.close(),
          save: evidence => {
            captures.push(evidence);
            fs.writeFileSync(path.join(out, `capture-${earlyFailure ? 'early-failure' : 'completed'}.json`), JSON.stringify(evidence, null, 2));
          },
        });
      } catch (error) {
        if (!earlyFailure) throw error;
        threw = true;
      }
      assert.equal(threw, earlyFailure);
      const evidence = captures.at(-1);
      assert.equal(evidence.completion.scenarioCompleted, !earlyFailure);
      assert.equal(evidence.completion.contextClosed, true);
      assert.equal(evidence.dropped + evidence.trackingDropped, 0);
      const dns = evidence.requests.find(r => r.errorCode === 'net::ERR_NAME_NOT_RESOLVED');
      assert.ok(dns, 'Actual Chromium DNS event is required');
      assert.equal(dns.origin, 'http://weather-evidence.invalid');
      assert.equal(dns.status, null);
      assert.ok(dns.durationMs >= 0 && dns.startedAtUTC);
      assert.equal(dns.startedPhase, 'capture');
      assert.equal(dns.finishedPhase, 'capture');
      assert.doesNotMatch(JSON.stringify(evidence), /private-id|token=|secret/);
      if (!earlyFailure) {
        assert.ok(evidence.requests.some(r => r.route === 'weather-grid' && r.status === 503 && r.outcome === 'http-error'));
        assert.ok(evidence.requests.some(r => r.route === 'spot-details' && r.status === 200 && r.durationMs >= 200));
        assert.ok([...evidence.requests, ...evidence.pending].some(r => r.finishedPhase === 'teardown'), 'Teardown or incomplete request must remain visible');
      }
    }
    const frames = [0, 100].map(t => ({ t, anim: new Array(40).fill(8) }));
    const verdicts = [];
    for (const consoleErrors of [[], ['net::ERR_NAME_NOT_RESOLVED'], ['TypeError: broken render']]) {
      const trace = { frames, consoleErrors, scenario: 'staircase_full', completed: true };
      const before = analyzeTrace(trace), after = analyzeTrace({ ...trace, networkEvidence: captures[0] });
      assert.deepEqual(after, before, 'Adding request evidence must not change the visual verdict');
      verdicts.push(before.verdict);
    }
    assert.deepEqual(verdicts, ['PASS', 'REFUSE', 'FAIL']);
    const proof = { pass: true, browser: browser.version(),
      recorderSha256: createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'zoomlab-network-evidence.js'))).digest('hex'),
      verdicts, captures, limits: 'DNS is forced in Chromium resolver; all other traffic is loopback. Observer timing is not wire timing. Client capture IDs are not backend trace IDs. No live latency or visual acceptance claim.' };
    fs.writeFileSync(path.join(out, 'network-controls.json'), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify({ pass: true, browser: proof.browser, verdicts,
      captures: captures.map(c => ({ completion: c.completion, totals: c.totals, pending: c.pending.length })) }));
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
