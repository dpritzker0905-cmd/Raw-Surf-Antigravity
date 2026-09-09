const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('../../frontend/node_modules/@playwright/test');
const { attachNetworkEvidence } = require('../../frontend/scripts/zoomlab-network-evidence');
const { analyzeTrace } = require('../../frontend/scripts/zoomlab-verdict');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const capture = attachNetworkEvidence(page);
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    let fail = false;
    await page.route('**/*', route => fail ? route.abort('namenotresolved') : route.fulfill({
      status: 200, headers: { 'access-control-allow-origin': '*' }, body: 'controlled-response',
    }));
    const target = 'https://forensic.invalid/private-station?token=DO_NOT_RETAIN#private';
    const fetchResult = () => page.evaluate(async url => {
      try { return await (await fetch(url)).text(); } catch (_) { return 'FAILED'; }
    }, target);
    assert.equal(await fetchResult(), 'controlled-response');
    assert.equal(capture().requests.length, 0);
    fail = true;
    assert.equal(await fetchResult(), 'FAILED');
    assert.deepEqual(capture(), { requests: [{ origin: 'https://forensic.invalid',
      resourceType: 'fetch', errorCode: 'net::ERR_NAME_NOT_RESOLVED' }], dropped: 0 });
    assert(!JSON.stringify(capture()).includes('DO_NOT_RETAIN'));
    assert(!JSON.stringify(capture()).includes('private'));
    const trace = JSON.parse(fs.readFileSync(__dirname + '/marine-postmerge-artifact/trace_staircase_full.json'));
    const opts = { expectedScenario: 'staircase_full' };
    const clean = analyzeTrace({ ...trace, consoleErrors: [] }, opts);
    const dns = analyzeTrace({ ...trace, consoleErrors: errors }, opts);
    const hard = analyzeTrace({ ...trace, consoleErrors: [...errors, 'TypeError: injected renderer fault'] }, opts);
    assert.equal(clean.verdict, 'PASS');
    assert.equal(dns.verdict, 'REFUSE');
    assert.equal(hard.verdict, 'FAIL');
    const result = { kind: 'Controlled browser fault injection, not production health',
      browser: browser.version(), retained: capture(),
      same_recorded_frames: trace.frames.length,
      clean: clean.verdict, injected_dns: dns.verdict, injected_renderer_fault: hard.verdict,
      secret_url_parts_absent: true };
    fs.writeFileSync(__dirname + '/independent-browser-result.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
