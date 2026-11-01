import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import apiClient from '../../lib/apiClient';
import { AdminSupportDashboard } from './AdminSupportDashboard';

let mockUser = { id: 'fictional-admin' };
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn(), post: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const makeTickets = count => Array.from({ length: count }, (_, i) => ({
  id: `T${i + 1}`, ticket_number: `TEST-${String(i + 1).padStart(3, '0')}`,
  subject: `Request ${i + 1}`, status: i % 2 ? 'closed' : 'open', priority: i % 3 ? 'medium' : 'high',
  user_name: 'Fictional requester', user_email: 'fixture@example.invalid',
}));
const params = url => Object.fromEntries(new URL(url, 'http://fixture.invalid').searchParams);
const pending = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let data, holds;
const responseFor = query => {
  let filtered = data;
  if (query.status && query.status !== 'all') filtered = filtered.filter(t => t.status === query.status);
  if (query.priority && query.priority !== 'all') filtered = filtered.filter(t => t.priority === query.priority);
  if (query.search) filtered = filtered.filter(t => `${t.subject} ${t.ticket_number}`.toLowerCase().includes(query.search.toLowerCase()));
  const offset = Number(query.offset || 0), limit = Number(query.limit || 50);
  return { tickets: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit };
};
const holdList = match => {
  const request = pending(); holds.push({ match, request }); return request;
};
const finish = async (request, response) => act(async () => { request.resolve({ data: response }); });
const fail = async request => act(async () => { request.reject(new Error('Fictional list failure')); });
const listCalls = () => apiClient.get.mock.calls.filter(([url]) => url.startsWith('/admin/support/tickets?')).map(([url]) => params(url));
const next = () => screen.getByRole('button', { name: 'Next ticket page' });
const previous = () => screen.getByRole('button', { name: 'Previous ticket page' });
const range = text => screen.findByText(text);
const mount = async () => {
  const view = render(<AdminSupportDashboard />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
  await screen.findByText(data.length ? 'Request 1' : 'No tickets found');
  return view;
};
const choose = async (label, value) => {
  const user = userEvent.setup(); await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(screen.getByRole('option', { name: value, exact: true }));
};
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.PointerEvent = MouseEvent;
});
beforeEach(() => {
  jest.clearAllMocks(); mockUser = { id: 'fictional-admin' }; data = makeTickets(123); holds = [];
  apiClient.get.mockImplementation(url => {
    if (url.startsWith('/admin/support/metrics?')) return Promise.resolve({ data: null });
    if (url.startsWith('/admin/support/tickets?')) {
      const query = params(url), index = holds.findIndex(hold => hold.match(query));
      if (index >= 0) return holds.splice(index, 1)[0].request.promise;
      return Promise.resolve({ data: responseFor(query) });
    }
    const ticket = data.find(t => t.id === url.split('/').pop());
    return Promise.resolve({ data: { ...ticket, description: `Details ${ticket?.id}`, category: 'other', messages: [] } });
  });
  apiClient.put.mockResolvedValue({ data: { success: true } });
  apiClient.post.mockResolvedValue({ data: { success: true } });
});

test.each([0, 1, 50, 51, 100, 101, 123])('first page shows total and correct bounds for %i tickets', async count => {
  data = makeTickets(count); await mount();
  await range(`Showing ${count ? 1 : 0}–${Math.min(count, 50)} of ${count} tickets`);
  expect(screen.getByText(`Tickets (${count})`)).toBeInTheDocument();
  expect(screen.getByText(`Page 1 of ${Math.max(1, Math.ceil(count / 50))}`)).toBeInTheDocument();
  expect(previous()).toBeDisabled();
  if (count > 50) expect(next()).toBeEnabled(); else expect(next()).toBeDisabled();
  expect(listCalls()[0]).toMatchObject({ limit: '50', offset: '0' });
});

