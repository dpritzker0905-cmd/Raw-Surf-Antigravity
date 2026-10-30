const fs=require('fs'),path=require('path'),http=require('http'),{spawn}=require('child_process');
const out=__dirname,root=path.resolve(out,'../../../..'),front=path.join(root,'frontend');
const req=require('module').createRequire(path.join(front,'package.json'));const webpack=req('webpack');
const results=[],errors=[],external=[];const check=(name,ok,details)=>{results.push({name,passed:!!ok,details});console.log(ok?'PASS':'HOLD',name);};
const O='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',S='33333333-3333-4333-8333-333333333333',T='abcdef01-2345-4789-abcd-ef0123456789';
const tp='/support/tickets/'+T;const pause=p=>p.waitForTimeout(150);
async function main(){
 fs.mkdirSync(path.join(out,'.browser'),{recursive:true});
 const replace=new Map([
 ['contexts/AuthContext','app-auth.jsx'],['contexts/PricingContext','app-stubs.jsx'],['contexts/PersonaContext','app-stubs.jsx'],
 ['components/routing/AppLayout','app-layout.jsx'],['components/routing/TosReacceptanceGate','app-tos.jsx'],['components/GromSafetyGate','app-stubs.jsx'],['components/RequestProSelfieModal','app-stubs.jsx'],['lib/apiClient','app-transport.js'],['utils/audioUnlock','app-stubs.jsx'],
 ].map(([a,b])=>[path.join(front,'src',a).replaceAll('\\','/'),path.join(out,b)]));
 const stub=path.join(out,'app-stubs.jsx');
 const compiler=webpack({mode:'development',devtool:false,cache:false,context:front,entry:path.join(out,'app-entry.jsx'),output:{path:path.join(out,'.browser'),filename:'app.js',publicPath:'/assets/'},resolve:{extensions:['.js','.jsx','.json'],modules:[path.join(front,'node_modules'),'node_modules']},module:{rules:[{test:/\.[jt]sx?$/,exclude:/node_modules/,use:{loader:req.resolve('babel-loader'),options:{cacheDirectory:false,presets:[[req.resolve('@babel/preset-env'),{targets:{chrome:'110'}}],[req.resolve('@babel/preset-react'),{runtime:'automatic'}]]}}},{test:/\.css$/,type:'asset/source'},{test:/\.(png|jpg|svg|webp)$/,type:'asset/resource'}]},plugins:[new webpack.DefinePlugin({'process.env.REACT_APP_BACKEND_URL':JSON.stringify(''),'process.env.NODE_ENV':JSON.stringify('test')}),new webpack.NormalModuleReplacementPlugin(/.*/,resource=>{
 const resolved=path.resolve(resource.context,resource.request).replaceAll('\\','/');if(resource.request==='./admin/AdminApp' && resource.context.replaceAll('\\','/')===path.join(front,'src').replaceAll('\\','/')){resource.request=stub;return;}if(replace.has(resolved)){resource.request=replace.get(resolved);return;}
 if(resource.context.replaceAll('\\','/')===path.join(front,'src').replaceAll('\\','/') && resource.request.startsWith('./components/') && !['./components/Auth','./components/routing/ErrorBoundary','./components/routing/ProtectedRoute','./components/routing/AppLayout','./components/NotificationsPage','./components/support/SupportRoute','./components/BookingPaymentSuccess','./components/DispatchPaymentSuccess'].includes(resource.request))resource.request=stub;
 })]});
 await new Promise((resolve,reject)=>compiler.run((err,stats)=>{compiler.close(()=>{});err||stats.hasErrors()?reject(err||new Error(stats.toString({all:false,errors:true}))):resolve();}));
 const config=req(path.join(front,'tailwind.config.js'));config.content=[path.join(front,'src/components/{Auth,NotificationsPage,BookingPaymentSuccess,DispatchPaymentSuccess}.js'),path.join(front,'src/components/support/*.js')];
 const css=await req('postcss')([req('tailwindcss')(config)]).process(['index.css','App.css','styles/wraparound.css'].map(p=>fs.readFileSync(path.join(front,'src',p),'utf8')).join('\n').replace(/^@import[^\n]*\n/gm,''),{from:undefined});
 fs.writeFileSync(path.join(out,'.browser/index.html'),`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>`);
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin=`http://127.0.0.1:${port}`;
 const log=fs.openSync(path.join(out,'logs/app-server.log'),'a');const child=spawn('C:/Users/David/App/raw-surf/backend/.venv/Scripts/python.exe',['-B',path.join(out,'serve_app.py'),String(port)],{cwd:root,stdio:['ignore',log,log],windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 let browser;
 const api=async(url,user,body,method)=>{const r=await fetch(origin+(url.startsWith('/fixture/')?'':'/api')+url,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(user?{'X-Fixture-User':user}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 try{
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(origin+'/fixture/state');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}if(!ready)throw new Error('Synthetic API server did not start; inspect private log');
  const {chromium,expect}=req('@playwright/test');browser=await chromium.launch({channel:'chrome',headless:true});
  const cases=[];
  for(const theme of ['light','dark','beach']) for(const width of [390,1440]) for(const [kind,url] of [['booking','/bookings/success'],['dispatch','/dispatch/success']]) for(const activation of ['click','Enter','Space']){
    await api('/fixture/reset',null,{});
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    await context.addInitScript(theme=>{localStorage.setItem('raw-surf-theme',theme);localStorage.setItem('raw-surf-cookie-consent','accepted')},theme);
    await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push('blocked'),route.abort()));
    const page=await context.newPage();page.setDefaultTimeout(5000);const localErrors=[];page.on('pageerror',e=>localErrors.push(e.message));
    await page.goto(origin+url);const button=page.getByRole('button',{name:'Contact Support',exact:true});await expect(button).toBeVisible();
    const before=await api('/fixture/state');const hit=await button.evaluate(node=>{const r=node.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return top===node||node.contains(top)});if(!hit)throw new Error('Payment support CTA occluded');
    if(activation==='click')await button.click();else{await button.focus();await expect(button).toBeFocused();await button.press(activation)}
    await expect(page).toHaveURL(origin+'/support');await expect(page.getByText('Select a ticket to read its conversation.',{exact:true})).toBeVisible();
    const after=await api('/fixture/state');if(before.data.support_tickets!==after.data.support_tickets)throw new Error('CTA automatically created ticket');
    await page.getByLabel('Subject',{exact:true}).fill('Synthetic user support request');await page.keyboard.press('Tab');
    await page.getByLabel('How can we help?',{exact:true}).fill('Fictional request, no payment or customer metadata');await page.keyboard.press('Tab');
    const creation=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/support/tickets'&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Create ticket',exact:true}).click();const response=await creation;if(!response.ok())throw new Error('Synthetic user ticket creation failed');
    await page.waitForURL(/\/support\/tickets\/[0-9a-f-]+$/);await expect(page.locator('section[aria-label="Support conversation"]').getByText('Fictional request, no payment or customer metadata',{exact:true})).toBeVisible();
    const created=await api('/fixture/state');const requests=await page.evaluate(()=>window.fixture.requests);const noPaymentCalls=!requests.some(r=>/payment|checkout|credit|wallet|stripe|dispatch/i.test(r.url));
    const row={theme,width,kind,activation,passed:created.data.support_tickets===before.data.support_tickets+1&&noPaymentCalls&&localErrors.length===0,automaticTickets:after.data.support_tickets-before.data.support_tickets,userCreatedTickets:created.data.support_tickets-before.data.support_tickets,paymentRequests:requests.filter(r=>/payment|checkout|credit|wallet|stripe|dispatch/i.test(r.url)).length,path:new URL(page.url()).pathname,query:new URL(page.url()).search,hash:new URL(page.url()).hash,horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),pageErrors:localErrors.length};
    row.passed=row.passed&&!row.query&&!row.hash&&!row.horizontalOverflow;cases.push(row);console.log('CTA',theme,width,kind,activation,row.passed?'PASS':'FAIL');
    if(activation==='click')await page.screenshot({path:path.join(out,`${theme}-${width}-${kind}-inbox.png`),fullPage:true});await context.close();
  }
  fs.writeFileSync(path.join(out,'actual-app-results.json'),JSON.stringify({passed:cases.filter(x=>x.passed).length,total:cases.length,node:process.version,browser:browser.version(),cases,externalRequests:external.length,seams:{actual:['App.js route table','payment error components','SupportRoute/Inbox','ThemeContext','native browser activation','loopback real support handlers','SQLite owner ticket creation'],substituted:['session identity','HTTP transport','AppLayout','ToS','unrelated App pages','camera modal'],limits:'No-reference error branches;400 confirmation and expired-client variants separately owned byce30; no real payment/provider/account effects'}},null,2));
  if(cases.some(x=>!x.passed)||external.length)process.exitCode=1;
 }finally{if(browser)await browser.close();child.kill();await new Promise(resolve=>child.once('exit',resolve));fs.closeSync(log);}
}
main().catch(e=>{fs.writeFileSync(path.join(out,'actual-app-blocker.json'),JSON.stringify({error:e.message,stack:e.stack},null,2));console.error(e.message);process.exitCode=1;});
