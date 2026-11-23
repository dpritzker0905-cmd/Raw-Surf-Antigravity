import React, { Suspense, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { act, renderHook } from '@testing-library/react';
import useBookingsActions from './useBookingsActions';
import apiClient from '../lib/apiClient';

jest.mock('../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const identity = (id = 'synthetic-a', session = 'synthetic-session-a') => ({ id, access_token: session });
const response = (balance, id = 'synthetic-a') => ({ data: { user_id: id, balance, currency: 'credits' } });
const balancePath = path => path.startsWith('/credits/');
let balanceReads;
const options = user => ({
 user, updateUser: jest.fn(), setUserCreditBalance: jest.fn(), setLoading: jest.fn(),
 setBookings: jest.fn(), setLiveSessions: jest.fn(), setSessionHistory: jest.fn(),
 setLivePhotographers: jest.fn(), setPendingInvites: jest.fn(), setCrewInvites: jest.fn(),
 setActiveDispatch: jest.fn(), setNearbyBookings: jest.fn(),
});
const mount = (user = identity()) => {
 const props = options(user);
 const hook = renderHook(p => useBookingsActions(p), { initialProps: props });
 props.setUserCreditBalance.mockClear(); // Ignore lifecycle clearing, which is not an authoritative read.
 return { ...hook, props };
};
const start = result => { let promise; act(() => { promise = result.current.fetchData(); }); return promise; };
const settle = async (read, value, pending) => { await act(async () => { read.resolve(value); await pending; }); };

beforeEach(() => {
 jest.clearAllMocks();
 balanceReads = [];
 apiClient.get.mockImplementation(path => {
  if (balancePath(path)) { const read = deferred(); balanceReads.push(read); return read.promise; }
  return Promise.resolve({ data: [] });
 });
});

it('uses the registered balance read and preserves all seven other resource requests', async () => {
 const { result, props } = mount();
 const pending = start(result);
 expect(apiClient.get.mock.calls.map(([path]) => path)).toEqual([
  '/credits/balance/synthetic-a', '/bookings/user/synthetic-a', '/sessions/user/synthetic-a',
  '/photographers/live', '/bookings/invites/synthetic-a', '/dispatch/user/synthetic-a/crew-invites',
  '/dispatch/user/synthetic-a/active', '/sessions/user/synthetic-a/history',
 ]);
 expect(apiClient.get.mock.calls.every(call => call.length === 1)).toBe(true);
 await settle(balanceReads[0], response(0), pending);
 expect(props.setUserCreditBalance).toHaveBeenCalledWith(0);
 expect(props.updateUser).toHaveBeenCalledWith({ credit_balance: 0 });
 expect(props.setBookings).toHaveBeenCalledWith([]);
 expect(props.setLiveSessions).toHaveBeenCalledWith([]);
 expect(props.setLivePhotographers).toHaveBeenCalledWith([]);
 expect(props.setPendingInvites).toHaveBeenCalledWith([]);
 expect(props.setCrewInvites).toHaveBeenCalledWith([]);
 expect(props.setActiveDispatch).toHaveBeenCalledWith(null);
 expect(props.setSessionHistory).toHaveBeenCalledWith([]);
 expect(props.setLoading.mock.calls).toEqual([[true], [false]]);
 expect(apiClient.post).not.toHaveBeenCalled();
});

it('does not publish a response for the previous committed account', async () => {
 const { result, rerender, props } = mount();
 const pending = start(result);
 rerender({ ...props, user: identity('synthetic-b', 'synthetic-session-b') });
 props.setUserCreditBalance.mockClear();
 await settle(balanceReads[0], response(71), pending);
 expect(props.setUserCreditBalance).not.toHaveBeenCalled();
 expect(props.updateUser).not.toHaveBeenCalled();
});

it.each([null, identity('synthetic-a', 'synthetic-replacement-session')])('invalidates a pending read on logout or same-ID session replacement: %p', async user => {
 const { result, rerender, props } = mount();
 const pending = start(result);
 rerender({ ...props, user });
 props.setUserCreditBalance.mockClear();
 await settle(balanceReads[0], response(71), pending);
 expect(props.setUserCreditBalance).not.toHaveBeenCalled();
 expect(props.updateUser).not.toHaveBeenCalled();
});

it('clears already stored local balance when ownership changes, without inventing a profile zero', async () => {
 const { result, rerender, props } = mount();
 const pending = start(result);
 await settle(balanceReads[0], response(71), pending);
 expect(props.setUserCreditBalance).toHaveBeenLastCalledWith(71);
 props.updateUser.mockClear();
 rerender({ ...props, user: identity('synthetic-b', 'synthetic-session-b') });
 expect(props.setUserCreditBalance).toHaveBeenLastCalledWith(0);
 expect(props.updateUser).not.toHaveBeenCalled();
});

it('accepts only the newest request when two reads finish in reverse order', async () => {
 const { result, props } = mount();
 const old = start(result); const latest = start(result);
 await settle(balanceReads[1], response(9), latest);
 await settle(balanceReads[0], response(71), old);
 expect(props.setUserCreditBalance.mock.calls).toEqual([[9]]);
 expect(props.updateUser.mock.calls).toEqual([[{ credit_balance: 9 }]]);
});

it.each([401,403,404,500])('does not convert a newer HTTP %i rejection into an older successful balance', async status => {
 const { result, props } = mount();
 const old = start(result); const latest = start(result);
 await act(async () => { balanceReads[1].reject({ response: { status } }); await latest; });
 await settle(balanceReads[0], response(71), old);
 expect(props.setUserCreditBalance).not.toHaveBeenCalled();
 expect(props.updateUser).not.toHaveBeenCalled();
});

it.each([null, {}, {user_id:'synthetic-b',balance:7}, {balance:7}, {user_id:'synthetic-a',balance:null},
 {user_id:'synthetic-a',balance:'7'}, {user_id:'synthetic-a',balance:NaN}, {user_id:'synthetic-a',balance:Infinity},
 {user_id:'synthetic-a',balance:true}])('does not publish malformed or wrongly bound balance data: %p', async data => {
 const { result, props } = mount(); const pending = start(result);
 await settle(balanceReads[0], { data }, pending);
 expect(props.setUserCreditBalance).not.toHaveBeenCalled();
 expect(props.updateUser).not.toHaveBeenCalled();
});

it('does not issue a balance read from a captured old-owner action', async () => {
 const { result, rerender, props } = mount(); const oldAction = result.current.fetchData;
 rerender({ ...props, user: identity('synthetic-b', 'synthetic-session-b') });
 let pending; act(() => { pending = oldAction(); });
 const paths = apiClient.get.mock.calls.filter(([path]) => balancePath(path));
 if (balanceReads[0]) await settle(balanceReads[0], response(71), pending);
 else await act(async () => { await pending; });
 expect(paths).toEqual([]);
});

it('uses the latest committed callback for an unchanged session', async () => {
 const { result, rerender, props } = mount(); const pending = start(result);
 const currentUpdate = jest.fn();
 rerender({ ...props, user: {...props.user, display_name: 'synthetic current profile'}, updateUser: currentUpdate });
 await settle(balanceReads[0], response(8), pending);
 expect(props.updateUser).not.toHaveBeenCalled();
 expect(currentUpdate).toHaveBeenCalledWith({ credit_balance: 8 });
});

it('drops balance publications after unmount', async () => {
 const { result, unmount, props } = mount(); const pending = start(result); unmount();
 await settle(balanceReads[0], response(8), pending);
 expect(props.setUserCreditBalance).not.toHaveBeenCalled(); expect(props.updateUser).not.toHaveBeenCalled();
});

it('continues to read normally after StrictMode effect cleanup and setup', async () => {
 const props = options(identity());
 const { result } = renderHook(p => useBookingsActions(p), { initialProps: props, wrapper: React.StrictMode });
 props.setUserCreditBalance.mockClear(); const pending = start(result);
 await settle(balanceReads[0], response(0), pending);
 expect(props.setUserCreditBalance.mock.calls).toEqual([[0]]);
 expect(props.updateUser).toHaveBeenCalledWith({ credit_balance: 0 });
});

it('does not change committed ownership or callbacks from a suspended abandoned render', async () => {
 const props = options(identity()); const abandonedUpdate = jest.fn();
 let actions;
 function Probe({ input, suspend }) {
  const next = useBookingsActions(input);
  useLayoutEffect(() => { actions = next; });
  if (suspend) throw new Promise(() => {});
  return null;
 }
 const container = document.createElement('div'); document.body.appendChild(container);
 const root = createRoot(container);
 const tree = (input, suspend) => React.createElement(Suspense, { fallback:null }, React.createElement(Probe, {input,suspend}));
 try {
  await act(async () => { root.render(tree(props, false)); });
  props.setUserCreditBalance.mockClear(); let pending;
  act(() => { pending = actions.fetchData(); });
  await act(async () => { React.startTransition(() => root.render(tree({...props,user:identity('synthetic-b','synthetic-session-b'),updateUser:abandonedUpdate},true))); });
  await settle(balanceReads[0], response(8), pending);
  expect(props.updateUser).toHaveBeenCalledWith({credit_balance:8});
  expect(abandonedUpdate).not.toHaveBeenCalled();
 } finally { await act(async () => root.unmount()); container.remove(); }
});

it('rechecks ownership after a fast balance response waits for slower aggregate reads', async () => {
 const heldBookings = deferred(); const get = apiClient.get.getMockImplementation();
 apiClient.get.mockImplementation(path => path === '/bookings/user/synthetic-a' ? heldBookings.promise : get(path));
 const { result, rerender, props } = mount(); const pending = start(result);
 await act(async () => { balanceReads[0].resolve(response(71)); await Promise.resolve(); });
 expect(props.updateUser).not.toHaveBeenCalled();
 rerender({...props,user:identity('synthetic-b','synthetic-session-b')});
 props.setUserCreditBalance.mockClear();
 await act(async () => { heldBookings.resolve({data:[]}); await pending; });
 expect(props.updateUser).not.toHaveBeenCalled();
 expect(props.setUserCreditBalance).not.toHaveBeenCalled();
});

it('does not resurrect an earlier account lifetime after switching away and back', async () => {
 const { result, rerender, props } = mount(); const old = start(result);
 rerender({...props,user:identity('synthetic-b','synthetic-session-b')});
 rerender(props); props.setUserCreditBalance.mockClear();
 const current = start(result);
 await settle(balanceReads[1],response(3),current);
 await settle(balanceReads[0],response(71),old);
 expect(props.setUserCreditBalance.mock.calls).toEqual([[3]]);
 expect(props.updateUser.mock.calls).toEqual([[{credit_balance:3}]]);
});