test('all 123 tickets are reachable and previous returns to the correct page', async () => {
  await mount(); fireEvent.click(next()); await range('Showing 51–100 of 123 tickets');
  expect(screen.getByText('Request 51')).toBeInTheDocument(); expect(screen.queryByText('Request 1')).not.toBeInTheDocument();
  fireEvent.click(next()); await range('Showing 101–123 of 123 tickets');
  expect(screen.getByText('Request 123')).toBeInTheDocument(); expect(next()).toBeDisabled();
  fireEvent.click(previous()); await range('Showing 51–100 of 123 tickets');
  expect(listCalls().map(q => q.offset)).toEqual(['0', '50', '100', '50']);
});

test('status and priority filters reset page and remain applied while paging', async () => {
  await mount(); fireEvent.click(next()); await range('Showing 51–100 of 123 tickets');
  await choose('Filter ticket status', 'Closed'); await range('Showing 1–50 of 61 tickets');
  fireEvent.click(next()); await range('Showing 51–61 of 61 tickets');
  expect(listCalls().at(-1)).toMatchObject({ offset: '50', status: 'closed' });
  await choose('Filter ticket priority', 'High'); await range('Showing 1–20 of 20 tickets');
  expect(listCalls().at(-1)).toMatchObject({ offset: '0', status: 'closed', priority: 'high' });
});

test('submitted search resets offset and encodes the complete query', async () => {
  data[100].subject = 'Review & followup? note'; await mount();
  fireEvent.click(next()); await range('Showing 51–100 of 123 tickets');
  const search = screen.getByRole('textbox', { name: 'Search tickets...' });
  fireEvent.change(search, { target: { value: 'Review & followup?' } });
  fireEvent.keyDown(search, { key: 'Enter' }); await range('Showing 1–1 of 1 tickets');
  expect(screen.getByText('Review & followup? note')).toBeInTheDocument();
  expect(listCalls().at(-1)).toMatchObject({ offset: '0', search: 'Review & followup?' });
  expect(next()).toBeDisabled();
});

test('unsubmitted search text does not alter page or refresh query', async () => {
  await mount(); fireEvent.change(screen.getByRole('textbox', { name: 'Search tickets...' }), { target: { value: 'not submitted' } });
  fireEvent.click(next()); await range('Showing 51–100 of 123 tickets');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await range('Showing 51–100 of 123 tickets');
  expect(listCalls().slice(-2).every(q => !q.search && q.offset === '50')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Search tickets' })); await range('Showing 0–0 of 0 tickets');
  expect(listCalls().at(-1)).toMatchObject({ offset: '0', search: 'not submitted' });
});

test('stale old page cannot overwrite a newer filter result', async () => {
  await mount(); const request = holdList(q => q.offset === '50'); fireEvent.click(next());
  await choose('Filter ticket status', 'Closed'); await range('Showing 1–50 of 61 tickets');
  await finish(request, { tickets: makeTickets(123).slice(50, 100), total: 123, offset: 50, limit: 50 });
  expect(screen.getByText('Showing 1–50 of 61 tickets')).toBeInTheDocument();
  expect(screen.queryByText('Request 1')).not.toBeInTheDocument();
});

test('stale old failure cannot replace a newer filter result with an error', async () => {
  await mount(); const request = holdList(q => q.offset === '50'); fireEvent.click(next());
  await choose('Filter ticket status', 'Closed'); await range('Showing 1–50 of 61 tickets'); await fail(request);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(next()).toBeEnabled();
});

test('failed page is unavailable and retry repeats its offset without mutation', async () => {
  await mount(); const request = holdList(q => q.offset === '50'); fireEvent.click(next());
  expect(screen.getByRole('status')).toHaveTextContent('Loading tickets');
  expect(next()).toBeDisabled(); expect(previous()).toBeDisabled(); await fail(request);
  expect(screen.getByRole('alert')).toHaveTextContent('Failed to load tickets');
  expect(screen.queryByText('No tickets found')).not.toBeInTheDocument();
  expect(screen.queryByText('Request 1')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry ticket list' })); await range('Showing 51–100 of 123 tickets');
  expect(listCalls().slice(-2).map(q => q.offset)).toEqual(['50', '50']);
  expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.put).not.toHaveBeenCalled();
});

test('refresh clamps an invalid last page after the matching total shrinks', async () => {
  await mount(); fireEvent.click(next()); await range('Showing 51–100 of 123 tickets');
  fireEvent.click(next()); await range('Showing 101–123 of 123 tickets');
  data = data.slice(0, 60); fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await range('Showing 51–60 of 60 tickets'); expect(next()).toBeDisabled();
  expect(listCalls().slice(-2).map(q => q.offset)).toEqual(['100', '50']);
});

test('refresh returns an emptied later page to the empty first page', async () => {
  await mount(); fireEvent.click(next()); await range('Showing 51–100 of 123 tickets');
  data = []; fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); await range('Showing 0–0 of 0 tickets');
  expect(screen.getByText('Page 1 of 1')).toBeInTheDocument(); expect(previous()).toBeDisabled(); expect(next()).toBeDisabled();
  expect(listCalls().at(-1).offset).toBe('0');
});

