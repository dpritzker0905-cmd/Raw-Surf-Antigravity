// Actual Credits component in React/local DOM with fake API. No browser/provider acceptance.
const fs=require('fs'),path=require('path'),vm=require('vm');
const deps=path.resolve('C:/Users/David/App/raw-surf/frontend/node_modules');
const dep=n=>require(path.join(deps,n));
const {JSDOM}=dep('jsdom');const dom=new JSDOM('<div id="app"></div>',{url:'http://fixture.invalid/'});
global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;global.IS_REACT_ACT_ENVIRONMENT=true;
const React=dep('react'),{createRoot}=dep('react-dom/client'),babel=dep('@babel/core');
const source=fs.readFileSync(path.resolve(__dirname,'../../../../frontend/src/components/Credits.js'),'utf8');
const compiled=babel.transformSync(source,{configFile:false,babelrc:false,presets:[path.join(deps,'@babel/preset-react')],plugins:[path.join(deps,'@babel/plugin-transform-modules-commonjs')]}).code;
let selectedOffer,failLoad=false,stale=false,posted=[],activeTheme='dark',holdLoad=false,releaseLoad;
const makeOffer=(id,bonus)=>({offer_id:id,packages:[10,25,50,100].map(amount=>({amount,bonus:amount===50?bonus:0,credits:amount+(amount===50?bonus:0)}))});
const api={get:async url=>{if(url!='/credits/packages')throw Error('Unexpected API');if(holdLoad)return new Promise((resolve,reject)=>{releaseLoad={resolve,reject}});if(failLoad)throw Error('synthetic outage');return {data:selectedOffer}},post:async(url,data)=>{posted.push(data);if(stale){selectedOffer=makeOffer('offer-next',0);throw Object.assign(Error('stale offer'),{response:{status:409,data:{detail:'Refresh current offer'}}})}throw Error('No provider allowed')}};
const mocks={react:React,'../contexts/AuthContext':{useAuth:()=>({user:{id:'synthetic',credit_balance:0},updateUser:()=>{}})},'../contexts/ThemeContext':{useTheme:()=>({theme:activeTheme})},'react-router-dom':{useNavigate:()=>()=>{},useLocation:()=>({state:null}),useSearchParams:()=>[new URLSearchParams()]},'../lib/apiClient':{__esModule:true,default:api},'lucide-react':Object.fromEntries(['DollarSign','CreditCard','CheckCircle','Coins','Loader2'].map(n=>[n,()=>null])),'./ui/button':{Button:props=>React.createElement('button',props,props.children)},'./ui/input':{Input:props=>React.createElement('input',props)},sonner:{toast:{error:()=>{},success:()=>{}}},'../utils/logger':{__esModule:true,default:{error:()=>{}}},'../constants/roles':{isGrom:()=>false},'../utils/gromPurchase':{submitPurchaseRequest:async()=>{throw Error('No child flow in test')}}};
const context={exports:{},require:n=>{if(!(n in mocks))throw Error('Unexpected module '+n);return mocks[n]},window,document,localStorage:window.localStorage,URLSearchParams,setTimeout,clearTimeout,console};vm.createContext(context);vm.runInContext(compiled,context);const C=context.exports.Credits;
let root;async function mount(){root=createRoot(document.getElementById('app'));await React.act(async()=>root.render(React.createElement(C)))}async function unmount(){await React.act(async()=>root.unmount())}const purchase=()=>document.querySelector('[data-testid="purchase-credits-button"]');const fifty=()=>document.querySelector('[data-testid="package-50"]');const assert=(x,msg)=>{if(!x)throw Error(msg)};
(async()=>{try{
 selectedOffer=makeOffer('offer-five',5);await mount();await React.act(async()=>fifty().click());assert(purchase().textContent.includes('55 Credits for $50'),'bonus total label');assert(document.body.textContent.includes('+5 FREE'),'bonus badge');await unmount();console.log('PASS dynamic bonus offer label');
 selectedOffer=makeOffer('offer-zero',0);await mount();await React.act(async()=>fifty().click());assert(purchase().textContent.includes('50 Credits for $50'),'zero total');assert(!document.body.textContent.includes('FREE'),'zero bonus advertisement hidden');await unmount();console.log('PASS zero bonus hides promotion');
 failLoad=true;await mount();assert(!fifty()&&purchase().disabled,'failed offers disable checkout and hide packages');assert(!document.body.textContent.includes('FREE'),'failure no promo fallback');failLoad=false;selectedOffer=makeOffer('offer-retry',0);const retry=[...document.querySelectorAll('button')].find(x=>x.textContent==='Retry credit offers');assert(retry,'retry control');await React.act(async()=>retry.click());assert(fifty()&&!purchase().disabled,'retry restores current offer');await unmount();console.log('PASS failed load disables checkout and retry recovers');
 selectedOffer=makeOffer('offer-old',5);stale=true;posted=[];await mount();await React.act(async()=>fifty().click());await React.act(async()=>purchase().click());assert(posted.length===1&&posted[0].offer_id==='offer-old'&&posted[0].amount===50,'checkout sends expected offer');assert(purchase().textContent.includes('50 Credits for $50')&&!document.body.textContent.includes('FREE'),'stale response refreshes offer');await unmount();console.log('PASS stale offer refresh');
 for(const [theme,textClass,buttonClass] of [['light','text-gray-600','bg-white'],['dark','text-gray-400','bg-zinc-800'],['beach','text-gray-300','bg-black']]){
  activeTheme=theme;holdLoad=true;stale=false;failLoad=false;await mount();
  const status=document.querySelector('[role="status"]');assert(status&&status.classList.contains(textClass),theme+' loading text contrast');
  await React.act(async()=>releaseLoad.reject(Error('synthetic unavailable')));
  const error=document.querySelector('[role="alert"]');assert(error&&error.querySelector('p').classList.contains(textClass),theme+' error text contrast');
  const retry=[...error.querySelectorAll('button')].find(x=>x.textContent==='Retry credit offers');assert(retry&&retry.classList.contains(buttonClass),theme+' retry surface');
  assert(purchase().disabled&&!document.body.textContent.includes('FREE'),theme+' failure remains fail closed');
  await unmount();holdLoad=false;console.log('PASS '+theme+' loading/error/retry theme');
 }
 console.log('7/7 local DOM offer cases passed');
}finally{dom.window.close()}})().catch(e=>{console.error(e);process.exitCode=1});
