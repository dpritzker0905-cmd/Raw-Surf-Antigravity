/**
 * island-rim-ab.js — is the light rim around an island OURS, or the basemap's?
 *
 * The magnified Nassau capture shows a pale blue rim between the teal marine field and the land.
 * Two candidates, and they demand opposite fixes:
 *   H1 our mask edge — the field's alpha ramps down before the shoreline, letting basemap through
 *   H2 the basemap itself — Bahamian banks are painted light turquoise whether or not we draw
 * The L6 control settles it: the SAME camera with Waves OFF. If the rim survives, it is H2 and no
 * shader change can remove it.
 */
const path=require('path');const fs=require('fs');let chromium;
try{({chromium}=require('@playwright/test'))}catch(e){({chromium}=require(path.join(__dirname,'..','node_modules','@playwright','test')))}
const outdir=process.argv[2]||path.join(__dirname,'island-rim-out');fs.mkdirSync(outdir,{recursive:true});
const U={id:'admin-user-id',email:'admin@rawsurf.com',full_name:'A',username:'a',role:'admin',subscription_tier:'premium',is_admin:true};
const TARGETS=[['nassau',[-77.35,25.05],10.17],['grand_bahama',[-78.66,26.62],8.85]];
(async()=>{
const br=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const out={};
// third leg added 2026-08-16: the ON/OFF pair proved the rim is OURS (field tint ramps 7->18 from
// shore to d20 while the basemap profile is flat). BLEND-BOTH fades near-flat cells to translucent
// so the coarse base shows through -- nearshore cells on a shallow bank are exactly "near-flat",
// which would ring an island on every bearing. Its kill switch is the discriminator.
// 2026-08-17 leg set. The mask is exonerated: _maskEdgeSharp reads 1 and the texel is 0.66-1.11
// DEVICE px, which cannot make a 12-20 px ramp. What does live at that scale is the CREST pass --
// crest ribbons are warm/pink and are suppressed near land, leaving a crest-free ring around every
// coast. That predicts exactly the measured chroma (offshore R+17 / B-12) and, on an island, a
// closed ring. __RAW_CREST_LAND_THRESH__=9 discards every crest; SDF off so the threshold path is
// the one taken (halo-isolate L4 pattern).
for(const leg of ['ON','OFF','ON_NOCREST']){
  const waves = leg!=='OFF';
  const c=await br.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2});
  const p=await c.newPage();
  await p.addInitScript(({nb})=>{window.__DISABLE_WEBGL_GUARDRAIL__=true; if(nb){window.__RAW_CREST_LAND_THRESH__=9;window.__RAW_DISABLE_COAST_SDF__=true;}},{nb:leg==='ON_NOCREST'});
  await p.goto('https://dev--rawsurf.netlify.app/auth',{waitUntil:'domcontentloaded',timeout:120000});
  await p.evaluate(u=>{localStorage.setItem('raw-surf-user',JSON.stringify(u));localStorage.setItem(`tos-accepted-${u.id}-1.0`,Date.now());localStorage.setItem('raw-surf-cookie-consent',JSON.stringify({accepted:true,timestamp:Date.now()}));localStorage.setItem('raw-surf-theme','beach');},U);
  await p.goto('https://dev--rawsurf.netlify.app/map',{waitUntil:'domcontentloaded',timeout:120000});
  await p.waitForFunction(()=>!!window.map,null,{timeout:120000});
  if(waves){await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Waves');if(b&&b.getAttribute('aria-pressed')!=='true')b.click();});
    await p.waitForFunction(()=>window.__RAW_GPU__&&window.__RAW_GPU__.overlayMask,null,{timeout:120000});}
  for(const [name,center,z] of TARGETS){
    await p.evaluate(({c,z})=>window.map.jumpTo({center:c,zoom:z}),{c:center,z});
    await p.waitForTimeout(11000);
    await p.screenshot({path:path.join(outdir,`RIM_${name}_${leg}.png`)});
    // radial profile: mean colour at fixed distances OUTWARD from the shoreline, 24 bearings
    const prof=await p.evaluate(async ({center,rayDeg})=>{
      const m=window.map;
      await new Promise(r=>{const fn=()=>{m.off('render',fn);r();};m.on('render',fn);m.triggerRepaint();});
      const src=m.getCanvas(),rect=m.getContainer().getBoundingClientRect(),dpr=src.width/rect.width;
      const cv=document.createElement('canvas');cv.width=src.width;cv.height=src.height;
      const c2=cv.getContext('2d',{willReadFrequently:true});c2.drawImage(src,0,0);
      const img=c2.getImageData(0,0,cv.width,cv.height).data;
      const waterIds=(()=>{try{const ids=(m.getStyle().layers||[]).filter(l=>l['source-layer']==='water'||l.id==='water').map(l=>l.id).filter(id=>{try{return !!m.getLayer(id)}catch(e){return false}});return ids.length?ids:['water']}catch(e){return['water']}})();
      const px=(cx,cy)=>{const X=Math.round(cx*dpr),Y=Math.round(cy*dpr);if(X<0||Y<0||X>=cv.width||Y>=cv.height)return null;const o=(Y*cv.width+X)*4;return[img[o],img[o+1],img[o+2]]};
      const buckets={}; for(const d of [1,2,3,5,8,12,20,35]) buckets[d]=[];
      let used=0;
      for(let b=0;b<24;b++){
        const th=(b/24)*2*Math.PI;
        const dest=[center[0]+rayDeg*Math.sin(th)/Math.cos(center[1]*Math.PI/180), center[1]+rayDeg*Math.cos(th)];
        const p0=m.project(center),p1=m.project(dest);
        const dx=p1.x-p0.x,dy=p1.y-p0.y,n=Math.max(4,Math.round(Math.hypot(dx,dy)*dpr));
        const water=[];
        for(let i=0;i<=n;i++){const cx=p0.x+dx*i/n,cy=p0.y+dy*i/n;
          let w=null; const okv=cx>=0&&cy>=0&&cx<rect.width&&cy<rect.height&&(document.elementFromPoint(cx,cy)||{}).tagName==='CANVAS';
          if(okv){try{w=m.queryRenderedFeatures([cx,cy],{layers:waterIds}).length>0}catch(e){}}
          water.push(w);}
        let coast=-1;
        for(let i=1;i+8<=n;i++){if(water[i]!==true)continue;let ok=true;for(let k=0;k<8;k++)if(water[i+k]!==true){ok=false;break;}
          if(ok&&water.slice(0,i).some(x=>x===false)){coast=i;break;}}
        if(coast<0)continue; used++;
        for(const d of Object.keys(buckets)){const i=coast+ +d; if(i<=n){const c=px(p0.x+dx*i/n,p0.y+dy*i/n); if(c)buckets[d].push(c);}}
      }
      const mean=a=>a.length?[0,1,2].map(k=>Math.round(a.reduce((s,p)=>s+p[k],0)/a.length)):null;
      const o={usedRays:used}; for(const d of Object.keys(buckets)) o['d'+d]=mean(buckets[d]); return o;
    },{center,rayDeg:0.30});
    out[`${name}_${leg}`]=prof;
    console.log(`${name.padEnd(14)} leg=${leg.padEnd(11)} rays=${prof.usedRays} ` +
      [1,2,3,5,8,12,20,35].map(d=>'d'+d+'='+(prof['d'+d]?prof['d'+d].join(','):'-')).join('  '));
  }
  await c.close();
}
fs.writeFileSync(path.join(outdir,'island-rim.json'),JSON.stringify(out,null,1));
await br.close();})();
