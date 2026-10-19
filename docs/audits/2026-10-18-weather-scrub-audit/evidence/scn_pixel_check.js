// AUDIT-ONLY: presentation check. Freeze particle motion is impossible from outside, so compare the heatmap via
// screenshots with particles present (noise floor measured by two shots of the SAME settled hour).
// Steps (page warm at hour 27): shot A27 (settled 27); seek 26 -> shot E (≈150 ms after keydown, before exact upgrade);
// wait for exact 26 -> shot X26; then null control: shot X26b 1 s later. Report mean |diff| per pair.
const path=require('path'); const L=require(path.resolve(process.env.HARNESS_DIR,'ab_lib.js')); const P=require(path.resolve(process.env.HARNESS_DIR,'../../e2e/pngPixels.js'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const W='[role="slider"][aria-label*="Forecast timeline"]';
const eng=()=>{const d=window.__MARINE_ENGINE__&&window.__MARINE_ENGINE__._waveData;return d&&d.waveGrid?d.waveGrid.hourOffset:null;};
function mad(a,b){const x=P.decodePng(a),y=P.decodePng(b);const n=Math.min(x.data.length,y.data.length);let s=0,c=0;const ch=x.channels||4;for(let i=0;i<n;i+=ch){s+=Math.abs(x.data[i]-y.data[i])+Math.abs(x.data[i+1]-y.data[i+1])+Math.abs(x.data[i+2]-y.data[i+2]);c+=3;}return +(s/c).toFixed(3);}
(async()=>{const {browser,page}=await L.launch({port:4101,hashTextureUploads:true}); const out={};
 try{ if(process.env.CPU) { const c=await page.context().newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate',{rate:+process.env.CPU}); }
  await L.openMap(page); await L.jump(page,-108,16,3); await L.clickText(page,'Waves');
  await page.waitForFunction(()=>{const d=window.__MARINE_ENGINE__&&window.__MARINE_ENGINE__._waveData;return d&&d.waveGrid&&d.waveGrid.hourOffset===0;},null,{timeout:90000});
  await sleep(15000); // let series pages load
  const wheel=page.locator(W).filter({visible:true}).first(); await wheel.focus();
  const clip={x:340,y:200,width:600,height:400};
  for(const k of ['PageUp','ArrowRight','ArrowRight','ArrowRight']) {await page.keyboard.press(k); await sleep(150);} // -> 27
  await page.waitForFunction(()=>{const d=window.__MARINE_ENGINE__._waveData;return d.waveGrid.hourOffset===27;},null,{timeout:30000}); await sleep(3000);
  const A27=await page.screenshot({clip}); await sleep(1000); const A27b=await page.screenshot({clip});
  const t0=Date.now(); await page.keyboard.press('ArrowLeft'); await sleep(150);
  const E=await page.screenshot({clip}); const eHour=await page.evaluate(eng); const eLabel=await wheel.getAttribute('aria-valuetext');
  await page.waitForFunction(()=>window.__MARINE_ENGINE__._waveData.waveGrid.hourOffset===26,null,{timeout:30000}); const tX=Date.now()-t0; await sleep(1500);
  const X26=await page.screenshot({clip}); await sleep(1000); const X26b=await page.screenshot({clip});
  Object.assign(out,{cpu:process.env.CPU||1, earlyEngineHour:eHour, earlyLabel:eLabel, exactAfterMs:tX,
   noise_27_27:mad(A27,A27b), noise_26_26:mad(X26,X26b), early_vs_27:mad(E,A27b), early_vs_26:mad(E,X26), d_27_26:mad(A27b,X26)});
  console.log(JSON.stringify(out));
 } finally { await browser.close(); } })().catch(e=>{console.error('FAIL',e.message);process.exit(1);});
