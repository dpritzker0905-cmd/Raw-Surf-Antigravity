import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Bookings } from './Bookings';
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';

let mockUser, mockTheme, mockParams, mockLocation;
const mockNavigate=jest.fn(), mockUpdateUser=jest.fn();
jest.mock('../contexts/AuthContext',()=>({useAuth:()=>({user:mockUser,updateUser:mockUpdateUser})}),{virtual:true});
jest.mock('../contexts/ThemeContext',()=>({useTheme:()=>({theme:mockTheme})}),{virtual:true});
jest.mock('../contexts/PersonaContext',()=>({usePersona:()=>({getEffectiveRole:()=> 'Surfer'})}),{virtual:true});
jest.mock('react-router-dom',()=>({useNavigate:()=>mockNavigate,useSearchParams:()=>[mockParams],useLocation:()=>mockLocation}),{virtual:true});
jest.mock('../hooks/useSwipeNavigation',()=>({__esModule:true,default:()=>({contentRef:require('react').useRef(null),swipeHandlers:{}})}),{virtual:true});
jest.mock('./ui/card',()=>({Card:({children,...props})=><div {...props}>{children}</div>,CardContent:({children,...props})=><div {...props}>{children}</div>}),{virtual:true});
jest.mock('./ui/button',()=>({Button:require('react').forwardRef(({children,...props},ref)=><button {...props} ref={ref}>{children}</button>)}),{virtual:true});
jest.mock('./bookings/index',()=>({
  LiveSessionsTab:require('./bookings/LiveSessionsTab').LiveSessionsTab,
  OnDemandTab:()=>null,ScheduledTab:()=>null,FindBuddiesTab:()=>null,PastTab:()=>null,
  LiveNowTab:()=>null,LineupTab:()=>null,DirectoryTab:()=>null,SubscriptionsTab:()=>null,
}),{virtual:true});
jest.mock('./bookings/BookingsModals',()=>({__esModule:true,default:()=>null}),{virtual:true});
jest.mock('../lib/apiClient',()=>({get:jest.fn(),post:jest.fn()}));
jest.mock('../utils/logger',()=>({error:jest.fn()}));
jest.mock('sonner',()=>({toast:{success:jest.fn(),error:jest.fn(),info:jest.fn()}}));

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const isList=path=>/^\/sessions\/user\/[^/]+$/.test(path);
const row=(id='session-a',name='Synthetic photographer')=>({id,photographer_name:name,location:'Synthetic location',amount_paid:25});
let reads;
const resolve=async(read,data)=>{await act(async()=>{read.resolve({data});});};
const reject=async(read,status=500)=>{await act(async()=>{read.reject({response:{status}});});};

beforeEach(()=>{
  jest.clearAllMocks();reads=[];mockUser={id:'user-a',access_token:'session-a',role:'Surfer'};
  mockTheme='light';mockParams=new URLSearchParams('tab=live_sessions');mockLocation={key:'initial'};
  HTMLElement.prototype.scrollTo=jest.fn();HTMLElement.prototype.scrollBy=jest.fn();
  apiClient.get.mockImplementation(path=>{
    if(isList(path)){const request=deferred();reads.push(request);return request.promise;}
    if(path.startsWith('/credits/balance/'))return Promise.resolve({data:{user_id:mockUser.id,balance:0}});
    return Promise.resolve({data:[]});
  });
  apiClient.post.mockResolvedValue({data:{refunded:false}});
});

it.each(['light','dark','beach'])('shows read failure rather than a normal empty list in %s',async theme=>{
  mockTheme=theme;render(<Bookings/>);await reject(reads[0]);
  expect(screen.getByRole('alert').textContent).toContain('Could not load live sessions');
  expect(screen.getByText('Live Sessions count unavailable')).toBeTruthy();
  expect(screen.queryByText('No Live Sessions')).toBeNull();
  expect(screen.getByRole('button',{name:'Retry live sessions'})).toBeTruthy();
});

