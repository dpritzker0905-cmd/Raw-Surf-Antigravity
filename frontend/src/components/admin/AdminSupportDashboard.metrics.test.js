import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';
import { AdminSupportDashboard } from './AdminSupportDashboard';

let mockUser = { id: 'fictional-admin' };
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const tickets = ['A', 'B'].map(id => ({ id, ticket_number: `TEST-${id}`, subject: `${id} request`, priority: 'medium', status: 'open' }));
const initialMetrics = { open_tickets: 7, resolved_tickets: 4, avg_first_response_hours: 1.5, avg_resolution_hours: 8.25, sla_breached_count: 2 };
const pending = () => {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let metricQueue, currentMetrics;
const holdMetrics = () => { const request = pending(); metricQueue.push(request); return request; };
const finish = async (request, data) => act(async () => { request.resolve({ data }); });
const fail = async request => act(async () => { request.reject(new Error('Fictional request failure')); });
const metricCalls = () => apiClient.get.mock.calls.filter(([url]) => url.startsWith('/admin/support/metrics?'));
const listCalls = () => apiClient.get.mock.calls.filter(([url]) => url.startsWith('/admin/support/tickets?'));
const region = () => within(screen.getByRole('region', { name: 'Support metrics' }));
const refresh = () => fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
const mount = async () => { const view = render(<AdminSupportDashboard />); await screen.findByText('A request'); return view; };
const open = async id => { fireEvent.click(screen.getByText(`${id} request`)); await screen.findByText(`Ticket: TEST-${id}`); };
const draft = value => fireEvent.change(screen.getByRole('textbox', { name: 'Type your reply...' }), { target: { value } });
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Send Reply', exact: true }));
const changePriority = async () => {
  const user = userEvent.setup(); await user.click(screen.getByRole('combobox', { name: 'Ticket priority', exact: true }));
  await user.click(screen.getByRole('option', { name: 'High', exact: true }));
};
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.PointerEvent = MouseEvent;
});
beforeEach(() => {
  jest.clearAllMocks(); mockUser = { id: 'fictional-admin' }; metricQueue = []; currentMetrics = { ...initialMetrics };
  apiClient.get.mockImplementation(url => {
    if (url.startsWith('/admin/support/metrics?')) return metricQueue.length ? metricQueue.shift().promise : Promise.resolve({ data: { ...currentMetrics } });
    if (url.startsWith('/admin/support/tickets?')) return Promise.resolve({ data: { tickets, total: 2, limit: 50, offset: 0 } });
    const ticket = tickets.find(row => row.id === url.split('/').pop());
    return Promise.resolve({ data: { ...ticket, description: `Details ${ticket?.id}`, category: 'other', messages: [] } });
  });
  apiClient.post.mockResolvedValue({ data: { success: true } }); apiClient.put.mockResolvedValue({ data: { success: true } });
});

test('successful metrics retain real numeric values', async () => {
  await mount(); expect(screen.getByText('Open Tickets')).toBeInTheDocument();
  expect(screen.getByText('7')).toBeInTheDocument(); expect(screen.getByText('1.5h')).toBeInTheDocument();
  expect(screen.getByText('8.25h')).toBeInTheDocument(); expect(metricCalls()).toHaveLength(1);
});

