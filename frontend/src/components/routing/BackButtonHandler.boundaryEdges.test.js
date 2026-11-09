import React, {useEffect} from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
jest.mock('react-router-dom',()=>jest.requireActual('../../../node_modules/react-router-dom/dist/index.js'),{virtual:true});
jest.mock('react-router/dom',()=>jest.requireActual('../../../node_modules/react-router/dist/development/dom-export.js'),{virtual:true});
const {TextEncoder,TextDecoder}=require('util');
if(!global.TextEncoder)global.TextEncoder=TextEncoder;
if(!global.TextDecoder)global.TextDecoder=TextDecoder;
const {BrowserRouter,Routes,Route,Link,useLocation}=require('react-router-dom');
jest.mock('../../contexts/AuthContext',()=>({useAuth:()=>({user:{id:'edge-account'}})}));
const originalFetch=global.fetch;
global.fetch=()=>Promise.reject(new Error('Offline history-edge verification'));
const {BackButtonHandler}=require('./AppLayout');
global.fetch=originalFetch;
let authMounts=0;
function Auth(){useEffect(()=>{authMounts++;},[]);return <p>Public destination</p>;}
function Current(){const at=useLocation();return <output aria-label="Route identity">{at.pathname+at.search+at.hash}|{JSON.stringify(at.state)}</output>;}
function App({basename='/'}){return <BrowserRouter basename={basename}>
  <Routes><Route path="/map" element={<Link to="/map?panel=second#events" state={{nested:{hint:'second'}}}>Second map view</Link>}/>
    <Route path="/feed" element={<p>Feed destination</p>}/>
    {['/','/auth','/auth/','/login'].map(path=><Route key={path} path={path} element={<Auth/>}/>)}</Routes>
  <Current/><BackButtonHandler/>
</BrowserRouter>;}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let waiters=[],onObserved=null;
const observe=event=>{waiters=waiters.filter(waiter=>{waiter.remaining--;if(waiter.remaining)return true;waiter.resolve();return false;});onObserved?.(event);};
const nextPop=()=>new Promise(resolve=>waiters.push({remaining:1,resolve}));
const go=delta=>act(async()=>{const done=nextPop();window.history.go(delta);await done;await tick();await tick();});
function seed(previous='/outside',base=''){
  window.history.replaceState({key:'previous',idx:0},'',previous);
  window.history.pushState({key:'map-arrival',idx:1,usr:{nested:{hint:'first'}}},'',base+'/map?panel=first#curve');
}
beforeEach(()=>{authMounts=0;waiters=[];onObserved=null;seed();window.addEventListener('popstate',observe,true);});
afterEach(()=>{window.removeEventListener('popstate',observe,true);onObserved=null;jest.restoreAllMocks();});

test.each(['','/local-ui'])('private same-path POP retains query, hash and caller state without growing history under %s',async base=>{
  seed(base+'/outside',base);render(<App basename={base||'/'}/>);
  const arrivalLength=window.history.length;
  fireEvent.click(screen.getByRole('link',{name:'Second map view'}));
  expect(screen.getByLabelText('Route identity')).toHaveTextContent('/map?panel=second#events|{"nested":{"hint":"second"}}');
  expect(window.history.length).toBe(arrivalLength+1);
  await go(-1);
  expect(screen.getByLabelText('Route identity')).toHaveTextContent('/map?panel=first#curve|{"nested":{"hint":"first"}}');
  expect(window.history.state).toMatchObject({key:'map-arrival',idx:1,usr:{nested:{hint:'first'}}});
  await go(1);
  expect(screen.getByLabelText('Route identity')).toHaveTextContent('/map?panel=second#events|{"nested":{"hint":"second"}}');
  expect(window.history.length).toBe(arrivalLength+1);
});

test.each(['','/local-ui'].flatMap(base=>['/','/login','/auth/'].map(path=>[base,path])))('auth alias %s%s is intercepted on a multi-entry POP without mounting public UI',async(base,path)=>{
  seed(base+path+'?source=history#return',base);render(<App basename={base||'/'}/>);
  await go(-2);
  await waitFor(()=>expect(screen.getByLabelText('Route identity')).toHaveTextContent('/feed|'));
  expect(window.location.pathname).toBe(base+'/feed');
  expect(window.location.search).toBe('');expect(window.location.hash).toBe('');
  expect(authMounts).toBe(0);expect(screen.queryByText('Public destination')).not.toBeInTheDocument();
});

test('unmount cancels a recovery already queued by a real boundary POP',async()=>{
  const view=render(<App/>),forward=jest.spyOn(window.history,'forward');
  let stopped;
  const unmounted=new Promise(resolve=>{stopped=resolve;});
  // This observer runs before the capture guard: its next task unmounts before
  // the guard's subsequently queued recovery task can traverse Forward.
  onObserved=()=>{onObserved=null;setTimeout(()=>{view.unmount();stopped();},0);};
  await act(async()=>{window.history.back();await unmounted;await tick();await tick();});
  expect(forward).not.toHaveBeenCalled();
});
