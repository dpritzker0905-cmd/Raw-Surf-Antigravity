// Actual React hook; synthetic RTC/media/API/signaling only. All baseline source stays in memory.
const fs = require('fs'); const path = require('path'); const http = require('http'); const assert = require('assert/strict');
const crypto = require('crypto'); const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../../..');
const req = require('module').createRequire(path.join(root, 'frontend/package.json'));
const webpack = req('webpack'); const hookPath = path.join(root, 'frontend/src/hooks/useWebRTCCall.js');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const baseline = process.argv.includes('--baseline');
const baselineRef = process.argv.find(value => value.startsWith('--baseline-ref='))?.slice('--baseline-ref='.length) || 'HEAD';
assert.ok(baselineRef === 'HEAD' || /^[0-9a-f]{7,40}$/.test(baselineRef), 'Baseline must be HEAD or a local commit hash');
const baselineRevision = execFileSync('git', ['rev-parse', baselineRef], { cwd: root, encoding: 'utf8' }).trim();
const baselineSource = baseline ? execFileSync('git', ['show', `${baselineRevision}:frontend/src/hooks/useWebRTCCall.js`], { cwd: root, encoding: 'utf8' }) : null;
const sourceBefore = fs.readFileSync(hookPath); const sourceHash = digest(baselineSource || sourceBefore);
const output = path.resolve(process.argv[2]); fs.mkdirSync(output, { recursive: true });
const checks = []; const errors = []; const external = [];

const begin = (page, action, ...args) => page.evaluate(({ action, args }) => window.__callFixture.begin(action, ...args), { action, args });
const hold = (page, operation) => page.evaluate(operation => window.__callFixture.hold(operation), operation);
const release = (page, operation, errorName = null) => page.evaluate(({ operation, errorName }) => window.__callFixture.release(operation, errorName), { operation, errorName });
const used = (page, operation) => page.waitForFunction(operation => window.__callFixture.gates.some(item => item.operation === operation && item.used), operation);
const settled = (page, count) => page.waitForFunction(count => window.__callFixture.tasks.filter(task => task.settled).length >= count, count);
const state = (page, value) => page.waitForFunction(value => window.__callFixture.api.callState === value, value);
const snapshot = page => page.evaluate(() => window.__callFixture.snapshot());
const end = async page => { await page.evaluate(() => window.__callFixture.api.endCall()); await state(page, 'idle'); };
const startB = async page => { await begin(page, 'startCall', 'fixture-b'); await page.waitForFunction(() => window.__callFixture.signals.some(signal => signal.type === 'call_offer' && signal.target === 'fixture-b')); };
const incoming = async page => {
  await page.evaluate(() => window.__callFixture.incoming({ type: 'call_offer', caller_id: 'fixture-a', caller_name: 'Synthetic incoming caller', sdp: { type: 'offer', sdp: 'synthetic' } }));
  await state(page, 'incoming');
};
const onlyBOffer = value => assert.deepEqual(value.signals.filter(signal => signal.type === 'call_offer').map(signal => signal.target), ['fixture-b']);
const ownsB = value => { assert.equal(value.state, 'outgoing'); assert.equal(value.remote, 'fixture-b'); assert.equal(value.streams.at(-1).stopped, 0); assert.equal(value.peers.at(-1).closed, false); assert.equal(value.answerTimers, 1); };
const noAnswers = value => assert.equal(value.signals.filter(signal => ['call_answer', 'call_accepted_elsewhere'].includes(signal.type)).length, 0);

