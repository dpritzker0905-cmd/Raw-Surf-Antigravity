import React, { Suspense, startTransition, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PhotographerBookingsManager } from './PhotographerBookingsManager';
import apiClient from '../lib/apiClient';
import usePhotographerBookingsList from '../hooks/usePhotographerBookingsList';
let mockUser = { id: 'photo-a', role: 'Photographer' };
let mockTheme = 'dark';
const mockParams = new URLSearchParams();
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn(), useSearchParams: () => [mockParams] }), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), patch: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('./PhotographerAvailabilityCalendar', () => ({ PhotographerAvailabilityCalendar: () => <p>Calendar boundary</p> }));
jest.mock('./PhotographerSessionManager', () => ({ PhotographerSessionManager: ({ isOpen, onRefresh }) => isOpen
  ? <button onClick={onRefresh}>Refresh drawer bookings</button> : null }));
jest.mock('./bookings/CreateSessionModal', () => ({ showCreateModal }) => showCreateModal ? <p>Create session boundary</p> : null);
jest.mock('./bookings/AvailabilityModal', () => ({ showAvailabilityModal }) => showAvailabilityModal ? <p>Availability boundary</p> : null);
jest.mock('./bookings/BookingPricingModal', () => ({ showPricingModal }) => showPricingModal ? <p>Pricing boundary</p> : null);
jest.mock('./bookings/EditBookingModal', () => () => null);
jest.mock('./bookings/CrewSplitModal', () => () => null);
jest.mock('./bookings/ParticipantsModal', () => () => null);
const deferred = () => {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const booking = (id = 'booking-a', status = 'Confirmed') => ({ id, status, location: id,
  session_date: '2026-11-04T12:00:00Z', duration: 60, max_participants: 4, current_participants: 1, price_per_person: 75 });
const failure = status => ({ response: { status }, message: 'controlled failure' });
let mockList;
const flush = async () => { await act(async () => {}); };
const mount = async () => { const view = render(<PhotographerBookingsManager />); await flush(); return view; };
const advance = async ms => { await act(async () => { jest.advanceTimersByTime(ms); }); };
const settle = async (request, data, reject = false) => { await act(async () => {
  if (reject) request.reject(data); else request.resolve({ data });
}); };
const retry = () => fireEvent.click(screen.getByRole('button', { name: 'Retry bookings' }));
const openDrawer = () => {
  fireEvent.click(screen.getByTestId('tab-confirmed'));
  fireEvent.click(screen.getByTestId('manage-session-btn-booking-a'));
};
const refresh = () => fireEvent.click(screen.getByRole('button', { name: 'Refresh drawer bookings' }));
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); mockUser = { id: 'photo-a', role: 'Photographer' }; mockTheme = 'dark';
  mockList = jest.fn().mockResolvedValue({ data: [] });
  apiClient.get.mockImplementation((url, config) => /\/photographer\/[^/]+\/bookings$/.test(url) ? mockList(url, config)
    : Promise.resolve({ data: url.endsWith('/availability') ? [] : {} }));
  apiClient.patch.mockResolvedValue({ data: {} });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
