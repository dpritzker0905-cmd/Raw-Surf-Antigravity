import React, {StrictMode, useEffect, useState} from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
jest.mock('react-router-dom',()=>jest.requireActual('../../../node_modules/react-router-dom/dist/index.js'),{virtual:true});
jest.mock('react-router/dom',()=>jest.requireActual('../../../node_modules/react-router/dist/development/dom-export.js'),{virtual:true});
const {TextEncoder,TextDecoder}=require('util');
if(!global.TextEncoder)global.TextEncoder=TextEncoder;
if(!global.TextDecoder)global.TextDecoder=TextDecoder;
const {BrowserRouter,Routes,Route,Link,useLocation}=require('react-router-dom');
let mockUser={id:'boundary-account',subscription_tier:'tier_4'};
jest.mock('../../contexts/AuthContext',()=>({useAuth:()=>({user:mockUser})}));
const originalFetch=global.fetch;
global.fetch=()=>Promise.reject(new Error('Offline boundary regression'));
const {BackButtonHandler}=require('./AppLayout');
const {default:useMapWeatherRouteMemory,clearMapWeatherRouteMemory}=require('../map/useMapWeatherRouteMemory');
global.fetch=originalFetch;
let authMounts=0;
function Auth(){useEffect(()=>{authMounts++;},[]);return <p>Auth destination</p>;}
function MapView(){
  const [layers,setLayers]=useState([]),[hour,setHour]=useState(0);
  const [,setPlaying]=useState(false);
  useMapWeatherRouteMemory({user:mockUser,activeModel:'GFS',activeLayers:layers,timeOffsetHours:hour,setActiveLayers:setLayers,setTimeOffsetHours:setHour,setIsPlayingTimeline:setPlaying});
  return <><p>Map destination</p><output aria-label="Selection">{layers[0]||'none'}:{hour}</output>
    <button onClick={()=>{setLayers(['waves']);setHour(4);}}>Select forecast</button><Link to="/theme">Theme</Link></>;
}
function Path(){return <output aria-label="Current path">{useLocation().pathname}</output>;}
function App({basename='/',strict=false}){
  const app=<BrowserRouter basename={basename}><Routes>
    <Route path="/map" element={<MapView/>}/><Route path="/theme" element={<p>Theme destination</p>}/>
    <Route path="/feed" element={<p>Feed destination</p>}/><Route path="/auth" element={<Auth/>}/>
    <Route path="/outside" element={<p>Outside destination</p>}/>
  </Routes><Path/><BackButtonHandler/></BrowserRouter>;
  return strict?<StrictMode>{app}</StrictMode>:app;
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let popWaiters=[];
const observePop=()=>{popWaiters=popWaiters.filter(waiter=>{waiter.left--;if(waiter.left)return true;waiter.resolve();return false;});};
const nextPops=count=>new Promise(resolve=>popWaiters.push({left:count,resolve}));
const go=(delta,count=1)=>act(async()=>{const done=nextPops(count);window.history.go(delta);await done;await tick();await tick();});
// jsdom queues each traversal twice. Wait for the recovery POP itself instead of guessing timer turns.
const protectedBack=()=>go(-1,2);
const forward=()=>go(1);
function seed(base=''){
  window.history.replaceState({key:'outside-entry',idx:0},'',base+'/outside');
  window.history.pushState({usr:{reviewHint:'keep'},key:'map-entry',idx:1},'',base+'/map');
}
beforeEach(()=>{
  clearMapWeatherRouteMemory();mockUser={id:'boundary-account',subscription_tier:'tier_4'};authMounts=0;
  delete window.__WEATHER_CAPABILITIES__;delete window.__FORCE_PREMIUM_TIER__;
  window.__MOCK_DATE_NOW__=Date.parse('2026-11-08T12:00:00Z');seed();
  popWaiters=[];window.addEventListener('popstate',observePop,true);
});
afterEach(()=>{window.removeEventListener('popstate',observePop,true);clearMapWeatherRouteMemory();delete window.__MOCK_DATE_NOW__;});

test('native Back/Forward retains the latest map layer/time across repeated private navigation',async()=>{
  render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Select forecast'}));
  fireEvent.click(screen.getByRole('link',{name:'Theme'}));await go(-1);
  expect(screen.getByLabelText('Selection')).toHaveTextContent('waves:4');
  await forward();await waitFor(()=>expect(screen.getByText('Theme destination')).toBeInTheDocument());
  await go(-1);expect(screen.getByLabelText('Selection')).toHaveTextContent('waves:4');
});
test('repeated Back at the entry boundary cannot reach the older outside entry',async()=>{
  render(<App/>);for(let i=0;i<3;i++){await protectedBack();expect(screen.getByLabelText('Current path')).toHaveTextContent('/map');}
  expect(screen.queryByText('Outside destination')).not.toBeInTheDocument();
});
test('a blocked boundary Back preserves Forward to the later private route',async()=>{
  render(<App/>);fireEvent.click(screen.getByRole('link',{name:'Theme'}));await go(-1);await protectedBack();
  expect(screen.getByText('Map destination')).toBeInTheDocument();await forward();
  await waitFor(()=>expect(screen.getByText('Theme destination')).toBeInTheDocument());
});
test('profile refresh with the same account does not append extra history entries',()=>{
  const view=render(<App/>),length=window.history.length;
  mockUser={...mockUser,display_name:'Refreshed profile'};view.rerender(<App/>);
  expect(window.history.length).toBe(length);
});
test('signed-in auth POP redirects to Feed without mounting the auth destination',async()=>{
  window.history.replaceState({key:'auth-entry',idx:0},'','/auth');window.history.pushState({key:'map-entry',idx:1},'','/map');
  render(<App/>);await go(-2);await waitFor(()=>expect(screen.getByLabelText('Current path')).toHaveTextContent('/feed'));
  expect(authMounts).toBe(0);
});
test('auth interception also respects a BrowserRouter basename',async()=>{
  window.history.replaceState({key:'auth-entry',idx:0},'','/local-ui/auth');window.history.pushState({key:'map-entry',idx:1},'','/local-ui/map');
  render(<App basename="/local-ui"/>);await go(-2);
  await waitFor(()=>expect(screen.getByLabelText('Current path')).toHaveTextContent('/feed'));expect(authMounts).toBe(0);
});
test('signed-out history is not guarded',async()=>{
  mockUser=null;render(<App/>);await go(-1);expect(screen.getByText('Outside destination')).toBeInTheDocument();
});
test('logout releases an existing boundary',async()=>{
  const view=render(<App/>);mockUser=null;view.rerender(<App/>);await go(-1);await go(-1);
  expect(screen.getByText('Outside destination')).toBeInTheDocument();
});
test('new account gets a boundary at its current route',async()=>{
  const view=render(<App/>);fireEvent.click(screen.getByRole('link',{name:'Theme'}));
  mockUser={id:'another-account',subscription_tier:'tier_4'};view.rerender(<App/>);
  await protectedBack();await protectedBack();expect(screen.getByText('Theme destination')).toBeInTheDocument();
});
test('remount on a private route reuses its boundary and keeps native Back/Forward',async()=>{
  const view=render(<App/>);fireEvent.click(screen.getByRole('link',{name:'Theme'}));const length=window.history.length;
  view.unmount();render(<App/>);expect(window.history.length).toBe(length);
  await go(-1);expect(screen.getByText('Map destination')).toBeInTheDocument();await forward();
  await waitFor(()=>expect(screen.getByText('Theme destination')).toBeInTheDocument());
});
test('StrictMode does not duplicate the boundary and preserves opaque router state',()=>{
  const original=window.history.state,length=window.history.length;render(<App strict/>);
  expect(window.history.length).toBe(length+1);expect(window.history.state).toMatchObject(original);
  expect(original).toEqual({usr:{reviewHint:'keep'},key:'map-entry',idx:1});
});

test('queued Back requests recover to the private boundary without mounting an outside route',async()=>{
  render(<App/>);
  await act(async()=>{const done=nextPops(2);window.history.back();window.history.back();await done;await tick();await tick();});
  await waitFor(()=>expect(screen.getByLabelText('Current path')).toHaveTextContent('/map'));
  expect(screen.queryByText('Outside destination')).not.toBeInTheDocument();
});
test('Back recovery does not remount the current map or lose its live selection',async()=>{
  render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Select forecast'}));
  const before=screen.getByLabelText('Selection');await protectedBack();
  expect(screen.getByLabelText('Selection')).toBe(before);
  expect(before).toHaveTextContent('waves:4');
});
