import React, {useRef} from 'react';
import {useMapChromeLayout} from './useMapChromeLayout';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as weatherClient from './backendWeatherServiceClient';

let mockTheme = 'dark';
const mockAnchor = Date.parse('2026-10-31T12:00:00Z');
const mockPayload = {
  available: true, events: [], source: 'model-msl',
  series: Array.from({ length: 72 }, (_, hour) => ({
    t: new Date(mockAnchor + hour * 3600000).toISOString(), h: hour / 10,
  })),
};
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../../hooks/useExactPointFetch', () => ({ useExactPointFetch: () => ({
  exactPoint: null, exactPointResponse: null, exactPointStatus: 'idle',
  setExactPointStatus: jest.fn(), setExactPointResponse: jest.fn(), setEstimateTrigger: jest.fn(),
}) }));
jest.mock('./usePointRating', () => ({ usePointRating: () => null }));
jest.mock('./marineDrawnFrame', () => ({ useMarineDrawnFrame: () => null }));
jest.mock('./usePointTide', () => ({ usePointTide: () => ({ status: 'ok', data: mockPayload }) }));
jest.mock('./heightUnits', () => ({ ...jest.requireActual('./heightUnits'), getHeightUnit: () => 'm' }));


// beforeEach runs after imports. Isolate the real resolver's startup request too,
// while retaining its real tier/window rules and every component under test.
const importRequests = [];
const { MapForecastOverlay } = (() => {
  const original = global.fetch;
  global.fetch = url => {
    importRequests.push(String(url));
    return Promise.reject(new Error('Offline UI test: capabilities not acquired'));
  };
  try { return require('./MapForecastOverlay'); }
  finally { global.fetch = original; }
})();
beforeAll(() => {
  expect(importRequests).toEqual([expect.stringMatching(/\/api\/weather\/capabilities$/)]);
});

const props = {
  activeLayer: 'waves', activeModel: 'GFS', currentWeather: {}, forecastData: null,
  marineData: null, longPressLocation: { lat: 28.34, lng: -80.58 }, timeOffsetHours: 0,
};
beforeEach(() => {
  jest.spyOn(weatherClient, 'getSeriesAnchorMs').mockReturnValue(mockAnchor);
});
afterEach(() => {
  jest.restoreAllMocks();
  delete window.__RAW_DISABLE_INFOBOX_TIDE__;
});

const originalResizeObserver=global.ResizeObserver;
const originalMutationObserver=global.MutationObserver;
let resize, scheduled, mapHeight, timelineTop, oldFont;
function Chrome(){
  const ref=useRef(null);useMapChromeLayout(ref);
  return <><button>Outside weather</button><div ref={ref} data-responsive-weather="true" data-testid="chrome-root">
    <div className="top-rail-container"/><div data-weather-timeline="mobile"/>
    <MapForecastOverlay {...props}/>
  </div></>;
}
beforeEach(()=>{
  mockTheme='dark';mapHeight=800;timelineTop=600;oldFont=document.documentElement.style.fontSize;
  document.documentElement.style.fontSize='16px';
  global.ResizeObserver=jest.fn(callback=>{resize=callback;return {observe:jest.fn(),disconnect:jest.fn()};});
  global.MutationObserver=jest.fn(()=>({observe:jest.fn(),disconnect:jest.fn()}));
  jest.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{scheduled=callback;return 1;});
  jest.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
  jest.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(){
    if(this.dataset.testid==='chrome-root')return {width:568,height:mapHeight,top:0,bottom:mapHeight};
    if(this.classList.contains('top-rail-container'))return {width:568,height:100,top:0,bottom:100};
    if(this.hasAttribute('data-weather-timeline'))return {width:568,height:100,top:timelineTop,bottom:timelineTop+100};
    return {width:0,height:0,top:0,bottom:0};
  });
});
afterEach(()=>{cleanup();global.ResizeObserver=originalResizeObserver;global.MutationObserver=originalMutationObserver;document.documentElement.style.fontSize=oldFont;});
const compactReflow=()=>{
  mapHeight=264;timelineTop=160;document.documentElement.style.fontSize='32px';
  act(()=>resize());act(()=>scheduled());
};

test.each(['light','dark','beach'])('%s compact reflow moves hidden-header focus to Details and Escape from the real tide curve returns it',theme=>{
  mockTheme=theme;render(<Chrome/>);
  const root=screen.getByTestId('chrome-root');expect(root).toHaveAttribute('data-point-details-compact','false');
  const header=document.querySelector('.weather-point-header');header.focus();expect(header).toHaveFocus();
  const tide=screen.getByRole('group',{name:'Tide',exact:true});const text=tide.textContent;
  compactReflow();
  const details=screen.getByRole('button',{name:'Forecast details',exact:true});
  expect(root).toHaveAttribute('data-point-details-compact','true');expect(details).toHaveFocus();
  expect(details).toHaveAttribute('aria-expanded','false');expect(tide.textContent).toBe(text);
  fireEvent.click(details);
  const curve=within(tide).getByRole('img');curve.focus();expect(curve).toHaveFocus();
  fireEvent.keyDown(curve,{key:'Escape'});
  expect(details).toHaveFocus();expect(details).toHaveAttribute('aria-expanded','false');expect(tide.textContent).toBe(text);
});

test('a reading area already opened by the user retains real curve focus through compact reflow',()=>{
  render(<Chrome/>);fireEvent.click(screen.getByRole('button',{name:'Forecast details',exact:true}));
  const curve=within(screen.getByRole('group',{name:'Tide',exact:true})).getByRole('img');
  curve.scrollIntoView=jest.fn();curve.focus();compactReflow();
  expect(screen.getByTestId('chrome-root')).toHaveAttribute('data-point-details-compact','true');
  expect(screen.getByRole('button',{name:'Close forecast details',exact:true})).toHaveAttribute('aria-expanded','true');
  expect(curve).toHaveFocus();expect(curve.scrollIntoView).toHaveBeenCalledWith({block:'nearest',inline:'nearest'});
});

test('compact reflow does not steal focus from outside the forecast card',()=>{
  render(<Chrome/>);const outside=screen.getByRole('button',{name:'Outside weather'});outside.focus();compactReflow();
  expect(screen.getByTestId('chrome-root')).toHaveAttribute('data-point-details-compact','true');expect(outside).toHaveFocus();
});