test('detail and per-ticket drafts remain attached across pages', async () => {
  await mount(); fireEvent.click(screen.getByText('Request 1')); await screen.findByText('Ticket: TEST-001');
  fireEvent.change(screen.getByRole('textbox', { name: 'Type your reply...' }), { target: { value: 'Only T1' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Internal note' }));
  fireEvent.click(next()); await range('Showing 51–100 of 123 tickets');
  expect(screen.getByText('Ticket: TEST-001')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Request 51')); await screen.findByText('Ticket: TEST-051');
  expect(screen.getByRole('textbox', { name: 'Type your reply...' })).toHaveValue('');
  fireEvent.click(previous()); await range('Showing 1–50 of 123 tickets');
  fireEvent.click(screen.getByText('Request 1')); await screen.findByText('Ticket: TEST-001');
  expect(screen.getByRole('textbox', { name: 'Type your reply...' })).toHaveValue('Only T1');
  expect(screen.getByRole('checkbox', { name: 'Internal note' })).toBeChecked();
});

test('late ticket update refreshes the current page with the current filters', async () => {
  await mount(); fireEvent.click(screen.getByText('Request 1')); await screen.findByText('Ticket: TEST-001');
  const update = pending(); apiClient.put.mockReturnValueOnce(update.promise);
  await choose('Ticket priority', 'Low');
  await choose('Filter ticket status', 'Closed'); await range('Showing 1–50 of 61 tickets');
  fireEvent.click(next()); await range('Showing 51–61 of 61 tickets'); await finish(update, { success: true });
  await waitFor(() => expect(listCalls().at(-1)).toMatchObject({ offset: '50', status: 'closed' }));
  await range('Showing 51–61 of 61 tickets'); expect(apiClient.put).toHaveBeenCalledTimes(1);
});

test('repeated next activation while pending cannot skip a page', async () => {
  await mount(); const request = holdList(q => q.offset === '50');
  fireEvent.click(next()); fireEvent.click(next());
  expect(listCalls().map(q => q.offset)).toEqual(['0', '50']);
  await finish(request, responseFor({ offset: '50', limit: '50' })); await range('Showing 51–100 of 123 tickets');
});

test('account changes invalidate an older page response', async () => {
  const view = await mount(); const request = holdList(q => q.offset === '50'); fireEvent.click(next());
  mockUser = { id: 'fictional-second-admin' }; view.rerender(<AdminSupportDashboard />);
  await range('Showing 1–50 of 123 tickets'); await finish(request, responseFor({ offset: '50', limit: '50' }));
  expect(screen.getByText('Showing 1–50 of 123 tickets')).toBeInTheDocument();
  expect(screen.getByText('Request 1')).toBeInTheDocument();
});

test('a malformed page cannot claim a successful empty list', async () => {
  const request = holdList(q => q.offset === '0'); render(<AdminSupportDashboard />);
  await finish(request, { tickets: [], total: 'unknown' });
  expect(screen.getByRole('alert')).toHaveTextContent('Failed to load tickets');
  expect(screen.queryByText('No tickets found')).not.toBeInTheDocument();
});
