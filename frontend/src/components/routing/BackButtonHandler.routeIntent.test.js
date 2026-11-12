import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
jest.mock('react-router-dom', () => jest.requireActual('../../../node_modules/react-router-dom/dist/index.js'), { virtual: true });
jest.mock('react-router/dom', () => jest.requireActual('../../../node_modules/react-router/dist/development/dom-export.js'), { virtual: true });
const { TextEncoder, TextDecoder } = require('util');
if (!global.TextEncoder) global.TextEncoder = TextEncoder;
if (!global.TextDecoder) global.TextDecoder = TextDecoder;
const { BrowserRouter, Routes, Route, Link } = require('react-router-dom');
let mockUser = { id: 'route-account', subscription_tier: 'tier_4' };
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
const originalFetch = global.fetch;
global.fetch = () => Promise.reject(new Error('Offline routing regression'));
const { BackButtonHandler } = require('./AppLayout');
const { default: useMapWeatherRouteMemory, clearMapWeatherRouteMemory } = require('../map/useMapWeatherRouteMemory');
global.fetch = originalFetch;
function MapView() {
  const [layers,setLayers] = useState([]);
  const [hour,setHour] = useState(0);
  useMapWeatherRouteMemory({user:mockUser,activeModel:'GFS',activeLayers:layers,timeOffsetHours:hour,setActiveLayers:setLayers,setTimeOffsetHours:setHour});
  return <><output aria-label="Selection">{layers[0] || 'none'}:{hour}</output>
    <button onClick={()=>{setLayers(['waves']);setHour(4);}}>Select forecast</button><Link to="/theme">Theme</Link></>;
}
function App(){return <BrowserRouter><BackButtonHandler/><Routes><Route path="/map" element={<MapView/>}/><Route path="/theme" element={<p>Theme destination</p>}/></Routes></BrowserRouter>;}
beforeEach(()=>{
  clearMapWeatherRouteMemory(); mockUser={id:'route-account',subscription_tier:'tier_4'};
  delete window.__WEATHER_CAPABILITIES__; delete window.__FORCE_PREMIUM_TIER__;
  window.__MOCK_DATE_NOW__=Date.parse('2026-11-08T12:00:00Z');
  window.history.replaceState({usr:{reviewHint:'keep'},key:'map-entry',idx:0},'','/map');
});
afterEach(()=>{clearMapWeatherRouteMemory();delete window.__MOCK_DATE_NOW__;});
test('guard preserves opaque router entry state without mutating the original object',()=>{
  const prior=window.history.state;
  render(<App/>);
  expect(window.history.state).toMatchObject(prior);
  expect(prior).toEqual({usr:{reviewHint:'keep'},key:'map-entry',idx:0});
});
test('first browser Back through the real shell guard restores map forecast intent',async()=>{
  render(<App/>);fireEvent.click(screen.getByRole('button',{name:'Select forecast'}));
  fireEvent.click(screen.getByRole('link',{name:'Theme'}));
  expect(screen.getByText('Theme destination')).toBeInTheDocument();
  await act(async()=>{window.history.back();});
  await waitFor(()=>expect(screen.getByLabelText('Selection')).toHaveTextContent('waves:4'));
});
