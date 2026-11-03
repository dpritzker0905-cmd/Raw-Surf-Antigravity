import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScheduledTab } from './ScheduledTab';

jest.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams()] }), {virtual:true});
jest.mock('../ui/card', () => ({Card: ({children}) => <div>{children}</div>,CardContent: ({children}) => <div>{children}</div>}), {virtual:true});
jest.mock('../ui/button', () => ({Button: require('react').forwardRef(({children,...props},ref) => <button ref={ref} {...props}>{children}</button>),buttonVariants:()=>''}), {virtual:true});
jest.mock('../ui/badge', () => ({Badge: ({children}) => <span>{children}</span>}), {virtual:true});
jest.mock('../BookingCard', () => ({BookingCard:()=>null}), {virtual:true});
jest.mock('../BookingSelfieModal', () => ({BookingSelfieModal:()=>null}), {virtual:true});
jest.mock('../../utils/media', () => ({getFullUrl:x=>x}), {virtual:true});
jest.mock('../../lib/utils', () => ({cn:(...x)=>x.filter(Boolean).join(' ')}), {virtual:true});

const deferred = () => { let resolve; const promise = new Promise(r => {resolve=r;});return {promise,resolve}; };
const data = (amount='25.12') => ({invite_id:'invite-a',booking_id:'booking-a',amount_credits:amount,quote:'a'.repeat(64),unit:'credits'});
const propsFor = () => ({user:{id:'user-a',access_token:'session-a'},scheduledBookings:[],crewInvites:[],
  pendingInvites:[{id:'invite-a',inviter_name:'Synthetic inviter',location:'Synthetic location',session_date:'2030-01-01'}],
  onRespondToInvite:jest.fn().mockResolvedValue({status:'quoted',quote:data()}),theme:'light'});
