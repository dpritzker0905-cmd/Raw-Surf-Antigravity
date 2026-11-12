// CPU profile of a timeline scrub on the phone profile (2026-11-11, layer animation lane). Offline only.
// Opens the built client over serve_synthetic.py (raster hosts through raster-lab/rr.js, replay), switches LAYER on, waits, then
// samples the main thread (CDP Profiler, 500 us) across six ArrowRight steps 700 ms apart at 4x CPU throttle, 390 x 844 dpr 3.
// Prints self time by source file and by function, resolved through the build's source maps. Self time is charged to the
// function the optimiser left standing: an inlined callee shows under its caller (read the file totals with that in mind).
//   PORT=4198 AB_BASE=http://127.0.0.1:3198 RR_MODE=replay RR_DIR=<cache> CDN_DIR=<frames> BUILD=<build dir> LAYER=wind
//     OUT=prof.json FLAGS=__RAW_DISABLE_X__,__RAW_DISABLE_Y__ node profile_scrub.cjs
if (process.env.AB_LIVE === '1') throw Error('profile_scrub is offline only');
const fs=require('fs');const path=require('path');const http=require('http');
const L=require('./ab_lib.js');const {RR}=require('../raster-lab/rr.js');const {SourceMapConsumer}=require('source-map');
const LAYER=process.env.LAYER||'waves';const OUT=process.env.OUT;const CDN_DIR=process.env.CDN_DIR;const BUILD=process.env.BUILD;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const cdn=http.createServer((req,res)=>{const rel=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/,'');const file=path.join(CDN_DIR,rel);const cors={'access-control-allow-origin':'*'};
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(400,cors);return res.end('{}');}const b=fs.readFileSync(file);res.writeHead(200,{...cors,'content-length':b.length,'content-type':rel.endsWith('.bin')?'application/octet-stream':'application/json'});res.end(b);});
 await new Promise(r=>cdn.listen(4193,'127.0.0.1',r));
 const rr=new RR(process.env.RR_DIR);const meta=JSON.parse(fs.readFileSync(path.join(process.env.RR_DIR,'meta.json')));
 const {browser,page}=await L.launch({port:+process.env.PORT,width:390,height:844,dpr:3,contextOptions:{isMobile:true,hasTouch:true}});
 await rr.install(page);
 await page.addInitScript((offset)=>{const RD=Date;function D(...a){if(!(this instanceof D))return new RD(RD.now()+offset).toString();return a.length?new RD(...a):new RD(RD.now()+offset);}D.prototype=RD.prototype;D.now=()=>RD.now()+offset;D.parse=RD.parse;D.UTC=RD.UTC;window.Date=D;},meta.tRec-Date.now());
 await page.addInitScript((flags)=>{try{localStorage.removeItem('__RAW_STATIC_FRAMES__');localStorage.setItem('raw-surf-theme','dark');}catch(e){}window.__RAW_STATIC_FRAMES_BASE__='http://127.0.0.1:4193/';for(const k of flags)window[k]=true;},(process.env.FLAGS||'').split(',').filter(Boolean));
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await L.openMap(page);await L.jump(page,-79.8,28.0,5);await sleep(5000);
 await page.evaluate((l)=>window.toggleLayer(l),LAYER);await sleep(9000);
 const wheel=page.locator('[role="slider"][aria-label*="timeline wheel"]').filter({visible:true}).first();
 await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});await cdp.send('Profiler.start');
 for(let i=0;i<6;i++){await wheel.focus().catch(()=>{});await page.keyboard.press('ArrowRight');await sleep(700);}
 await sleep(1500);
 const {profile}=await cdp.send('Profiler.stop');await browser.close();cdn.close();
 const self=new Map();const dt=profile.timeDeltas;const byId=new Map(profile.nodes.map(n=>[n.id,n]));
 const parent=new Map();for(const n of profile.nodes)for(const c of(n.children||[]))parent.set(c,n.id);
 profile.samples.forEach((id,i)=>{self.set(id,(self.get(id)||0)+dt[i]);});
 const maps={};const consumer=async(url)=>{const f=url.split('/').pop();if(!(f in maps)){const p=path.join(BUILD,'static/js',f+'.map');maps[f]=fs.existsSync(p)?await new SourceMapConsumer(JSON.parse(fs.readFileSync(p,'utf8'))):null;}return maps[f];};
 const agg=new Map();const aggFile=new Map();let total=0;
 for(const [id,us] of self){const n=byId.get(id);const cf=n.callFrame;let key=cf.functionName||'(anon)';let file=cf.url.split('/').pop()||'(native)';
  if(cf.url&&cf.url.includes('/static/js/')){const c=await consumer(cf.url);if(c){const o=c.originalPositionFor({line:cf.lineNumber+1,column:cf.columnNumber});if(o.source){file=o.source.replace(/^.*node_modules\//,'nm/');key=(o.name||cf.functionName||'(anon)')+':'+o.line;}}}
  if(key==='(idle)'||key==='(program)')continue;total+=us;const k=file+' '+key;agg.set(k,(agg.get(k)||0)+us);aggFile.set(file,(aggFile.get(file)||0)+us);}
 const top=(m,n)=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>[Math.round(v/1000),k]);
 fs.writeFileSync(OUT,JSON.stringify({layer:LAYER,totalMs:Math.round(total/1000),files:top(aggFile,25),fns:top(agg,40)},null,1));
 console.log('total ms',Math.round(total/1000));for(const r of top(aggFile,22))console.log(r[0],r[1]);console.log('--');for(const r of top(agg,25))console.log(r[0],r[1]);
})();
