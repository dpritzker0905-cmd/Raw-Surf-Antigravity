import React from 'react';
import {act, cleanup, render, screen} from '@testing-library/react';
import {usePointTide, clearPointTideCache} from './usePointTide';

const originalFetch=global.fetch;
const START=Date.parse('2026-11-07T12:00:00Z');
const ok=height=>({ok:true,json:()=>Promise.resolve({available:true,height_m:height})});
function Probe({lat=1,lng=2}){
  const tide=usePointTide(lat,lng);
  return <output aria-label="Tide result">{tide.status}:{tide.data?.height_m??'none'}</output>;
}
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const advance=ms=>act(async()=>{jest.advanceTimersByTime(ms);await settle();});
beforeEach(()=>{clearPointTideCache();jest.useFakeTimers('modern');jest.setSystemTime(START);});
afterEach(()=>{cleanup();jest.clearAllTimers();jest.useRealTimers();clearPointTideCache();global.fetch=originalFetch;});

test.each(['unavailable','http503','network','abort'])('%s miss recovers at exactly30seconds with the same observer and no interaction',async failure=>{
  const fetcher=jest.fn();
  if(failure==='network'||failure==='abort')fetcher.mockRejectedValueOnce(Object.assign(new Error('transient'),{name:failure==='abort'?'AbortError':'Error'}));
  else fetcher.mockResolvedValueOnce(failure==='http503'?{ok:false,status:503}:{ok:true,json:()=>Promise.resolve({available:false})});
  global.fetch=fetcher.mockResolvedValue(ok(2));
  render(<Probe/>);await advance(0);
  const observer=screen.getByLabelText('Tide result');expect(observer).toHaveTextContent('unavailable:none');
  await advance(29999);expect(fetcher).toHaveBeenCalledTimes(1);
  await advance(1);expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText('Tide result')).toBe(observer);expect(observer).toHaveTextContent('ok:2');
});

test('an old cell abort after a new cell success cannot replace it or schedule an old-cell retry',async()=>{
  let rejectOld;
  global.fetch=jest.fn().mockImplementationOnce(()=>new Promise((resolve,reject)=>{rejectOld=reject;})).mockResolvedValue(ok(3));
  const view=render(<Probe/>);await advance(0);
  view.rerender(<Probe lat={3} lng={4}/>);await advance(0);
  expect(screen.getByLabelText('Tide result')).toHaveTextContent('ok:3');
  await advance(10000);
  await act(async()=>{rejectOld(Object.assign(new Error('old transport cancelled'),{name:'AbortError'}));await settle();});
  await advance(30000);
  expect(screen.getByLabelText('Tide result')).toHaveTextContent('ok:3');expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('an unmounted in-flight miss cannot poll; a later observer can retry after its completion-based expiry',async()=>{
  let finishOld;
  global.fetch=jest.fn().mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;})).mockResolvedValue(ok(4));
  const view=render(<Probe/>);await advance(0);view.unmount();await advance(10000);
  await act(async()=>{finishOld({ok:false,status:503});await settle();});
  await advance(30000);expect(global.fetch).toHaveBeenCalledTimes(1);
  render(<Probe/>);await advance(0);
  expect(global.fetch).toHaveBeenCalledTimes(2);expect(screen.getByLabelText('Tide result')).toHaveTextContent('ok:4');
});

test('a late successful expiry retry for the old cell cannot replace a newer cell',async()=>{
  let finishRetry;
  global.fetch=jest.fn().mockResolvedValueOnce({ok:true,json:()=>Promise.resolve({available:false})})
    .mockImplementationOnce(()=>new Promise(resolve=>{finishRetry=resolve;})).mockResolvedValue(ok(5));
  const view=render(<Probe/>);await advance(0);await advance(30000);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  view.rerender(<Probe lat={3} lng={4}/>);await advance(0);
  expect(screen.getByLabelText('Tide result')).toHaveTextContent('ok:5');
  await act(async()=>{finishRetry(ok(9));await settle();});await advance(30000);
  expect(screen.getByLabelText('Tide result')).toHaveTextContent('ok:5');expect(global.fetch).toHaveBeenCalledTimes(3);
});

test.each([false,true])('background polling pauses and resumes at the original cache deadline (hidden mount=%s)',async hiddenAtMount=>{
  let hidden=hiddenAtMount;
  const visibility=jest.spyOn(document,'visibilityState','get').mockImplementation(()=>hidden?'hidden':'visible');
  const change=async value=>{hidden=value;await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));await settle();});};
  try {
    global.fetch=jest.fn().mockResolvedValueOnce({ok:true,json:()=>Promise.resolve({available:false})}).mockResolvedValue(ok(6));
    const view=render(<Probe/>);await advance(0);
    expect(global.fetch).toHaveBeenCalledTimes(hiddenAtMount?0:1);
    if(hiddenAtMount){await change(false);expect(global.fetch).toHaveBeenCalledTimes(1);}
    await change(true);await advance(120000);expect(global.fetch).toHaveBeenCalledTimes(1);
    await change(false);expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Tide result')).toHaveTextContent('ok:6');
    await advance(299999);expect(global.fetch).toHaveBeenCalledTimes(2);
    view.unmount();await change(true);await change(false);await advance(300001);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  } finally {visibility.mockRestore();}
});