const cases = [
  ['outbound_cancelled_media_stops_late_stream_without_offer', async page => {
    await hold(page, 'media'); await begin(page, 'startCall', 'fixture-a'); await used(page, 'media'); await end(page);
    await release(page, 'media'); await settled(page, 1); const value = await snapshot(page);
    assert.equal(value.state, 'idle'); assert.deepEqual(value.signals, [], 'Pre-offer cancellation must not send an offer or a call-end signal');
    assert.equal(value.streams[0].stopped, 1); assert.equal(value.peers.length, 0); assert.equal(value.answerTimers, 0);
  }],
  ['old_offer_cannot_emit_or_replace_new_call_timeout', async page => {
    await hold(page, 'offer'); await begin(page, 'startCall', 'fixture-a'); await used(page, 'offer'); await end(page); await startB(page);
    await release(page, 'offer'); await settled(page, 2); const value = await snapshot(page);
    await page.clock.runFor(30000); const afterDeadline = await snapshot(page);
    onlyBOffer(value); ownsB(value); assert.equal(value.streams[0].stopped, 1);
    assert.equal(afterDeadline.state, 'idle'); assert.equal(afterDeadline.signals.filter(s => s.type === 'call_end').at(-1).target, 'fixture-b');
  }],
  ['old_local_sdp_cannot_emit_or_arm_new_timeout', async page => {
    await hold(page, 'local'); await begin(page, 'startCall', 'fixture-a'); await used(page, 'local'); await end(page); await startB(page);
    await release(page, 'local'); await settled(page, 2); const value = await snapshot(page); onlyBOffer(value); ownsB(value);
  }],
  ['incoming_cancelled_media_cannot_clean_up_new_call', async page => {
    await incoming(page); await hold(page, 'media'); await begin(page, 'answerCall'); await used(page, 'media'); await end(page); await startB(page);
    await release(page, 'media'); await settled(page, 2); const value = await snapshot(page); onlyBOffer(value); ownsB(value); noAnswers(value); assert.ok(value.streams[0].stopped > 0);
  }],
  ['declining_incoming_call_retires_pending_media', async page => {
    await incoming(page); await hold(page, 'media'); await begin(page, 'answerCall'); await used(page, 'media');
    await page.evaluate(() => window.__callFixture.api.declineCall()); await state(page, 'idle'); await startB(page);
    await release(page, 'media'); await settled(page, 2); const value = await snapshot(page); onlyBOffer(value); ownsB(value); noAnswers(value); assert.ok(value.streams[0].stopped > 0);
  }],
  ['accepted_elsewhere_retires_pending_incoming_media', async page => {
    await incoming(page); await hold(page, 'media'); await begin(page, 'answerCall'); await used(page, 'media');
    await page.evaluate(() => window.__callFixture.incoming({ type: 'call_accepted_elsewhere' })); await state(page, 'idle'); await startB(page);
    await release(page, 'media'); await settled(page, 2); const value = await snapshot(page); onlyBOffer(value); ownsB(value); noAnswers(value); assert.ok(value.streams[0].stopped > 0);
  }],
  ['incoming_cancelled_answer_sdp_cannot_signal', async page => {
    await incoming(page); await hold(page, 'answer'); await begin(page, 'answerCall'); await used(page, 'answer'); await end(page); await startB(page);
    await release(page, 'answer'); await settled(page, 2); const value = await snapshot(page); onlyBOffer(value); ownsB(value); noAnswers(value);
  }],
  ['incoming_cancelled_remote_sdp_cannot_continue_setup', async page => {
    await incoming(page); await hold(page, 'remote'); await begin(page, 'answerCall'); await used(page, 'remote'); await end(page); await startB(page);
    await release(page, 'remote'); await settled(page, 2); const value = await snapshot(page); onlyBOffer(value); ownsB(value); noAnswers(value);
  }],
  ['unmount_cancels_pending_media_and_stops_late_stream', async page => {
    await hold(page, 'media'); await begin(page, 'startCall', 'fixture-a'); await used(page, 'media'); await page.evaluate(() => window.__callFixture.unmount());
    await release(page, 'media'); await settled(page, 1); const value = await snapshot(page);
    assert.equal(value.streams[0].stopped, 1); assert.equal(value.signals.filter(s => s.type === 'call_offer').length, 0); assert.equal(value.peers.length, 0); assert.equal(value.answerTimers, 0);
  }],
  ['account_switch_retires_pending_old_account_media', async page => {
    await hold(page, 'media'); await begin(page, 'startCall', 'fixture-a'); await used(page, 'media');
    await page.evaluate(() => window.__callFixture.switchOwner('fixture-new-owner')); await page.waitForFunction(() => window.__callFixture.owner === 'fixture-new-owner');
    await release(page, 'media'); await settled(page, 1); const value = await snapshot(page);
    assert.equal(value.state, 'idle'); assert.equal(value.streams[0].stopped, 1); assert.equal(value.signals.filter(s => s.type === 'call_offer').length, 0); assert.equal(value.answerTimers, 0);
    await startB(page); assert.equal((await snapshot(page)).signals.find(s => s.type === 'call_offer').caller, 'fixture-new-owner');
  }],
  ['stale_media_rejection_cannot_reset_new_call_or_permission_ui', async page => {
    await hold(page, 'media'); await begin(page, 'startCall', 'fixture-a'); await used(page, 'media'); await end(page); await startB(page);
    await release(page, 'media', 'NotAllowedError'); await settled(page, 2); const value = await snapshot(page);
    onlyBOffer(value); ownsB(value); assert.equal(value.permissionDenied, false); assert.equal(value.notices.length, 0);
  }],
  ['cancelled_permission_read_cannot_restart_old_call', async page => {
    await hold(page, 'permission'); await begin(page, 'startCall', 'fixture-a'); await used(page, 'permission'); await end(page); await startB(page);
    await release(page, 'permission'); await settled(page, 2); const value = await snapshot(page); onlyBOffer(value); ownsB(value); assert.equal(value.streams[0].stopped, 1);
  }],
  ['positive_outbound_setup_still_offers_and_times_out', async page => {
    await begin(page, 'startCall', 'fixture-a'); await settled(page, 1); const value = await snapshot(page);
    assert.equal(value.state, 'outgoing'); assert.equal(value.streams[0].stopped, 0); assert.equal(value.answerTimers, 1);
    assert.deepEqual(value.signals, [{ type: 'call_offer', target: 'fixture-a', caller: 'fixture-owner' }]);
    await page.clock.runFor(30000); await state(page, 'idle'); assert.equal((await snapshot(page)).signals.at(-1).target, 'fixture-a');
  }],
  ['positive_incoming_setup_still_answers_current_caller', async page => {
    await incoming(page); await begin(page, 'answerCall'); await settled(page, 1); const value = await snapshot(page);
    assert.equal(value.state, 'connecting'); assert.equal(value.streams[0].stopped, 0);
    assert.deepEqual(value.signals, [{ type: 'call_answer', target: 'fixture-a', caller: null }, { type: 'call_accepted_elsewhere', target: 'fixture-owner', caller: null }]);
    await page.evaluate(() => window.__callFixture.incoming({ type: 'call_accepted_elsewhere' }));
    const afterOwnAnswer = await snapshot(page); assert.equal(afterOwnAnswer.state, 'connecting'); assert.equal(afterOwnAnswer.streams[0].stopped, 0); assert.equal(afterOwnAnswer.peers[0].closed, false);
  }],
];

