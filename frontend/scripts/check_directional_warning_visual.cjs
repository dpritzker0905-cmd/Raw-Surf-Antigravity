const fs = require('fs');
const path = require('path');
const http = require('http');
const shared = path.dirname(path.dirname(require.resolve('react/package.json')));
process.env.NODE_PATH = shared;
process.env.NODE_ENV = 'development';
require('module').Module._initPaths();
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.WEATHER_VISUAL_OUT || path.join(root, '../scratch/weather-next/warning-visual'));
fs.mkdirSync(out, {recursive:true});
const source = name => path.join(root, 'src', name);
const write = (name, text) => fs.writeFileSync(path.join(out,name),text);
const samples = process.env.WEATHER_VISUAL_FIXTURES ? JSON.parse(fs.readFileSync(process.env.WEATHER_VISUAL_FIXTURES,'utf8')) : [];
write('fixture.js', `const samples=${JSON.stringify(samples)},sample=samples[Number(new URLSearchParams(location.search).get('sample'))];export const current = sample?.current || {wave_height_ft:4.2,wave_period:12,swell_height_ft:2.1,wind_speed:8,wind_direction:290,rating:73,rating_level:'good',label:'Chest High',directional_conflict:{reason:new URLSearchParams(location.search).get('reason')},forecast_confidence:{level:'moderate',relative_spread:.25,calibrated:false}};
export default {get:async url=>({data:url.includes('/explore/spot-details/')?{id:'visual-fixture',name:sample?sample.name+' '+sample.stage:'Offline visual fixture',region:'Fixture coast',latitude:28.3664,longitude:-80.6015,current_conditions:current,forecast:[]}:url.startsWith('/conditions/')?{current,forecast:[]}:{} }),post:()=>{throw Error('Writes prohibited in visual fixture')}};`);
write('auth.js', `export const useAuth=()=>({user:null});`);
write('theme.js', `export const useTheme=()=>({theme:new URLSearchParams(location.search).get('theme')||'light'});`);
write('router.js', `export const useParams=()=>({spotId:'visual-fixture'}); export const useNavigate=()=>()=>{}; export const useLocation=()=>({pathname:'/spot-hub/visual-fixture',search:'',state:null}); export const useSearchParams=()=>[new URLSearchParams(),()=>{}];`);
write('child.js', `export default function Child(){return null}; export const ScheduledBookingDrawer=Child;`);
write('entry.jsx', `import React from 'react';import {createRoot} from 'react-dom/client';import SpotHub from ${JSON.stringify(source('components/SpotHub.js'))};import SpotConditions from ${JSON.stringify(source('components/SpotConditions.js'))};import {getThemeTokens} from ${JSON.stringify(source('utils/themeTokens.js'))};const q=new URLSearchParams(location.search),s=q.get('surface'),t=getThemeTokens(q.get('theme'));createRoot(document.getElementById('root')).render(<main className={t.pageBg+' '+t.textPrimary+' min-h-screen p-4'}><p className="text-sm mb-4">Offline component visual check — synthetic data</p>{s==='hub'?<SpotHub/>:<div className="max-w-xl mx-auto"><SpotConditions spotId="visual-fixture" spotName="Offline visual fixture" compact={s==='compact'}/></div>}</main>);`);
write('index.html','<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
async function main(){
 const webpack=require('webpack');
 const childNames=['SpotHubConditionsTab','SpotHubIntelTab','SpotHubMediaTab','SpotHubPhotographers','SpotHubLivePulse','BookingTypeModal','PhotographerRequestModal','ScheduledBookingDrawer'];
 const alias={};
 for(const [name,mock] of [['lib/apiClient.js','fixture.js'],['contexts/AuthContext.js','auth.js'],['contexts/ThemeContext.js','theme.js']]) alias[source(name)]=path.join(out,mock);
 alias['react-router-dom$']=path.join(out,'router.js');
 await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry:path.join(out,'entry.jsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.js','.jsx'],modules:[shared,'node_modules'],alias},resolveLoader:{modules:[shared]},module:{rules:[{test:/\.jsx?$/,exclude:/node_modules/,use:{loader:'babel-loader',options:{babelrc:false,configFile:false,presets:[[require.resolve('@babel/preset-react'),{runtime:'automatic'}]]} }}]},plugins:[new webpack.DefinePlugin({'process.env':'('+JSON.stringify({NODE_ENV:'development'})+')'}),new webpack.NormalModuleReplacementPlugin(/(apiClient|AuthContext|ThemeContext)$/,r=>{const m={'apiClient':'fixture.js','AuthContext':'auth.js','ThemeContext':'theme.js'};r.request=path.join(out,m[path.basename(r.request)]);}),new webpack.NormalModuleReplacementPlugin(new RegExp('('+childNames.join('|')+')$'),r=>{r.request=path.join(out,'child.js');})]},(err,stats)=>err||stats.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()));
 const config=require(path.join(root,'tailwind.config.js'));
 config.content=[source('**/*.{js,jsx}'),path.join(out,'entry.jsx')];
 const css=await require('postcss')([require('tailwindcss')(config)]).process('@tailwind base;@tailwind components;@tailwind utilities;:root{--radius:.5rem;--background:0 0% 100%;--foreground:240 10% 4%;--border:240 6% 90%;}body{margin:0;font-family:Arial,sans-serif}',{from:undefined});
 write('style.css',css.css);
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname==='/'?'index.html':path.basename(req.url);if(!['index.html','style.css','bundle.js'].includes(name)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(out,name)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 const results=[];
 try{browser=await require('@playwright/test').chromium.launch({headless:true,channel:process.env.WEATHER_VISUAL_BROWSER_CHANNEL || 'chrome'});
 const cases=[];
 if(samples.length){for(let sample=0;sample<samples.length;sample++)for(const theme of ['light','dark','beach'])for(const [width,surface] of [[390,'full'],[1280,'hub']])cases.push({sample,theme,width,surface,reason:null});}
 else{for(const width of [390,1280])for(const theme of ['light','dark','beach'])for(const surface of ['hub','full','compact'])for(const reason of ['swell_aimed_away','size_and_quality_disagree_on_swell_exposure'])cases.push({width,theme,surface,reason});}
 for(const {width,theme,surface,reason,sample} of cases){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],blocked=[];
  page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack}));
  page.on('console',m=>{if(m.type()==='error')errors.push({console:m.text()});});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():(blocked.push(route.request().url()),route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#777"/><text x="20" y="30" fill="white">Offline image fixture</text></svg>'})));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?'+new URLSearchParams({theme,surface,reason,...(sample===undefined?{}:{sample})}));
  const note=sample===undefined?page.getByRole('note',{name:'Swell direction warning',exact:true}):page.locator('main');try{await note.waitFor({timeout:5000});if(sample!==undefined)await page.getByText(new RegExp(samples[sample].current.wave_height_ft.toString().replace('.','\\.')+'\\s*ft')).first().waitFor({timeout:5000});}catch(e){await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});console.log({width,theme,surface,errors,blocked,text:await page.locator('body').innerText()});throw e;}
  const bounds=await note.evaluate(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:b.x,y:b.y,w:b.width,h:b.height,color:s.color,font:s.fontSize,overflow:document.documentElement.scrollWidth>innerWidth,visible:b.width>0&&b.height>0&&s.visibility!=='hidden'};});
  if(sample!==undefined&&surface==='full'&&Number.isFinite(samples[sample].current.rating))await page.getByText(Math.round(samples[sample].current.rating)+'/100',{exact:true}).waitFor({timeout:5000});
  const file=width+'-'+theme+'-'+surface+'-'+(sample===undefined?reason:samples[sample].name+'-'+samples[sample].stage)+'.png';await page.screenshot({path:path.join(out,file),fullPage:true});
  results.push({width,theme,surface,reason,sample:sample===undefined?null:samples[sample],file,bounds,errors,blocked,renderedText:await page.locator('body').innerText()});await page.close();
 }}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
 write('receipt.json',JSON.stringify(results,null,2));
 if(results.some(r=>r.errors.length||!r.bounds.visible||r.bounds.x<0||r.bounds.x+r.bounds.w>r.width+.5||r.bounds.overflow))process.exitCode=1;
 console.log(JSON.stringify({cases:results.length,failures:results.filter(r=>r.errors.length||!r.bounds.visible||r.bounds.x<0||r.bounds.x+r.bounds.w>r.width+.5||r.bounds.overflow),stubbedExternalRequests:results.reduce((n,r)=>n+r.blocked.length,0),artifact:out}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
