// Offline WC-02: actual wire mapper and keyboard-opened map glyph; no live map or provider loads.
const fs = require('fs');
const path = require('path');
const http = require('http');
const shared = path.dirname(path.dirname(require.resolve('react/package.json')));
process.env.NODE_PATH = shared;
process.env.NODE_ENV = 'development';
require('module').Module._initPaths();
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.WEATHER_VISUAL_OUT);
const samples = JSON.parse(fs.readFileSync(process.env.WEATHER_VISUAL_FIXTURES, 'utf8'));
fs.mkdirSync(out, {recursive:true});
const source = name => path.join(root, 'src', name);
const write = (name, text) => fs.writeFileSync(path.join(out,name),text);
write('api.js', 'export const BACKEND_URL="";');
write('marker.jsx', 'import React from "react";export const ContentMarker=({children})=><div>{children}</div>;');
write('entry.jsx', `import React from 'react';import {createRoot} from 'react-dom/client';
import MapMarkerLayers from ${JSON.stringify(source('components/map/MapMarkerLayers.js'))};
import {mapSpotRatingsResponse} from ${JSON.stringify(source('components/map/spotRatingsClient.js'))};
import {getThemeTokens} from ${JSON.stringify(source('utils/themeTokens.js'))};
const samples=${JSON.stringify(samples)},q=new URLSearchParams(location.search),s=samples[Number(q.get('sample'))],row=s.wire.spots[0],t=getThemeTokens(q.get('theme'));
createRoot(document.getElementById('root')).render(<main className={t.pageBg+' '+t.textPrimary+' min-h-screen p-4'}>
<p>Offline synthetic tide-coverage check: {s.stage}</p><div style={{display:'flex',justifyContent:'center',paddingTop:350}}>
<MapMarkerLayers spotClusters={[{id:row.spot_id,name:s.name,latitude:row.latitude,longitude:row.longitude,spot:{id:row.spot_id},isCluster:false}]}
livePhotographers={[]} effectiveLocation={null} activeDispatch={null} friendsOnMap={[]} filter="spots" mapRef={{current:{flyTo:()=>{}}}}
surfMode spotRatings={mapSpotRatingsResponse(s.wire.spots)}/></div></main>);`);
write('index.html','<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
async function main(){
 const webpack=require('webpack');
 await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry:path.join(out,'entry.jsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.js','.jsx'],modules:[shared,'node_modules']},resolveLoader:{modules:[shared]},module:{rules:[{test:/\.jsx?$/,exclude:/node_modules/,use:{loader:'babel-loader',options:{babelrc:false,configFile:false,presets:[[require.resolve('@babel/preset-react'),{runtime:'automatic'}]]}}}]},plugins:[new webpack.DefinePlugin({'process.env':'({NODE_ENV:"development"})'}),new webpack.NormalModuleReplacementPlugin(/(apiClient|ContentMarker)$/,r=>{r.request=path.join(out,path.basename(r.request)==='apiClient'?'api.js':'marker.jsx');})]},(err,stats)=>err||stats.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));
 const config=require(path.join(root,'tailwind.config.js'));
 config.content=[source('components/map/*.{js,jsx}'),source('utils/themeTokens.js'),path.join(out,'entry.jsx')];
 const css=await require('postcss')([require('tailwindcss')(config)]).process('@tailwind base;@tailwind components;@tailwind utilities;body{margin:0;font-family:Arial,sans-serif}',{from:undefined});
 write('style.css',css.css);
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname==='/'?'index.html':path.basename(req.url);if(!['index.html','style.css','bundle.js'].includes(name)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(out,name)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;const results=[];
 try{
  browser=await require('@playwright/test').chromium.launch({headless:true,channel:process.env.WEATHER_VISUAL_BROWSER_CHANNEL||'chrome'});
  for(let sample=0;sample<samples.length;sample++)for(const theme of ['light','dark','beach'])for(const width of [390,1280]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[],blocked=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(blocked.push(r.request().url()),r.fulfill({status:503,body:'Offline provider refused'})));
   await page.goto('http://127.0.0.1:'+server.address().port+'/?'+new URLSearchParams({sample,theme}));
   const button=page.getByRole('button',{name:new RegExp(samples[sample].name)});await button.focus();
   const why=page.getByText(samples[sample].wire.spots[0].why,{exact:true});await why.waitFor();
   await why.evaluate(async e=>{for(let p=e;p;p=p.parentElement)await Promise.all(p.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{})));});
   const body=await page.locator('body').innerText(),knownMiss=samples[sample].wire.spots[0].tide_status==='unavailable';
   const bounds=await why.evaluate(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,overflow:document.documentElement.scrollWidth>innerWidth};});
   const file=width+'-'+theme+'-'+samples[sample].name.replaceAll(' ','_')+'-'+samples[sample].stage+'.png';
   await page.screenshot({path:path.join(out,file),fullPage:true});
   results.push({sample,theme,width,file,bounds,errors,blocked,knownMiss,text:body,
    valid:!errors.length&&!blocked.length&&!bounds.overflow&&bounds.x>=0&&bounds.x+bounds.w<=width&&bounds.y>=0&&bounds.h>0&&(!knownMiss||(!/Tide .* (rising|falling|slack)/.test(body)&&body.includes('tide adjustment unavailable')))});
   await page.close();
  }
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
 write('receipt.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify({cases:results.length,failures:results.filter(r=>!r.valid),out}));
 if(results.some(r=>!r.valid))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
