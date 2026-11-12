import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
jest.mock('react-router-dom',()=>jest.requireActual('../../../node_modules/react-router-dom/dist/index.js'),{virtual:true});
jest.mock('react-router/dom',()=>jest.requireActual('../../../node_modules/react-router/dist/development/dom-export.js'),{virtual:true});
const {TextEncoder,TextDecoder}=require('util');
if(!global.TextEncoder)global.TextEncoder=TextEncoder;
if(!global.TextDecoder)global.TextDecoder=TextDecoder;
const {BrowserRouter,Routes,Route,Link,useLocation,useNavigate}=require('react-router-dom');
const {goBackOr}=require('./appHistory');
const {mapWeatherRouteMemory}=require('../map/mapWeatherRouteMemoryStore');
let mockUser={id:'auth-lifecycle-account',role:'surfer'};
jest.mock('../../contexts/AuthContext',()=>({useAuth:()=>({user:mockUser,loading:false})}));
// Ancillary ToS/child-role UI is outside this adult authentication lifecycle check.
jest.mock('./TosReacceptanceGate',()=>({__esModule:true,default:({children})=>children}));
jest.mock('../GromSafetyGate',()=>({__esModule:true,default:({children})=>children}));
const originalFetch=global.fetch;
global.fetch=()=>Promise.reject(new Error('Offline auth lifecycle verification'));
const {BackButtonHandler}=require('./AppLayout');
const ProtectedRoute=require('./ProtectedRoute').default;
global.fetch=originalFetch;
function Current(){const location=useLocation();return <output aria-label="Auth route">{location.pathname+location.search}</output>;}
function Controls(){const navigate=useNavigate();return <>
  <button onClick={()=>navigate('/map',{replace:true})}>Finish sign-in</button>
  <button onClick={()=>navigate('/map?stage=replaced',{replace:true})}>Replace arrival</button>
  <button onClick={()=>goBackOr(navigate,'/feed')}>App Back</button>
</>;}
function App(){return <BrowserRouter><BackButtonHandler/><Current/><Controls/><Routes>
  <Route path="/map" element={<ProtectedRoute><><p>Private map</p><Link to="/feed">Feed link</Link></></ProtectedRoute>}/>
  <Route path="/feed" element={<ProtectedRoute><p>Private feed</p></ProtectedRoute>}/>
  <Route path="/auth" element={<p>Sign in required</p>}/>
</Routes></BrowserRouter>;}
beforeEach(()=>{localStorage.removeItem('raw-surf-user');mockUser={id:'auth-lifecycle-account',role:'surfer'};window.history.replaceState({idx:0,key:'arrival'},'','/map');});
test('sign-out releases the boundary and Back cannot expose a private page',async()=>{
  const view=render(<App/>);fireEvent.click(screen.getByRole('link',{name:'Feed link'}));
  expect(screen.getByText('Private feed')).toBeInTheDocument();
  // MapPage is unmounted on Feed; logout must still clear the prior session's UI intent.
  mapWeatherRouteMemory.owner=mockUser.id;mapWeatherRouteMemory.entries.set('old-map-entry',{layer:'waves',selectedMs:1});
  mockUser=null;view.rerender(<App/>);
  expect(mapWeatherRouteMemory.entries.size).toBe(0);expect(mapWeatherRouteMemory.owner).toBeNull();
  await waitFor(()=>expect(screen.getByText('Sign in required')).toBeInTheDocument());
  await act(async()=>{const pop=new Promise(resolve=>window.addEventListener('popstate',resolve,{once:true}));window.history.back();await pop;});
  await waitFor(()=>expect(screen.getByLabelText('Auth route')).toHaveTextContent('/auth?tab=signup&redirect=%2Fmap'));
  expect(screen.queryByText('Private map')).not.toBeInTheDocument();expect(screen.queryByText('Private feed')).not.toBeInTheDocument();
});
test('sign-in at a protected arrival seeds a new account boundary',async()=>{
  mockUser=null;const view=render(<App/>);
  await waitFor(()=>expect(screen.getByText('Sign in required')).toBeInTheDocument());
  mockUser={id:'second-account',role:'surfer'};
  window.history.replaceState({idx:0,key:'signed-in-arrival'},'','/map');
  // A real POP synchronizes BrowserRouter with the application login redirect.
  await act(async()=>{window.dispatchEvent(new PopStateEvent('popstate',{state:window.history.state}));});
  view.rerender(<App/>);
  await waitFor(()=>expect(screen.getByText('Private map')).toBeInTheDocument());
  expect(window.history.state.__rawSurfHistoryBoundary).toMatchObject({account:'second-account',kind:'entry',startIndex:0});
});

test('sign-in later in history and replacement of the arrival still use the application Back fallback',async()=>{
  mockUser=null;
  for(let idx=1;idx<=4;idx++)window.history.pushState({idx,key:`public-${idx}`},'',`/auth?step=${idx}`);
  const view=render(<App/>);expect(screen.getByText('Sign in required')).toBeInTheDocument();
  expect(window.history.state.__rawSurfHistoryBoundary).toBeUndefined();
  mockUser={id:'later-sign-in-account',role:'surfer'};view.rerender(<App/>);
  fireEvent.click(screen.getByRole('button',{name:'Finish sign-in'}));
  await waitFor(()=>expect(screen.getByText('Private map')).toBeInTheDocument());
  expect(window.history.state).toMatchObject({idx:4,__rawSurfHistoryBoundary:{startIndex:4,account:'later-sign-in-account'}});
  fireEvent.click(screen.getByRole('button',{name:'Replace arrival'}));
  expect(screen.getByLabelText('Auth route')).toHaveTextContent('/map?stage=replaced');
  const length=window.history.length;
  fireEvent.click(screen.getByRole('button',{name:'App Back'}));
  await waitFor(()=>expect(screen.getByLabelText('Auth route')).toHaveTextContent('/feed'));
  expect(screen.getByText('Private feed')).toBeInTheDocument();
  expect(screen.queryByText('Sign in required')).not.toBeInTheDocument();
  expect(window.history.length).toBe(length);expect(window.history.state.idx).toBe(4);
});