test('503 remains a persistent load error rather than a normal empty photographer inbox', async () => {
  mockList.mockRejectedValueOnce(failure(503)); await mount();
  expect(screen.queryByText('No pending bookings')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load bookings');
  expect(screen.getByRole('button', { name: 'Retry bookings' })).toBeEnabled();
});
test('an unresolved list at the existing ten-second safety boundary cannot become a normal empty inbox', async () => {
  const request = deferred(); mockList.mockReturnValueOnce(request.promise); await mount();
  expect(screen.getByRole('status')).toHaveTextContent('Loading bookings');
  await advance(9999);expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toBeInTheDocument();
  await advance(1);
  expect(screen.queryByText('No pending bookings')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load bookings');
});

test('Retry recovers from503 through the real manager and only successful[] shows ordinary empty', async () => {
  mockList.mockRejectedValueOnce(failure(503)).mockResolvedValueOnce({ data: [] }); await mount();
  retry(); await flush();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('No pending bookings')).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled(); expect(apiClient.put).not.toHaveBeenCalled();
});
test.each([null, {}, { bookings: [] }, [null], [[]]])('malformed list %p cannot masquerade as successful empty', async payload => {
  mockList.mockResolvedValue({ data: payload }); await mount();
  expect(screen.queryByText('No pending bookings')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
});
test.each(['light', 'dark', 'beach'])('Retry, tabs and existing create/availability/pricing controls survive failure in %s', async theme => {
  mockTheme = theme; mockList.mockRejectedValueOnce(failure(503)); await mount();
  expect(screen.getByRole('alert')).toHaveClass('bg-muted', 'text-foreground', 'border-border');
  const control = screen.getByRole('button', { name: 'Retry bookings' });control.focus();expect(control).toHaveFocus();
  fireEvent.click(screen.getByTestId('tab-confirmed')); expect(screen.queryByText('No confirmed bookings')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTestId('tab-calendar')); expect(screen.getByText('Calendar boundary')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('create-session-btn')); expect(screen.getByText('Create session boundary')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('set-availability-btn')); expect(screen.getByText('Availability boundary')).toBeInTheDocument();
  fireEvent.click(screen.getByTestId('edit-booking-pricing-btn')); expect(screen.getByText('Pricing boundary')).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled();expect(apiClient.put).not.toHaveBeenCalled();
});
test('same-owner transient refresh retains rows and preserves status tab counts', async () => {
  const pending = deferred();
  mockList.mockResolvedValueOnce({ data: [booking()] }).mockReturnValueOnce(pending.promise);
  await mount();openDrawer();refresh();
  expect(screen.getByTestId('booking-booking-a')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Loading bookings');
  await settle(pending, failure(503), true);
  expect(screen.getByTestId('booking-booking-a')).toBeInTheDocument();
  expect(screen.getByTestId('tab-confirmed')).toHaveTextContent('1');
  expect(screen.getByRole('button', { name: 'Retry bookings' })).toBeEnabled();
});
test('refresh timeout retains rows, aborts transport, and rejects its late success', async () => {
  const late = deferred();mockList.mockResolvedValueOnce({ data: [booking()] }).mockReturnValueOnce(late.promise);
  await mount();openDrawer();refresh();const signal=mockList.mock.calls[1][1].signal;
  await advance(10000);expect(signal.aborted).toBe(true);
  expect(screen.getByTestId('booking-booking-a')).toBeInTheDocument();expect(screen.getByRole('alert')).toBeInTheDocument();
  await settle(late,[booking('late')]);expect(screen.queryByTestId('booking-late')).not.toBeInTheDocument();
  expect(screen.getByTestId('booking-booking-a')).toBeInTheDocument();
});
test.each([401,403,404])('HTTP%s clears retained rows/counts without pretending they are empty', async status => {
  mockList.mockResolvedValueOnce({ data: [booking()] }).mockRejectedValueOnce(failure(status));
  await mount();openDrawer();refresh();await flush();
  expect(screen.queryByTestId('booking-booking-a')).not.toBeInTheDocument();
  expect(screen.getByTestId('tab-confirmed')).not.toHaveTextContent('1');
  expect(screen.queryByText('No confirmed bookings')).not.toBeInTheDocument();expect(screen.getByRole('alert')).toBeInTheDocument();
});
test('Retry is disabled while pending; its success clears the error and cancelled timer cannot overwrite it', async () => {
  const pending=deferred();mockList.mockRejectedValueOnce(failure(503)).mockReturnValueOnce(pending.promise);
  await mount();retry();expect(screen.getByRole('button',{name:'Retry bookings'})).toBeDisabled();
  await settle(pending,[booking('restored','Pending')]);await advance(10000);
  expect(screen.getByTestId('booking-restored')).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('owner change immediately hides old rows and ignores its late request, while the new owner remains loading', async () => {
  const old=deferred(),next=deferred();mockList.mockResolvedValueOnce({data:[booking()]}).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const view=await mount();openDrawer();refresh();mockUser={id:'photo-b',role:'Photographer'};view.rerender(<PhotographerBookingsManager/>);
  expect(screen.queryByTestId('booking-booking-a')).not.toBeInTheDocument();
  await settle(old,[booking('old-owner')]);expect(screen.queryByTestId('booking-old-owner')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toBeInTheDocument();
  await settle(next,[booking('new-owner')]);expect(screen.getByTestId('booking-new-owner')).toBeInTheDocument();
});
test('role/privilege change for the same user invalidates retained rows', async () => {
  mockList.mockResolvedValueOnce({data:[booking()]}).mockRejectedValueOnce(failure(503));
  const view=await mount();mockUser={...mockUser,is_admin:true};view.rerender(<PhotographerBookingsManager/>);await flush();
  expect(screen.queryByTestId('booking-booking-a')).not.toBeInTheDocument();expect(screen.getByRole('alert')).toBeInTheDocument();
});
test('logout clears retained rows and does not issue an undefined-owner request', async () => {
  mockList.mockResolvedValue({data:[booking()]});const view=await mount();mockUser=null;view.rerender(<PhotographerBookingsManager/>);await flush();
  expect(screen.queryByTestId('booking-booking-a')).not.toBeInTheDocument();expect(mockList).toHaveBeenCalledTimes(1);
});
test('latest same-owner request wins and an older finally cannot stop its loading state', async () => {
  const old=deferred(),next=deferred();mockList.mockResolvedValueOnce({data:[booking()]}).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await mount();openDrawer();refresh();refresh();expect(mockList.mock.calls[1][1].signal.aborted).toBe(true);
  await settle(old,failure(503),true);expect(screen.getByRole('status')).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await settle(next,[booking('newest')]);expect(screen.getByTestId('booking-newest')).toBeInTheDocument();
});
test('a timed-out initial request cannot replace a successful Retry', async () => {
  const old=deferred();mockList.mockReturnValueOnce(old.promise).mockResolvedValueOnce({data:[booking('newest','Pending')]});
  await mount();await advance(10000);retry();await flush();await settle(old,[booking('stale','Pending')]);
  expect(screen.getByTestId('booking-newest')).toBeInTheDocument();expect(screen.queryByTestId('booking-stale')).not.toBeInTheDocument();
});
test('unmount aborts the request and cancels its timer even if transport rejects late', async () => {
  const pending=deferred();mockList.mockReturnValueOnce(pending.promise);const view=await mount();const signal=mockList.mock.calls[0][1].signal;
  view.unmount();expect(signal.aborted).toBe(true);await advance(10000);await settle(pending,failure(503),true);expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('status confirmation keeps its existing PATCH contract and refreshes only the bookings list', async () => {
  mockList.mockResolvedValueOnce({data:[booking('pending','Pending')]}).mockResolvedValueOnce({data:[booking('pending','Confirmed')]});
  await mount();const secondary=apiClient.get.mock.calls.filter(([url])=>!url.endsWith('/bookings')).length;
  fireEvent.click(screen.getByRole('button',{name:'Confirm'}));await flush();
  expect(apiClient.patch).toHaveBeenCalledWith('/bookings/pending/status',{status:'Confirmed'});expect(mockList).toHaveBeenCalledTimes(2);
  expect(apiClient.get.mock.calls.filter(([url])=>!url.endsWith('/bookings'))).toHaveLength(secondary);
  fireEvent.click(screen.getByTestId('tab-confirmed'));expect(screen.getByTestId('booking-pending')).toBeInTheDocument();
});
test('StrictMode cleanup/remount preserves current loading and successful rows', async () => {
  mockList.mockResolvedValue({data:[booking('strict','Pending')]});render(<React.StrictMode><PhotographerBookingsManager/></React.StrictMode>);await flush();
  expect(mockList.mock.calls[0][1].signal.aborted).toBe(true);expect(screen.getByTestId('booking-strict')).toBeInTheDocument();
});
test('abandoned suspended owner scope cannot disable refresh or discard the still-committed rows', async () => {
  const suspend=deferred(),request=deferred();let attempted=false;
  function Inbox({owner}) {
    const list=usePhotographerBookingsList({userId:'photo-a',ownerKey:owner});
    if(owner==='B'){attempted=true;throw suspend.promise;}
    return <section><button onClick={list.fetchBookings}>Refresh committed bookings</button>
      {list.bookings.map(b=><p key={b.id}>{b.location}</p>)}{list.error&&<p role="alert">{list.error}</p>}</section>;
  }
  function Host(){const[owner,setOwner]=useState('A');return<>
    <button onClick={()=>startTransition(()=>setOwner('B'))}>Attempt persona</button><button onClick={()=>setOwner('A')}>Keep persona</button>
    <Suspense fallback={<p>Suspended</p>}><Inbox owner={owner}/></Suspense></>;}
  mockList.mockResolvedValueOnce({data:[booking('committed')]}).mockReturnValueOnce(request.promise);
  render(<Host/>);await flush();fireEvent.click(screen.getByRole('button',{name:'Attempt persona'}));await flush();
  expect(attempted).toBe(true);expect(screen.queryByText('Suspended')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Refresh committed bookings'}));await flush();expect(mockList).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button',{name:'Keep persona'}));await flush();expect(screen.getByText('committed')).toBeInTheDocument();
  await settle(request,failure(503),true);expect(screen.getByText('committed')).toBeInTheDocument();expect(screen.getByRole('alert')).toBeInTheDocument();
});

test('a late successful superseded refresh cannot overwrite the latest same-owner result', async () => {
  const old=deferred(),latest=deferred();mockList.mockResolvedValueOnce({data:[booking()]}).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  await mount();openDrawer();refresh();refresh();await settle(latest,[booking('latest-success')]);await settle(old,[booking('old-success')]);
  expect(screen.getByTestId('booking-latest-success')).toBeInTheDocument();expect(screen.queryByTestId('booking-old-success')).not.toBeInTheDocument();
});
test('returning to a committed owner after an intervening owner does not resurrect cached or late rows', async () => {
  const b=deferred(),a=deferred();mockList.mockResolvedValueOnce({data:[booking()]}).mockReturnValueOnce(b.promise).mockReturnValueOnce(a.promise);
  const view=await mount();openDrawer();mockUser={id:'photo-b',role:'Photographer'};view.rerender(<PhotographerBookingsManager/>);await flush();
  mockUser={id:'photo-a',role:'Photographer'};view.rerender(<PhotographerBookingsManager/>);
  expect(screen.queryByTestId('booking-booking-a')).not.toBeInTheDocument();
  await settle(b,[booking('owner-b')]);expect(screen.queryByTestId('booking-owner-b')).not.toBeInTheDocument();
  await settle(a,[booking('fresh-a')]);expect(screen.getByTestId('booking-fresh-a')).toBeInTheDocument();
});