it('shows legitimate empty state only after a successful empty list',async()=>{
  render(<Bookings/>);expect(screen.queryByText('No Live Sessions')).toBeNull();
  await resolve(reads[0],[]);expect(screen.getByText('No Live Sessions')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('retries only the one read and recovers through the public UI',async()=>{
  render(<Bookings/>);await reject(reads[0]);const before=apiClient.get.mock.calls.length;
  fireEvent.click(screen.getByRole('button',{name:'Retry live sessions'}));
  expect(apiClient.get.mock.calls.slice(before)).toEqual([['/sessions/user/user-a']]);
  expect(screen.getByRole('button',{name:'Refresh live sessions'}).disabled).toBe(true);
  await resolve(reads[1],[row()]);expect(screen.getByText('@Synthetic photographer')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();expect(apiClient.post).not.toHaveBeenCalled();
});

it('renders the live list without waiting for the other seven resource requests',async()=>{
  const others=deferred();const get=apiClient.get.getMockImplementation();
  apiClient.get.mockImplementation(path=>isList(path)?get(path):others.promise);
  render(<Bookings/>);await resolve(reads[0],[row()]);
  expect(screen.getByText('@Synthetic photographer')).toBeTruthy();
  expect(screen.getByTestId('bookings-page')).toBeTruthy();
  await resolve(others,[]);
});

it('keeps initial loading distinct from empty while the seven other reads finish',async()=>{
  render(<Bookings/>);
  await waitFor(()=>expect(apiClient.get).toHaveBeenCalledTimes(8));
  expect(screen.getByText('Loading live sessions…')).toBeTruthy();
  expect(screen.queryByText('No Live Sessions')).toBeNull();
  await resolve(reads[0],[]);
});

it.each([null,{},'wrong',[null],[{}],[{id:'x',photographer_name:{bad:true}}]])('rejects malformed response without rendering false empty: %p',async data=>{
  render(<Bookings/>);await resolve(reads[0],data);
  expect(screen.getByRole('alert')).toBeTruthy();expect(screen.queryByText('No Live Sessions')).toBeNull();
});

it('does not clear a known list into false empty after refresh fails',async()=>{
  render(<Bookings/>);await resolve(reads[0],[row()]);
  fireEvent.click(screen.getByRole('button',{name:'Refresh live sessions'}));await reject(reads[1]);
  expect(screen.getByRole('alert')).toBeTruthy();expect(screen.getByText('Live Sessions count unavailable')).toBeTruthy();
  expect(screen.getByText('Showing last loaded sessions.')).toBeTruthy();
  expect(screen.getByText('@Synthetic photographer')).toBeTruthy();
});

it('prevents an old request from overwriting the latest navigation read',async()=>{
  const view=render(<Bookings/>);mockLocation={key:'next'};view.rerender(<Bookings/>);
  await resolve(reads[1],[row('current','Current')]);await resolve(reads[0],[row('stale','Stale')]);
  expect(screen.getByText('@Current')).toBeTruthy();expect(screen.queryByText('@Stale')).toBeNull();
});

it('discards an old account response and clears private rows at account change',async()=>{
  const view=render(<Bookings/>);await resolve(reads[0],[row()]);
  fireEvent.click(screen.getByRole('button',{name:'Refresh live sessions'}));
  mockUser={id:'user-b',access_token:'session-b',role:'Surfer'};view.rerender(<Bookings/>);
  expect(screen.queryByText('@Synthetic photographer')).toBeNull();
  await resolve(reads[2],[row('b','Current B')]);await resolve(reads[1],[row('stale','Private A')]);
  expect(screen.getByText('@Current B')).toBeTruthy();expect(screen.queryByText('@Private A')).toBeNull();
});

it('refreshes only this read on same-ID session replacement and discards the old lifetime',async()=>{
  const view=render(<Bookings/>);const before=apiClient.get.mock.calls.length;
  mockUser={...mockUser,access_token:'replacement'};view.rerender(<Bookings/>);
  expect(apiClient.get.mock.calls.slice(before)).toEqual([['/sessions/user/user-a']]);
  await resolve(reads[1],[row('new','New session')]);await resolve(reads[0],[row('old','Old session')]);
  expect(screen.getByText('@New session')).toBeTruthy();expect(screen.queryByText('@Old session')).toBeNull();
});

it('does not resurrect a successfully left row from a late GET',async()=>{
  render(<Bookings/>);await resolve(reads[0],[row()]);
  fireEvent.click(screen.getByRole('button',{name:'Refresh live sessions'}));
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Loader2'}));});
  expect(apiClient.post.mock.calls).toEqual([['/sessions/leave/session-a']]);
  expect(screen.queryByText('@Synthetic photographer')).toBeNull();
  await resolve(reads[1],[row()]);expect(screen.queryByText('@Synthetic photographer')).toBeNull();
});

it('uses the same read guard for the payment return refresh without changing its POST',async()=>{
  mockParams=new URLSearchParams('tab=live_sessions&session_payment=success&checkout_session_id=synthetic-checkout');
  apiClient.post.mockResolvedValueOnce({data:{success:true,photographer_name:'Synthetic photographer'}});
  render(<Bookings/>);await waitFor(()=>expect(reads).toHaveLength(2));
  expect(apiClient.post.mock.calls).toEqual([['/sessions/complete-payment',{checkout_session_id:'synthetic-checkout'}]]);
  await resolve(reads[1],[row('paid','Paid current')]);await resolve(reads[0],[row('old','Old')]);
  expect(screen.getByText('@Paid current')).toBeTruthy();expect(screen.queryByText('@Old')).toBeNull();
});

it('discards completed reads after unmount',async()=>{
  const view=render(<Bookings/>);view.unmount();await resolve(reads[0],[row()]);
  expect(screen.queryByText('@Synthetic photographer')).toBeNull();
});

it('does not revive the first A lifetime after A to B to A',async()=>{
  const firstUser=mockUser;const view=render(<Bookings/>);
  mockUser={id:'user-b',access_token:'session-b',role:'Surfer'};view.rerender(<Bookings/>);
  mockUser=firstUser;view.rerender(<Bookings/>);
  await resolve(reads[2],[row('new-a','Current A')]);await resolve(reads[0],[row('old-a','Earlier A')]);await reject(reads[1]);
  expect(screen.getByText('@Current A')).toBeTruthy();expect(screen.queryByText('@Earlier A')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('clears private data at logout and ignores the old pending response',async()=>{
  const view=render(<Bookings/>);await resolve(reads[0],[row()]);
  fireEvent.click(screen.getByRole('button',{name:'Refresh live sessions'}));
  mockUser=null;view.rerender(<Bookings/>);
  expect(screen.queryByText('@Synthetic photographer')).toBeNull();
  await resolve(reads[1],[row('old','Private old user')]);
  expect(screen.queryByText('@Private old user')).toBeNull();
});

it.each([401,403,404])('does not let an older refusal %p replace the latest successful read',async status=>{
  const view=render(<Bookings/>);mockLocation={key:'next'};view.rerender(<Bookings/>);
  await resolve(reads[1],[row('latest','Latest')]);await reject(reads[0],status);
  expect(screen.getByText('@Latest')).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();
});

it('does not treat a failed Leave as a successful local removal',async()=>{
  render(<Bookings/>);await resolve(reads[0],[row()]);
  fireEvent.click(screen.getByRole('button',{name:'Refresh live sessions'}));
  apiClient.post.mockRejectedValueOnce({response:{data:{detail:'Synthetic leave refusal'}}});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Loader2'}));});
  await resolve(reads[1],[row()]);
  expect(screen.getByText('@Synthetic photographer')).toBeTruthy();
  expect(toast.error).toHaveBeenCalledWith('Synthetic leave refusal');
});

it('preserves the existing refund feedback and balance update on successful Leave',async()=>{
  render(<Bookings/>);await resolve(reads[0],[row()]);
  apiClient.post.mockResolvedValueOnce({data:{refunded:true,refund_amount:5,new_balance:80}});
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Loader2'}));});
  expect(mockUpdateUser).toHaveBeenCalledWith({credit_balance:80});
  expect(toast.success).toHaveBeenCalledWith('Left early - $5.00 refunded to credits!',{duration:5000});
  expect(apiClient.post.mock.calls).toEqual([['/sessions/leave/session-a']]);
});

it('reports a post-payment list failure as a read problem without reposting payment',async()=>{
  mockParams=new URLSearchParams('tab=live_sessions&session_payment=success&checkout_session_id=synthetic-checkout');
  apiClient.post.mockResolvedValueOnce({data:{success:true}});render(<Bookings/>);
  await waitFor(()=>expect(reads).toHaveLength(2));await reject(reads[1]);await resolve(reads[0],[]);
  expect(screen.getByRole('alert')).toBeTruthy();expect(screen.queryByText('No Live Sessions')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Retry live sessions'}));await resolve(reads[2],[]);
  expect(screen.getByText('No Live Sessions')).toBeTruthy();expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(toast.error).not.toHaveBeenCalled();
});

it('does not let an old account Leave completion remove the new account row',async()=>{
  const view=render(<Bookings/>);await resolve(reads[0],[row()]);
  const leave=deferred();apiClient.post.mockReturnValueOnce(leave.promise);
  fireEvent.click(screen.getByRole('button',{name:'Loader2'}));
  mockUser={id:'user-b',access_token:'session-b',role:'Surfer'};view.rerender(<Bookings/>);
  await resolve(reads[1],[row('session-a','Current account B')]);
  await act(async()=>{leave.resolve({data:{refunded:false}});});
  expect(screen.getByText('@Current account B')).toBeTruthy();
});

it.each([401,403,404])('clears loaded private rows after the latest refusal %p without showing normal empty',async status=>{
  render(<Bookings/>);await resolve(reads[0],[row()]);
  fireEvent.click(screen.getByRole('button',{name:'Refresh live sessions'}));await reject(reads[1],status);
  expect(screen.queryByText('@Synthetic photographer')).toBeNull();
  expect(screen.queryByText('Showing last loaded sessions.')).toBeNull();
  expect(screen.queryByText('No Live Sessions')).toBeNull();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByText('Live Sessions count unavailable')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Retry live sessions'}));await resolve(reads[2],[]);
  expect(screen.getByText('No Live Sessions')).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();
});

it.each([503,'network'])('retains labelled same-owner data for a transient failure %p',async status=>{
  render(<Bookings/>);await resolve(reads[0],[row()]);
  fireEvent.click(screen.getByRole('button',{name:'Refresh live sessions'}));
  if(status==='network')await act(async()=>{reads[1].reject(new Error('Synthetic network failure'));});
  else await reject(reads[1],status);
  expect(screen.getByText('@Synthetic photographer')).toBeTruthy();
  expect(screen.getByText('Showing last loaded sessions.')).toBeTruthy();
  expect(screen.getByText('Live Sessions count unavailable')).toBeTruthy();
  expect(screen.getByRole('alert')).toBeTruthy();
});

it('keeps a settled refusal visible when an earlier Leave later succeeds',async()=>{
  render(<Bookings/>);await resolve(reads[0],[row()]);
  const leave=deferred();apiClient.post.mockReturnValueOnce(leave.promise);
  fireEvent.click(screen.getByRole('button',{name:'Loader2'}));
  fireEvent.click(screen.getByRole('button',{name:'Refresh live sessions'}));await reject(reads[1],403);
  await act(async()=>{leave.resolve({data:{refunded:false}});});
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Retry live sessions'})).toBeTruthy();
  expect(screen.queryByText('No Live Sessions')).toBeNull();
  expect(screen.getByText('Live Sessions count unavailable')).toBeTruthy();
});

it('does not turn a transient list failure into normal empty after leaving its last cached row',async()=>{
  render(<Bookings/>);await resolve(reads[0],[row()]);
  fireEvent.click(screen.getByRole('button',{name:'Refresh live sessions'}));await reject(reads[1],503);
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Loader2'}));});
  expect(screen.getByRole('alert')).toBeTruthy();expect(screen.queryByText('No Live Sessions')).toBeNull();
  expect(screen.getByText('Live Sessions count unavailable')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Retry live sessions'}));await resolve(reads[2],[]);
  expect(screen.getByText('No Live Sessions')).toBeTruthy();expect(screen.queryByRole('alert')).toBeNull();
});