test('zero-valued successful metrics are not treated as a failed read', async () => {
  currentMetrics = Object.fromEntries(Object.keys(initialMetrics).map(key => [key, 0])); await mount();
  expect(screen.getAllByText('0h')).toHaveLength(2); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('initial metrics loading is explicit and independent of available tickets', async () => {
  holdMetrics(); await mount(); expect(region().getByText('Loading support metrics...')).toBeInTheDocument();
  expect(screen.getByText('A request')).toBeInTheDocument(); expect(region().queryByText('Open Tickets')).not.toBeInTheDocument();
});

test('initial failure has metrics-only retry with no mutation or ticket reload', async () => {
  const request = holdMetrics(); await mount(); await fail(request);
  expect(region().getByRole('alert')).toHaveTextContent('Failed to load support metrics');
  fireEvent.click(region().getByRole('button', { name: 'Retry support metrics' }));
  await screen.findByText('1.5h'); expect(metricCalls()).toHaveLength(2); expect(listCalls()).toHaveLength(1);
  expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.put).not.toHaveBeenCalled();
});

test('manual Refresh hides old metrics while reloading and publishes new values', async () => {
  await mount(); const request = holdMetrics(); refresh();
  expect(region().queryByText('1.5h')).not.toBeInTheDocument(); expect(region().getByText('Loading support metrics...')).toBeInTheDocument();
  await finish(request, { ...initialMetrics, open_tickets: 11, avg_first_response_hours: 3.5 });
  expect(region().getByText('11')).toBeInTheDocument(); expect(region().getByText('3.5h')).toBeInTheDocument();
});

test('failed refresh cannot leave old healthy-looking cards visible', async () => {
  await mount(); const request = holdMetrics(); refresh(); await fail(request);
  expect(region().getByRole('alert')).toHaveTextContent('Failed to load support metrics');
  expect(region().queryByText('Open Tickets')).not.toBeInTheDocument(); expect(region().queryByText('1.5h')).not.toBeInTheDocument();
});

test('older refresh success cannot overwrite newer metrics', async () => {
  await mount(); const old = holdMetrics(); refresh(); const latest = holdMetrics(); refresh();
  await finish(latest, { ...initialMetrics, open_tickets: 19 }); await finish(old, { ...initialMetrics, open_tickets: 31 });
  expect(region().getByText('19')).toBeInTheDocument(); expect(region().queryByText('31')).not.toBeInTheDocument();
});

test('older failure cannot conceal a newer successful refresh', async () => {
  await mount(); const old = holdMetrics(); refresh(); const latest = holdMetrics(); refresh();
  await finish(latest, { ...initialMetrics, open_tickets: 19 }); await fail(old);
  expect(region().getByText('19')).toBeInTheDocument(); expect(region().queryByRole('alert')).not.toBeInTheDocument();
  expect(logger.error).not.toHaveBeenCalled();
});

test('an old completion cannot stop the latest metrics loading state', async () => {
  await mount(); const old = holdMetrics(); refresh(); const latest = holdMetrics(); refresh();
  await finish(old, initialMetrics); expect(region().getByText('Loading support metrics...')).toBeInTheDocument();
  await finish(latest, initialMetrics); expect(region().getByText('1.5h')).toBeInTheDocument();
});

test('successful reply refreshes metrics with a stable request identifier', async () => {
  await mount(); await open('A'); currentMetrics = { ...initialMetrics, avg_first_response_hours: 2.25 };
  draft('Reply for A'); send(); await screen.findByText('2.25h'); expect(metricCalls()).toHaveLength(2);
  expect(apiClient.post).toHaveBeenCalledWith('/admin/support/tickets/A/reply', { message: 'Reply for A', is_internal_note: false, client_message_id: expect.any(String) });
});

test('successful status or priority update refreshes metrics', async () => {
  await mount(); await open('A'); currentMetrics = { ...initialMetrics, open_tickets: 13 }; await changePriority();
  await screen.findByText('13'); expect(metricCalls()).toHaveLength(2); expect(apiClient.put).toHaveBeenCalledTimes(1);
});

test('failed reply leaves metrics and retryable draft unchanged', async () => {
  await mount(); await open('A'); const request = pending(); apiClient.post.mockReturnValueOnce(request.promise);
  draft('Keep draft A'); send(); await fail(request);
  expect(metricCalls()).toHaveLength(1); expect(screen.getByText('1.5h')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Type your reply...' })).toHaveValue('Keep draft A');
});

test('failed ticket update does not pretend metrics were refreshed', async () => {
  await mount(); await open('A'); const request = pending(); apiClient.put.mockReturnValueOnce(request.promise);
  await changePriority(); await fail(request); expect(metricCalls()).toHaveLength(1); expect(screen.getByText('1.5h')).toBeInTheDocument();
});

test('account change clears previous metrics and ignores their late callback', async () => {
  const view = await mount(); const old = holdMetrics(); refresh(); const latest = holdMetrics();
  mockUser = { id: 'fictional-second-admin' }; view.rerender(<AdminSupportDashboard />);
  expect(region().queryByText('1.5h')).not.toBeInTheDocument(); await finish(old, { ...initialMetrics, open_tickets: 31 });
  expect(region().getByText('Loading support metrics...')).toBeInTheDocument();
  await finish(latest, { ...initialMetrics, open_tickets: 19 }); expect(region().getByText('19')).toBeInTheDocument();
});

test('unmount ignores a late metrics failure', async () => {
  const request = holdMetrics(); const view = await mount(); view.unmount(); await fail(request);
  expect(logger.error).not.toHaveBeenCalled();
});

test('metrics refresh after A reply cannot erase B draft', async () => {
  await mount(); await open('A'); draft('A reply'); const request = pending(); apiClient.post.mockReturnValueOnce(request.promise); send();
  await open('B'); draft('B stays'); currentMetrics = { ...initialMetrics, open_tickets: 21 }; await finish(request, { success: true });
  await screen.findByText('21'); expect(screen.getByText('Ticket: TEST-B')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Type your reply...' })).toHaveValue('B stays');
});

test('metrics retry retains selected ticket, its draft and note mode', async () => {
  const request = holdMetrics(); await mount(); await open('A'); draft('Draft survives metrics retry');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Internal note' })); await fail(request);
  fireEvent.click(region().getByRole('button', { name: 'Retry support metrics' })); await screen.findByText('1.5h');
  expect(screen.getByText('Ticket: TEST-A')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Type your reply...' })).toHaveValue('Draft survives metrics retry');
  expect(screen.getByRole('checkbox', { name: 'Internal note' })).toBeChecked(); expect(listCalls()).toHaveLength(1);
});

test('resolved label discloses the existing ticket creation cohort', async () => {
  await mount(); expect(region().getByText('Resolved / closed')).toBeInTheDocument();
  expect(region().getByText('Tickets created in last 30 days')).toBeInTheDocument();
});

// jsdom does not provide the browser Web Crypto API in this dependency version.
beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { value: require('crypto').webcrypto, configurable: true }); });
