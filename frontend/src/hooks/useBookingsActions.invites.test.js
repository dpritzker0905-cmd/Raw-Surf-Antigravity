import React, { Suspense, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { act, renderHook } from '@testing-library/react';
import useBookingsActions from './useBookingsActions';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';

jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const identity = (id = 'synthetic-a', session = 'synthetic-session-a') => ({ id, access_token: session });
const row = (id = 'synthetic-current', overrides = {}) => ({
  id, booking_id: 'synthetic-booking', inviter_name: 'Synthetic inviter', inviter_avatar: null,
  location: 'Synthetic location', session_date: '2030-02-01T12:00:00Z', photographer_name: null,
  message: null, created_at: '2030-01-01T00:00:00Z', ...overrides,
});
const invitePath = path => path.startsWith('/bookings/invites/');
let reads;
const options = user => ({
  user, updateUser: jest.fn(), setUserCreditBalance: jest.fn(), setLoading: jest.fn(),
  setBookings: jest.fn(), setLiveSessions: jest.fn(), setSessionHistory: jest.fn(),
  setLivePhotographers: jest.fn(), setPendingInvites: jest.fn(), setCrewInvites: jest.fn(),
  setActiveDispatch: jest.fn(), setNearbyBookings: jest.fn(),
});
const mount = (user = identity()) => {
  const props = options(user);
  const hook = renderHook(p => useBookingsActions(p), { initialProps: props });
  props.setPendingInvites.mockClear();
  return { ...hook, props };
};
const start = result => { let pending; act(() => { pending = result.current.fetchData(); }); return pending; };
const settle = async (read, data, pending) => { await act(async () => { read.resolve({ data }); await pending; }); };

beforeEach(() => {
  jest.clearAllMocks(); reads = [];
  apiClient.get.mockImplementation(path => {
    if (invitePath(path)) { const read = deferred(); reads.push(read); return read.promise; }
    if (path.startsWith('/credits/')) return Promise.resolve({data:{user_id:'synthetic-a',balance:0}});
    return Promise.resolve({ data: [] });
  });
  apiClient.post.mockResolvedValue({ data:{status:'accepted',amount_paid:25,new_balance:75,amount_paid_credits:'25.00'} });
});

it('keeps the registered invite URL and all other resource requests with no payment or auth override', async () => {
  const { result, props } = mount(); const pending = start(result);
  expect(apiClient.get.mock.calls.map(([path]) => path)).toEqual([
    '/credits/balance/synthetic-a','/bookings/user/synthetic-a','/sessions/user/synthetic-a',
    '/photographers/live','/bookings/invites/synthetic-a','/dispatch/user/synthetic-a/crew-invites',
    '/dispatch/user/synthetic-a/active','/sessions/user/synthetic-a/history',
  ]);
  expect(apiClient.get.mock.calls.every(call => call.length === 1)).toBe(true);
  await settle(reads[0], [row()], pending);
  expect(props.setPendingInvites.mock.calls).toEqual([[[row()]]]);
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('publishes a genuine empty recipient list', async () => {
  const { result, props } = mount(); const pending = start(result);
  await settle(reads[0], [], pending);
  expect(props.setPendingInvites.mock.calls).toEqual([[[]]]);
});

it('does not let an old account response overwrite the current recipient', async () => {
  const { result, rerender, props } = mount(); const old = start(result);
  rerender({...props,user:identity('synthetic-b','synthetic-session-b')});
  props.setPendingInvites.mockClear(); const current = start(result);
  await settle(reads[1], [row('b-current')], current);
  await settle(reads[0], [row('a-stale')], old);
  expect(props.setPendingInvites.mock.calls).toEqual([[[row('b-current')]]]);
});

it.each([[null],[identity('synthetic-a','synthetic-replacement-session')]])('invalidates old reads on logout or same-ID session replacement: %p', async user => {
  const { result, rerender, props } = mount(); const old = start(result);
  rerender({...props,user}); props.setPendingInvites.mockClear();
  await settle(reads[0], [row('stale')], old);
  expect(props.setPendingInvites).not.toHaveBeenCalled();
});

it('clears loaded private rows at ownership change before the next read finishes', async () => {
  const { result, rerender, props } = mount(); const pending = start(result);
  await settle(reads[0], [row('a-loaded')], pending);
  props.setPendingInvites.mockClear();
  rerender({...props,user:identity('synthetic-b','synthetic-session-b')});
  expect(props.setPendingInvites.mock.calls).toEqual([[[]]]);
});

it('accepts only the latest request when responses finish backwards', async () => {
  const { result, props } = mount(); const old = start(result); const latest = start(result);
  await settle(reads[1], [row('latest')], latest);
  await settle(reads[0], [row('old')], old);
  expect(props.setPendingInvites.mock.calls).toEqual([[[row('latest')]]]);
});

it.each([401,403,404,500])('clears on a current HTTP %i failure and never resurrects an older response', async status => {
  const { result, props } = mount(); const old = start(result); const latest = start(result);
  await act(async () => { reads[1].reject({response:{status}}); await latest; });
  await settle(reads[0], [row('old')], old);
  expect(props.setPendingInvites.mock.calls).toEqual([[[]]]);
});

it.each([[null],[{}],['bad'],[[null]],[[{id:'missing-fields'}]],[[row('bad',{message:3})]]])('never publishes a malformed list: %p', async data => {
  const { result, props } = mount(); const pending = start(result);
  await settle(reads[0], data, pending);
  expect(props.setPendingInvites.mock.calls).toEqual([[[]]]);
});

it('does not issue an invite read through a captured old-owner action', async () => {
  const { result, rerender, props } = mount(); const action = result.current.fetchData;
  rerender({...props,user:identity('synthetic-b','synthetic-session-b')});
  let pending; act(() => { pending = action(); });
  const inviteCalls = apiClient.get.mock.calls.filter(([path]) => invitePath(path));
  if (reads[0]) await settle(reads[0], [row('old')], pending);
  else await act(async () => { await pending; });
  expect(inviteCalls).toEqual([]);
});

it('uses the latest committed setter without restarting an unchanged session', async () => {
  const { result, rerender, props } = mount(); const pending = start(result); const currentSetter = jest.fn();
  rerender({...props,user:{...props.user,display_name:'Current profile'},setPendingInvites:currentSetter});
  await settle(reads[0], [row()], pending);
  expect(props.setPendingInvites).not.toHaveBeenCalled();
  expect(currentSetter).toHaveBeenCalledWith([row()]);
});

it('does not write private invites after unmount', async () => {
  const { result, unmount, props } = mount(); const pending = start(result); unmount();
  await settle(reads[0], [row()], pending);
  expect(props.setPendingInvites).not.toHaveBeenCalled();
});

it('works after StrictMode setup and cleanup', async () => {
  const props = options(identity());
  const { result } = renderHook(p => useBookingsActions(p), { initialProps:props, wrapper:React.StrictMode });
  props.setPendingInvites.mockClear(); const pending = start(result);
  await settle(reads[0], [row()], pending);
  expect(props.setPendingInvites.mock.calls).toEqual([[[row()]]]);
});

it('preserves committed ownership and setter when another render suspends and is abandoned', async () => {
  const props = options(identity()); const abandonedSetter = jest.fn(); let actions;
  function Probe({ input, suspend }) {
    const next = useBookingsActions(input);
    useLayoutEffect(() => { actions = next; });
    if (suspend) throw new Promise(() => {});
    return null;
  }
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  const tree = (input,suspend) => React.createElement(Suspense,{fallback:null},React.createElement(Probe,{input,suspend}));
  try {
    await act(async () => root.render(tree(props,false))); props.setPendingInvites.mockClear(); let pending;
    act(() => { pending = actions.fetchData(); });
    await act(async () => { React.startTransition(() => root.render(tree({...props,user:identity('synthetic-b','synthetic-session-b'),setPendingInvites:abandonedSetter},true))); });
    await settle(reads[0], [row('committed')], pending);
    expect(props.setPendingInvites).toHaveBeenCalledWith([row('committed')]);
    expect(abandonedSetter).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it('rechecks ownership after the invite response waits behind another aggregate read', async () => {
  const other = deferred(); const get = apiClient.get.getMockImplementation();
  apiClient.get.mockImplementation(path => path === '/bookings/user/synthetic-a' ? other.promise : get(path));
  const { result, rerender, props } = mount(); const pending = start(result);
  await act(async () => { reads[0].resolve({data:[row('old')]}); await Promise.resolve(); });
  rerender({...props,user:identity('synthetic-b','synthetic-session-b')}); props.setPendingInvites.mockClear();
  await act(async () => { other.resolve({data:[]}); await pending; });
  expect(props.setPendingInvites).not.toHaveBeenCalled();
});

it('does not revive an earlier A lifetime after A to B to A', async () => {
  const { result, rerender, props } = mount(); const old = start(result);
  rerender({...props,user:identity('synthetic-b','synthetic-session-b')}); rerender(props);
  props.setPendingInvites.mockClear(); const latest = start(result);
  await settle(reads[1], [row('new-a')], latest); await settle(reads[0], [row('old-a')], old);
  expect(props.setPendingInvites.mock.calls).toEqual([[[row('new-a')]]]);
});

it.each([true,false])('preserves the existing response action and its successful refetch: accept=%p', async accept => {
  const { result } = mount();
  await act(async () => { await result.current.handleRespondToInvite('synthetic-invite-id',accept,accept ? {consentQuote:'a'.repeat(64)} : {}); });
  expect(apiClient.post.mock.calls).toEqual([[`/bookings/invites/synthetic-invite-id/respond?accept=${accept}${accept ? '&consent_quote=' + 'a'.repeat(64) : ''}`]]);
  expect(toast.success).toHaveBeenCalledWith(accept ? 'Invite accepted! Paid 25.00 credits' : 'Invite declined');
  expect(reads).toHaveLength(1);
  await settle(reads[0], []);
});

it('keeps response errors separate from a list read or success state', async () => {
  const { result } = mount(); apiClient.post.mockRejectedValueOnce({response:{data:{detail:'Synthetic refusal'}}});
  await act(async () => { await result.current.handleRespondToInvite('synthetic-invite-id',true,{consentQuote:'a'.repeat(64)}); });
  expect(toast.error).toHaveBeenCalledWith('Synthetic refusal');
  expect(toast.success).not.toHaveBeenCalled(); expect(apiClient.get).not.toHaveBeenCalled();
});

const consentOptions = {consentQuote:'a'.repeat(64)};
it('loads a quote without mutation, success toast, or aggregate refetch', async () => {
  const {result}=mount();apiClient.get.mockResolvedValueOnce({data:{invite_id:'invite-a',quote:'a'.repeat(64)}});
  let response;await act(async()=>{response=await result.current.handleRespondToInvite('invite-a',true,{quoteOnly:true});});
  expect(response.status).toBe('quoted');
  expect(apiClient.get.mock.calls).toEqual([['/bookings/invites/invite-a/accept-quote']]);
  expect(apiClient.post).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();
});

it.each([undefined,{}, {consentQuote:'bad'}])('refuses unconfirmed acceptance in the hook: %p',async options=>{
  const {result}=mount();await act(async()=>{await result.current.handleRespondToInvite('invite-a',true,options);});
  expect(apiClient.post).not.toHaveBeenCalled();expect(apiClient.get).not.toHaveBeenCalled();
});

it('suppresses duplicate mutations while a confirmed action is pending',async()=>{
  const {result}=mount();const response=deferred();apiClient.post.mockReturnValueOnce(response.promise);
  let first;act(()=>{first=result.current.handleRespondToInvite('invite-a',true,consentOptions);});
  await act(async()=>{await result.current.handleRespondToInvite('invite-a',true,consentOptions);});
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  await act(async()=>{response.resolve({data:{status:'accepted',amount_paid_credits:'25.12'}});await first;});
  expect(toast.success).toHaveBeenCalledWith('Invite accepted! Paid 25.12 credits');
  await settle(reads[0],[]);
});

it.each([null,503])('does not retry an ambiguous financial failure or reopen payment: %p',async status=>{
  const {result}=mount();apiClient.post.mockRejectedValueOnce(status ? {response:{status}} : new Error('Synthetic reset'));
  let outcome;await act(async()=>{outcome=await result.current.handleRespondToInvite('invite-a',true,consentOptions);});
  expect(outcome.status).toBe('uncertain');
  await act(async()=>{
    await result.current.handleRespondToInvite('invite-a',true,consentOptions);
    outcome=await result.current.handleRespondToInvite('invite-a',true,{quoteOnly:true});
  });
  expect(outcome.status).toBe('uncertain');expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.get).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();
});

it('returns amount conflict without automatic quote or payment retry',async()=>{
  const {result}=mount();apiClient.post.mockRejectedValueOnce({response:{status:409}});
  let outcome;await act(async()=>{outcome=await result.current.handleRespondToInvite('invite-a',true,consentOptions);});
  expect(outcome.status).toBe('changed');expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.get).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();
});

it.each([null,{status:'accepted',amount_paid_credits:'NaN'},{status:'pending',amount_paid_credits:'25.00'}])('treats malformed success as uncertain: %p',async data=>{
  const {result}=mount();apiClient.post.mockResolvedValueOnce({data});let outcome;
  await act(async()=>{outcome=await result.current.handleRespondToInvite('invite-a',true,consentOptions);});
  expect(outcome.status).toBe('uncertain');expect(toast.success).not.toHaveBeenCalled();expect(apiClient.get).not.toHaveBeenCalled();
});

it.each(['quote','mutation'])('discards old-session %s completions without success or refetch',async kind=>{
  const {result,props,rerender}=mount();const response=deferred();
  if(kind==='quote')apiClient.get.mockReturnValueOnce(response.promise);else apiClient.post.mockReturnValueOnce(response.promise);
  let pending;act(()=>{pending=result.current.handleRespondToInvite('invite-a',true,kind==='quote'?{quoteOnly:true}:consentOptions);});
  rerender({...props,user:identity('synthetic-b','other-session')});let outcome;
  await act(async()=>{response.resolve({data:{status:'accepted',amount_paid_credits:'25.12'}});outcome=await pending;});
  expect(outcome.status).toBe('stale');expect(toast.success).not.toHaveBeenCalled();
  expect(apiClient.get).toHaveBeenCalledTimes(kind==='quote'?1:0);
});
