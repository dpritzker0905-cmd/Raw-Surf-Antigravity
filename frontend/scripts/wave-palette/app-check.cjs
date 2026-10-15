// Full shipped React app with isolated synthetic marine API responses; no live backend traffic.
const fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),build=path.resolve(process.env.WAVE_BUILD||path.join(root,'build'));
const out=path.resolve(process.argv[2]); if(fs.existsSync(out))throw Error('Use a fresh output directory');fs.mkdirSync(out,{recursive:true});
const themes=(process.argv[3]||'beach,light,dark').split(','),devices=(process.argv[4]||'desktop,phone').split(',');
const epoch=Date.parse('2026-10-14T12:00:00Z'),counts={},errors=[],blocked={},mapbox={};
const mapboxToken=process.env.WAVE_MAPBOX?fs.readFileSync('C:/Users/David/App/raw-surf/frontend/.env','utf8').split(/\r?\n/).find(l=>l.startsWith('REACT_APP_MAPBOX_TOKEN='))?.slice('REACT_APP_MAPBOX_TOKEN='.length).trim().replace(/^["']|["']$/g,''):null;
function frame(u,h=0){
 const box=(u.searchParams.get('bbox')||'-180,-80,180,84').split(',').map(Number);
 const b=box.length===4&&box.every(Number.isFinite)?box:[-180,-80,180,84];
 const global=b[2]-b[0]>100,cols=global?91:49,rows=global?43:49,vectors=[];
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
  const lng=b[0]+(b[2]-b[0])*x/(cols-1),lat=b[1]+(b[3]-b[1])*y/(rows-1);
  // A smooth height ladder plus a radial offshore storm; NEVER an accuracy claim.
  const height=.15+5.5*(.5+.5*Math.sin((lng+90)*.22+h*.025))*Math.max(.2,Math.cos(lat*Math.PI/180));
  const direction=235+15*Math.sin(lat*.2),rad=direction*Math.PI/180;
  const wave={height,speed:height,u:-Math.sin(rad),v:-Math.cos(rad),direction,period:11,is_valid:true};
  vectors.push({lat,lng,...wave,waves:{...wave},swell_1:{...wave},swell_2:{...wave},wind_waves:{...wave},isOcean:true});
 }
 const valid=new Date(epoch+h*3600000).toISOString(),layer=u.searchParams.get('layer')||'waves';
 return {vectors,cols,rows,bounds:{west:b[0],south:b[1],east:b[2],north:b[3]},model:'GFS',source:'GFS',domain:'marine',layer,provider:'synthetic-local-QA',source_dataset:'synthetic-palette-QA',renderable:true,nonzeroCount:vectors.length,coverage_scope:global?'global_coarse':'regional',product_id:'palette-QA-'+h+'-'+b.join('_'),valid_time:valid,served_valid_time:valid,model_run_time:new Date(epoch).toISOString(),hour_offset:h,hourOffset:h,rating_mode:false,ratingMode:false};
}
function fixture(u){const p=u.pathname;
 if(p.endsWith('/weather/grid')){const valid=Date.parse(u.searchParams.get('valid_time'));const h=Number.isFinite(valid)?(valid-epoch)/3600000:Number(u.searchParams.get('hour_offset')||u.searchParams.get('hour')||0),g=frame(u,h);return {...g,grid:g};}
 if(p.endsWith('/weather/grid_series')){const hours=(u.searchParams.get('hours')||'0,3,6,9,12').split(',').map(Number).filter(Number.isFinite).slice(0,5);return {frames:hours.map(h=>frame(u,h))};}
 if(p.includes('/compliance/tos-status/'))return {acknowledged:true};
 if(p.endsWith('/weather/capabilities'))return ['waves','swell_1','swell_2','wind_waves'].map(layer=>({model:'GFS',domain:'marine',layer,supports_grid:true,supports_point:true,max_forecast_hours:336,native_max_hours:336,step_hours:3}));
 if(p.endsWith('/weather/status'))return {status:'ok',features:{backend_weather_service:true},last_updated:new Date(epoch).toISOString(),models:{GFS:{available:true,max_forecast_hours:336}},capabilities:{GFS:{marine:true}}};
 if(p.endsWith('/weather/products'))return {products:[],generated_at:new Date(epoch).toISOString()};
 if(p.endsWith('/surf-spots'))return [{id:'palette-QA',name:'Palette QA coast',latitude:30.45,longitude:-88.05,country:'QA',region:'QA',spot_type:'beach'}];
 if(p.endsWith('/location/ip-geolocation'))return {lat:30.45,lng:-88.05,country:'QA'};
 if(p.includes('unread-count'))return {count:0};
 if(p.includes('/weather/point'))return {supported:false,reason:'Synthetic renderer fixture; no forecast validation'};
 if(p.includes('/spot-ratings'))return {ratings:{},source:'qa-empty'};
 if(p.includes('/profiles/'))return {id:'palette-local-QA',username:'paletteqa',role:'Surfer',subscription_tier:'premium'};
 if(p.includes('/notifications'))return {notifications:[],unread_count:0};
 return p.includes('/weather/')?{}:[];
}
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{let f=path.resolve(build,'.'+new URL(req.url,'http://x').pathname);if(!f.startsWith(build+path.sep))return res.writeHead(403).end();if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(build,'index.html');res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(res);});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=d3d11','--enable-gpu']});const rows=[];
 try{for(const theme of themes)for(const device of devices){
  const ctx=await browser.newContext({viewport:device==='phone'?{width:390,height:844}:{width:1280,height:900},deviceScaleFactor:device==='phone'?2:1,isMobile:device==='phone',hasTouch:device==='phone',serviceWorkers:'block',ignoreHTTPSErrors:Boolean(mapboxToken),reducedMotion:'no-preference',recordVideo:process.env.WAVE_VIDEO?{dir:path.join(out,'video'),size:device==='phone'?{width:390,height:844}:{width:1280,height:900}}:undefined});
  await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.pathname.startsWith('/api/')){counts[u.pathname]=(counts[u.pathname]||0)+1;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture(u))});}if(u.origin===origin)return route.continue();if(mapboxToken&&u.protocol==='https:'&&['api.mapbox.com','a.tiles.mapbox.com','b.tiles.mapbox.com','c.tiles.mapbox.com','tiles.mapbox.com'].includes(u.hostname)&&route.request().method()==='GET'){u.searchParams.set('access_token',mapboxToken);try{const response=await route.fetch({url:u.href,maxRedirects:0,timeout:30000});mapbox[response.status()]=(mapbox[response.status()]||0)+1;if(response.status()>=300&&response.status()<400)return route.abort();return route.fulfill({response});}catch{mapbox.transportFailures=(mapbox.transportFailures||0)+1;return route.abort();}}const k=u.hostname+u.pathname;blocked[k]=(blocked[k]||0)+1;return route.abort();});
  await ctx.addInitScript(({theme,epoch})=>{window.__BACKEND_URL__=location.origin;localStorage.setItem('raw-surf-user',JSON.stringify({id:'palette-local-QA',username:'paletteqa',full_name:'Local palette QA',role:'Surfer',subscription_tier:'premium',is_admin:false,access_token:'local-QA-placeholder'}));localStorage.setItem('raw-surf-theme',theme);localStorage.setItem('__SURF_MODE__','false');window.__SURF_MODE__=false;localStorage.setItem('user_gps_location',JSON.stringify({loc:{lat:30.45,lng:-88.05,source:'manual'},time:epoch}));let seed=321;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296;};},{theme,epoch});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push({theme,device,message:e.message}));
  await page.clock.setFixedTime(new Date(epoch));await page.goto(origin+'/map',{waitUntil:'domcontentloaded'});await page.waitForTimeout(5000);
  for(const name of ['Decline','Collapse marine animation tuner','Collapse']){const b=page.getByRole('button',{name,exact:true});if(await b.count()&&await b.first().isVisible())try{await b.first().click({timeout:1200});}catch{}}
  const waves=page.getByRole('button',{name:'Waves',exact:true});if(!await waves.isVisible())await page.getByRole('button',{name:'Weather layers',exact:true}).click();await waves.click();await page.waitForTimeout(6000);
  const stages=[];const prefix=theme+'-'+device;
  for(const zoom of process.env.WAVE_CONTROLS_ONLY?[9]:[4,6,9]){
   await page.evaluate(zoom=>window.map.jumpTo({center:[-88.05,28.5],zoom}),zoom);await page.waitForTimeout(1700);
   await page.screenshot({path:path.join(out,prefix+'-z'+zoom+'.png')});
   const read=await page.evaluate(async()=>{const e=window.__MARINE_ENGINE__,d=window.__RAW_GPU__,map=window.map;const times=[];let prev=performance.now();await new Promise(r=>{const end=prev+1000;function tick(t){times.push(t-prev);prev=t;if(t>=end)r();else requestAnimationFrame(tick);}requestAnimationFrame(tick);});times.sort((a,b)=>a-b);const gl=map.painter.context.gl,info=gl.getExtension('WEBGL_debug_renderer_info');return {zoom:map.getZoom(),style:map.getStyle().name,renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):'',glError:gl.getError(),initialized:e?._initialized,grid:e?._waveData?.waveGrid?{cols:e._waveData.waveGrid.cols,rows:e._waveData.waveGrid.rows,layer:e._waveData.waveGrid.layer}:null,drawCalls:d?.drawCallsPerFrame,particlePass:d?.particlePassExecuted,textureCount:d?.textureCount,shaderCompileCount:d?.shaderCompileCount,raf:{n:times.length,p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)]},width:innerWidth,bodyWidth:document.body.scrollWidth,legend:Array.from(document.querySelectorAll('[style]')).filter(el=>el.style.background?.includes('linear-gradient')).map(el=>el.style.background),buttons:Array.from(document.querySelectorAll('button')).map(b=>({text:b.textContent,aria:b.getAttribute('aria-label')}))};});stages.push(read);
  }
  // Move the original engine clock through identical instants, retaining normal frame scheduling.
  const motion=[];for(let i=0;i<8;i++){await page.clock.setFixedTime(new Date(epoch+2000+i*200));await page.waitForTimeout(100);const file=prefix+'-motion-'+i+'.png';await page.screenshot({path:path.join(out,file)});motion.push(file);}
  const controls={};
  if(device==='phone'){const open=page.getByRole('button',{name:'Weather layers',exact:true});await open.click();await page.waitForTimeout(200);controls.mobileSheetOpened=await page.getByText('Map Layers',{exact:true}).isVisible();await page.screenshot({path:path.join(out,prefix+'-sheet.png')});}
  const unit=page.getByRole('button',{name:/Wave height unit: feet/});if(await unit.count()&&await unit.isVisible()){await unit.click();const meters=page.getByRole('button',{name:/Wave height unit: meters/});controls.unitToMeters=await meters.isVisible();await page.screenshot({path:path.join(out,prefix+'-meters.png')});await meters.click();}
  const play=page.getByRole('button',{name:'Play',exact:true});if(await play.count()&&await play.isVisible()){controls.playbackBefore=await page.evaluate(()=>window.__MARINE_ENGINE__?._waveData?.waveGrid?.hourOffset);await play.click();await page.waitForTimeout(4500);controls.pauseVisible=await page.getByRole('button',{name:'Pause',exact:true}).isVisible();controls.playbackAfter=await page.evaluate(()=>window.__MARINE_ENGINE__?._waveData?.waveGrid?.hourOffset);if(controls.pauseVisible)await page.getByRole('button',{name:'Pause',exact:true}).click();}
  const step=page.getByRole('button',{name:'Step +1h',exact:true});if(await step.count()&&await step.isVisible()){const wheel=page.getByRole('slider').first();controls.stepBefore=await wheel.getAttribute('aria-valuenow');await step.click();await page.waitForTimeout(800);controls.stepAfter=await wheel.getAttribute('aria-valuenow');controls.stepGridHour=await page.evaluate(()=>window.__MARINE_ENGINE__?._waveData?.waveGrid?.hourOffset);await page.getByRole('button',{name:'Jump to now',exact:true}).click();}
  if(device==='phone'){const close=page.getByRole('button',{name:'Close',exact:true});if(await close.count()&&await close.isVisible()){await close.click();controls.mobileSheetClosed=!(await waves.isVisible());}}
  const collapse=page.getByRole('button',{name:'Collapse weather controls',exact:true});if(await collapse.count()&&await collapse.isVisible()){await collapse.click();await page.waitForTimeout(300);const expand=page.getByLabel('Expand weather controls',{exact:true}),weather=page.getByRole('button',{name:'Weather layers',exact:true});await page.screenshot({path:path.join(out,prefix+'-collapsed.png')});if(await expand.count()&&await expand.isVisible())await expand.click();else if(await weather.count()&&await weather.isVisible())await weather.click();controls.drawerReopened=await waves.isVisible();}
  const before=await page.evaluate(()=>window.map.getCenter().toArray());const rect=await page.locator('canvas.maplibregl-canvas').boundingBox();await page.mouse.move(rect.x+rect.width*.65,rect.y+rect.height*.60);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.65+60,rect.y+rect.height*.60,{steps:6});await page.mouse.up();await page.waitForTimeout(600);const after=await page.evaluate(()=>window.map.getCenter().toArray());controls.mousePanMoved=JSON.stringify(before)!==JSON.stringify(after);
  if(device==='phone'){const cdp=await ctx.newCDPSession(page);const start=await page.evaluate(()=>window.map.getCenter().toArray()),x=rect.x+rect.width*.65,y=rect.y+rect.height*.48;for(const [type,dx]of [['touchStart',0],['touchMove',30],['touchMove',60],['touchEnd',60]]){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:x-dx,y,radiusX:2,radiusY:2,force:1,id:0}]});await page.waitForTimeout(80);}await page.waitForTimeout(300);const end=await page.evaluate(()=>window.map.getCenter().toArray());controls.emulatedTouchMoved=JSON.stringify(start)!==JSON.stringify(end);}
  await page.screenshot({path:path.join(out,prefix+'-controls.png')});const video=page.video();await ctx.close();if(video){await video.saveAs(path.join(out,prefix+'.webm'));}
  rows.push({theme,device,stages,motion,controls});fs.writeFileSync(path.join(out,'partial.json'),JSON.stringify({rows,counts,errors,blocked,mapbox},null,2));console.log(JSON.stringify({theme,device,stages:stages.map(s=>({z:s.zoom,grid:s.grid,initialized:s.initialized,particlePass:s.particlePass,raf:s.raf})),controls,mapbox}));
 }
 fs.writeFileSync(path.join(out,'app-receipt.json'),JSON.stringify({at:new Date().toISOString(),scope:'Full local production React app; synthetic wave fixtures; '+(mapboxToken?'authorized read-only real Mapbox basemaps':'shipped Natural Earth basemap')+'; mobile emulation on desktop GPU, no physical mobile claim',browser:browser.version(),buildFiles:fs.readdirSync(path.join(build,'static/js')).filter(f=>f.endsWith('.js')),rows,counts,errors,blocked,mapbox},null,2));
 if(errors.length||rows.some(r=>r.stages.some(s=>!s.initialized||!s.particlePass||s.glError)))process.exitCode=1;
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.stack);process.exitCode=2;server.close();});