(async () => {
  await new Promise((resolve, reject) => webpack({
    mode: 'production', context: root, entry: path.join(__dirname, 'browser-entry.jsx'), devtool: false, cache: false,
    output: { path: output, filename: 'fixture.js' }, optimization: { minimize: false },
    resolve: { extensions: ['.js', '.jsx', '.mjs'], modules: [path.join(root, 'frontend/node_modules')] },
    resolveLoader: { modules: [path.join(root, 'frontend/node_modules')] },
    module: { rules: [{ test: /\.[cm]?jsx?$/, exclude: /node_modules/, use: { loader: req.resolve('babel-loader'), options: {
      babelrc: false, configFile: false, presets: [[req.resolve('@babel/preset-react'), { runtime: 'automatic' }]],
      plugins: [function({ types: t }) { return { visitor: {
        Program(p, state) { if (baselineSource && path.resolve(state.filename) === hookPath) p.node.body = req('@babel/parser').parse(baselineSource, { sourceType: 'module', plugins: ['jsx'] }).program.body; },
        VariableDeclarator(p) { if (p.node.id.name === 'ICE_SERVERS') p.node.init = t.arrayExpression([]); },
      } }; }],
    } } }] },
    plugins: [new webpack.NormalModuleReplacementPlugin(/(?:apiClient|audioUnlock|logger|useWebRTCSignaling|useWebRTCMedia|sonner)(?:\.js)?$/, path.join(__dirname, 'browser-stubs.js'))],
  }, (error, stats) => error || stats.hasErrors() ? reject(new Error('Fixture compilation failed')) : resolve()));
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'none'; media-src 'none'");
    response.setHeader('Content-Type', request.url === '/fixture.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/fixture.js' ? fs.readFileSync(path.join(output, 'fixture.js')) : '<!doctype html><title>Isolated call cancellation</title><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser; let context;
  try {
    browser = await req('playwright').chromium.launch({ channel: 'chrome', headless: true });
    context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : (external.push('blocked'), route.abort()));
    for (const [name, run] of cases) {
      const page = await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.name));
      await page.clock.install({ time: new Date('2026-10-29T23:00:00Z') });
      await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => Boolean(window.__callFixture?.api));
      const result = { name, passed: false };
      try { await run(page); result.passed = true; }
      catch (error) { result.error_type = error.name; result.observed = await snapshot(page); }
      finally {
        await page.evaluate(() => { const fixture = window.__callFixture; fixture.unmount(); for (const gate of fixture.gates) if (!gate.released) { gate.released = true; gate.resolve(); } });
        await page.clock.runFor(60000);
        const afterCleanup = await snapshot(page); result.cleanup_intervals = afterCleanup.intervals; result.cleanup_answer_timers = afterCleanup.answerTimers;
        if (afterCleanup.intervals || afterCleanup.answerTimers) result.passed = false;
        await page.close();
      }
      checks.push(result);
    }
  } finally { if (context) await context.close(); if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
  const sourceUnchanged = baseline || digest(fs.readFileSync(hookPath)) === digest(sourceBefore);
  const report = { baseline, baseline_revision: baseline ? baselineRevision : null, source_sha256: sourceHash, source_unchanged: sourceUnchanged,
    passed: checks.filter(check => check.passed).length, total: checks.length, checks, page_errors: errors.length, external_requests: external.length,
    browser_closed: true, fixture_server_closed: !server.listening,
    evidence: 'Actual React hook in Chrome, held synthetic promises and controlled clock; ICE configuration stripped before bundling; no real media, signaling, provider or deployed acceptance.' };
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  if (report.passed !== report.total || errors.length || external.length || !sourceUnchanged) process.exitCode = 1;
})().catch(error => { console.error(error.name + ': ' + error.message.slice(0,1000)); process.exitCode = 2; });
