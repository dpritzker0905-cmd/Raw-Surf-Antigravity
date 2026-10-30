/* Actual PaymentSuccess state/effect rendered in React + jsdom. No router, full JSX,
   real API, provider, browser or network is exercised. Timers and API are doubles. */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const req = createRequire('C:/Users/David/App/raw-surf/frontend/package.json');
const React = req('react');
const { createRoot } = req('react-dom/client');
const { JSDOM } = req('jsdom');
const source = fs.readFileSync(path.resolve(__dirname, '../../../../frontend/src/components/PaymentSuccess.js'), 'utf8');
const start = source.indexOf('  const [status, setStatus]');
const end = source.indexOf('  const renderContent =');
if (start < 0 || end < start) throw Error('Actual component effect region not found');
const region = source.slice(start, end);
const dom = new JSDOM('<div id="host"></div>', { url: 'http://fixture.invalid' });
global.window = dom.window; global.document = dom.window.document;
global.navigator = dom.window.navigator; global.IS_REACT_ACT_ENVIRONMENT = true;
const { act } = React;
const cases = [];
function test(name, fn) { cases.push([name, fn]); }
function assert(condition, message) { if (!condition) throw Error(message); }
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
async function fixture(onGet, id='synthetic') {
  const timers = new Map(); let next=0; const calls=[];
  const apiClient = { get(url) { calls.push(url); return onGet(url, calls.length); } };
  const setTimer = (fn, delay) => { const key=++next; timers.set(key,{fn,delay}); return key; };
  const clearTimer = key => timers.delete(key);
  const Probe = new Function('React','apiClient','logger','setTimeout','clearTimeout',
    `return function Probe({sessionId}) { const {useState,useEffect}=React; ${region}
      return React.createElement('output', null, JSON.stringify({status,paymentData})); }`)
    (React,apiClient,{error(){}},setTimer,clearTimer);
  const host=document.createElement('div'); document.body.appendChild(host); const root=createRoot(host);
  const render=async sessionId => { await act(async()=>{root.render(React.createElement(Probe,{sessionId}));}); };
  await render(id);
  return { calls,timers,render,state:()=>JSON.parse(host.textContent),
    async tick(){assert(timers.size===1,'Expected exactly one pending timer'); const [key,timer]=timers.entries().next().value; assert(timer.delay===2000,'Retry delay must be 2000ms');timers.delete(key);await act(async()=>{timer.fn();});},
    async close(){await act(async()=>{root.unmount();});host.remove();} };
}
const pending=()=>Promise.resolve({data:{payment_status:'unpaid',status:'open'}});
test('pending waits for timer',async()=>{const f=await fixture(pending);try{assert(f.calls.length===1,'Pending status retried before timer');assert(f.state().status==='checking','Pending initial request timed out early');assert(f.timers.size===1,'Expected one scheduled retry');}finally{await f.close();}});
test('six total pending attempts then timeout',async()=>{const f=await fixture(pending);try{for(let i=0;i<5;i++)await f.tick();assert(f.calls.length===6,'Expected initial plus five retries');assert(f.state().status==='timeout','Expected timeout');assert(f.timers.size===0,'Timeout must stop timers');}finally{await f.close();}});
test('paid terminal',async()=>{const f=await fixture(()=>Promise.resolve({data:{payment_status:'paid',id:'paid'}}));try{assert(f.state().status==='success','Expected success');assert(f.calls.length===1&&f.timers.size===0,'Paid must stop');}finally{await f.close();}});
test('expired terminal',async()=>{const f=await fixture(()=>Promise.resolve({data:{status:'expired'}}));try{assert(f.state().status==='expired','Expected expired');assert(f.timers.size===0,'Expired must stop');}finally{await f.close();}});
test('error terminal',async()=>{const f=await fixture(()=>Promise.reject(Error('synthetic')));try{assert(f.state().status==='error','Expected error');assert(f.timers.size===0,'Error must stop');}finally{await f.close();}});
test('missing session does not request',async()=>{const f=await fixture(pending,null);try{assert(f.calls.length===0&&f.state().status==='error','Missing session should error without request');}finally{await f.close();}});
test('unmount clears scheduled retry',async()=>{const f=await fixture(pending);await f.close();assert(f.timers.size===0,'Unmount left scheduled retry');});
test('old response ignored after session changes',async()=>{const old=deferred();const f=await fixture(url=>url.endsWith('/old')?old.promise:Promise.resolve({data:{payment_status:'paid',id:'new'}}),'old');try{await f.render('new');await act(async()=>old.resolve({data:{payment_status:'paid',id:'old'}}));assert(f.state().paymentData.id==='new','Old response overwrote new session');assert(f.timers.size===0,'Old response scheduled timer');}finally{await f.close();}});
test('session change resets displayed data',async()=>{const next=deferred();const f=await fixture(url=>url.endsWith('/old')?Promise.resolve({data:{payment_status:'paid',id:'old'}}):next.promise,'old');try{await f.render('new');assert(f.state().status==='checking'&&f.state().paymentData===null,'New session retained old result');}finally{await f.close();await act(async()=>next.resolve({data:{status:'open'}}));}});
test('unmounted in-flight response cannot schedule',async()=>{const later=deferred();const f=await fixture(()=>later.promise);await f.close();await act(async()=>later.resolve({data:{status:'open'}}));assert(f.timers.size===0,'Unmounted response scheduled timer');});
(async()=>{let failures=0;for(const [name,fn] of cases){try{await fn();console.log('PASS',name);}catch(e){failures++;console.log('FAIL',name,e.message);}}dom.window.close();console.log(`${cases.length-failures}/${cases.length} polling cases passed`);process.exitCode=failures?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