const open = async () => { await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Accept'}));}); };

it.each(['light','dark','beach'])('quotes before confirmation and shows server amount in %s',async theme=>{
  const props={...propsFor(),theme};render(<ScheduledTab {...props}/>);await open();
  expect(props.onRespondToInvite.mock.calls).toEqual([['invite-a',true,{quoteOnly:true}]]);
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Pay 25.12 credits and accept'})).toBeTruthy();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Cancel'}));});
  expect(props.onRespondToInvite).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('submits the exact commitment only after deliberate confirmation and prevents duplicate clicks',async()=>{
  const props=propsFor();const pending=deferred();props.onRespondToInvite.mockResolvedValueOnce({status:'quoted',quote:data()}).mockReturnValueOnce(pending.promise);
  render(<ScheduledTab {...props}/>);await open();const pay=screen.getByRole('button',{name:'Pay 25.12 credits and accept'});
  fireEvent.click(pay);fireEvent.click(pay);
  expect(props.onRespondToInvite.mock.calls).toEqual([['invite-a',true,{quoteOnly:true}],['invite-a',true,{consentQuote:'a'.repeat(64)}]]);
  await act(async()=>{pending.resolve({status:'accepted',amount_paid_credits:'25.12'});});
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('refreshes changed terms without automatically accepting the new amount',async()=>{
  const props=propsFor();props.onRespondToInvite.mockResolvedValueOnce({status:'quoted',quote:data()})
    .mockResolvedValueOnce({status:'changed',message:'Price changed. Review again.'})
    .mockResolvedValueOnce({status:'quoted',quote:data('30.00')});
  render(<ScheduledTab {...props}/>);await open();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Pay 25.12 credits and accept'}));});
  expect(screen.getByRole('button',{name:'Pay 30.00 credits and accept'})).toBeTruthy();
  expect(props.onRespondToInvite.mock.calls.filter(x=>x[2]?.consentQuote)).toHaveLength(1);
  expect(screen.getByText('Price changed. Review again.')).toBeTruthy();
});

it.each([null,{...data(),amount_credits:'NaN'},{...data(),invite_id:'other'}])('refuses a malformed or wrong-invite quote: %p',async quote=>{
  const props=propsFor();props.onRespondToInvite.mockResolvedValue({status:'quoted',quote});render(<ScheduledTab {...props}/>);await open();
  expect(screen.queryByRole('button',{name:/^Pay /})).toBeNull();
  expect(props.onRespondToInvite).toHaveBeenCalledTimes(1);
});

it.each([{id:'user-b',access_token:'session-b'},null,{id:'user-a',access_token:'replacement'}])('discards pending quotes on identity/session change: %p',async user=>{
  const props=propsFor();const pending=deferred();props.onRespondToInvite.mockReturnValue(pending.promise);
  const view=render(<ScheduledTab {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Accept'}));
  view.rerender(<ScheduledTab {...props} user={user}/>);
  await act(async()=>{pending.resolve({status:'quoted',quote:data()});});
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('discards closed and unmounted quote completions',async()=>{
  const props=propsFor();const pending=deferred();props.onRespondToInvite.mockReturnValue(pending.promise);
  const view=render(<ScheduledTab {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Accept'}));
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));view.unmount();
  await act(async()=>{pending.resolve({status:'quoted',quote:data()});});
  expect(props.onRespondToInvite).toHaveBeenCalledTimes(1);
});

it('closes when the selected invite disappears',async()=>{
  const props=propsFor();const view=render(<ScheduledTab {...props}/>);await open();
  view.rerender(<ScheduledTab {...props} pendingInvites={[]}/>);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('shows ambiguous/refused results without retrying the charge',async()=>{
  const props=propsFor();props.onRespondToInvite.mockResolvedValueOnce({status:'quoted',quote:data()})
    .mockResolvedValueOnce({status:'uncertain',message:'Check your bookings before trying again.'});
  render(<ScheduledTab {...props}/>);await open();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Pay 25.12 credits and accept'}));});
  expect(screen.queryByRole('button',{name:/^Pay /})).toBeNull();
  expect(screen.getByText('Check your bookings before trying again.')).toBeTruthy();
  expect(props.onRespondToInvite).toHaveBeenCalledTimes(2);
});

it('declines directly without a quote or payment confirmation',async()=>{
  const props=propsFor();render(<ScheduledTab {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Decline'}));
  expect(props.onRespondToInvite.mock.calls).toEqual([['invite-a',false]]);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('gives focus to Cancel and closes with Escape without paying',async()=>{
  const props=propsFor();render(<ScheduledTab {...props}/>);await open();
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Cancel'}));
  fireEvent.keyDown(document.activeElement,{key:'Escape',code:'Escape'});
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(props.onRespondToInvite).toHaveBeenCalledTimes(1);
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'Accept'})));
});

it('does not let an older invite quote replace the newly selected invite',async()=>{
  const props=propsFor();props.pendingInvites.push({...props.pendingInvites[0],id:'invite-b',inviter_name:'Second inviter'});
  const first=deferred();props.onRespondToInvite.mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({status:'quoted',quote:{...data('40.00'),invite_id:'invite-b'}});
  render(<ScheduledTab {...props}/>);fireEvent.click(screen.getAllByRole('button',{name:'Accept'})[0]);
  // Selection can also be changed by a caller while a quote is pending; closing invalidates its generation.
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  await act(async()=>{fireEvent.click(screen.getAllByRole('button',{name:'Accept'})[1]);});
  await act(async()=>{first.resolve({status:'quoted',quote:data()});});
  expect(screen.getByRole('button',{name:'Pay 40.00 credits and accept'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Pay 25.12 credits and accept'})).toBeNull();
});

it('keeps a pending charge visible through Cancel/Escape and preserves an uncertain result',async()=>{
  const props=propsFor();const pending=deferred();props.onRespondToInvite.mockResolvedValueOnce({status:'quoted',quote:data()})
    .mockReturnValueOnce(pending.promise);
  render(<ScheduledTab {...props}/>);await open();
  fireEvent.click(screen.getByRole('button',{name:'Pay 25.12 credits and accept'}));
  const cancel=screen.getByRole('button',{name:'Cancel'});expect(cancel.disabled).toBe(true);
  fireEvent.click(cancel);fireEvent.keyDown(cancel,{key:'Escape',code:'Escape'});
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  await act(async()=>{pending.resolve({status:'uncertain',message:'Payment unconfirmed. Check bookings.'});});
  expect(screen.getByText('Payment unconfirmed. Check bookings.')).toBeTruthy();
  expect(screen.queryByRole('button',{name:/^Pay /})).toBeNull();
  expect(props.onRespondToInvite).toHaveBeenCalledTimes(2);
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Cancel'}));});
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'Accept'})));
});

it('returns focus to the actual selected opener on Cancel',async()=>{
  const props=propsFor();props.pendingInvites.push({...props.pendingInvites[0],id:'invite-b'});
  props.onRespondToInvite.mockResolvedValueOnce({status:'quoted',quote:{...data(),invite_id:'invite-b'}});
  render(<ScheduledTab {...props}/>);const opener=screen.getAllByRole('button',{name:'Accept'})[1];
  await act(async()=>{fireEvent.click(opener);});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Cancel'}));});
  await waitFor(()=>expect(document.activeElement).toBe(opener));
});

it('returns focus to a connected Scheduled fallback when the invite opener disappears',async()=>{
  const props=propsFor();const view=render(<ScheduledTab {...props}/>);await open();
  await act(async()=>{view.rerender(<ScheduledTab {...props} pendingInvites={[]}/>);});
  expect(screen.queryByRole('alertdialog')).toBeNull();
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('heading',{name:'Scheduled bookings'})));
});

it('retains an uncertain payment outcome even if a list refresh removes its invite',async()=>{
  const props=propsFor();const pending=deferred();props.onRespondToInvite.mockResolvedValueOnce({status:'quoted',quote:data()})
    .mockReturnValueOnce(pending.promise);
  const view=render(<ScheduledTab {...props}/>);await open();
  fireEvent.click(screen.getByRole('button',{name:'Pay 25.12 credits and accept'}));
  view.rerender(<ScheduledTab {...props} pendingInvites={[]}/>);
  await act(async()=>{pending.resolve({status:'uncertain',message:'Check bookings before any retry.'});});
  expect(screen.getByText('Check bookings before any retry.')).toBeTruthy();
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Cancel'}));});
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('heading',{name:'Scheduled bookings'})));
});

it.each([false,true])('handles late accepted-row removal without stealing moved focus: moved=%p',async moved=>{
  const props=propsFor();const response=deferred();props.onRespondToInvite.mockResolvedValueOnce({status:'quoted',quote:data()})
    .mockReturnValueOnce(response.promise);
  const view=render(<><button>Other control</button><ScheduledTab {...props}/></>);await open();
  fireEvent.click(screen.getByRole('button',{name:'Pay 25.12 credits and accept'}));
  await act(async()=>{response.resolve({status:'accepted',amount_paid_credits:'25.12'});});
  await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'Accept'})));
  const other=screen.getByRole('button',{name:'Other control'});
  if(moved) other.focus();
  await act(async()=>{view.rerender(<><button>Other control</button><ScheduledTab {...props} pendingInvites={[]}/></>);});
  expect(document.activeElement).toBe(moved ? other : screen.getByRole('heading',{name:'Scheduled bookings'}));
});
