import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import apiClient from '../../lib/apiClient';
import { toast } from 'sonner';
import { AdminSupportDashboard } from './AdminSupportDashboard';

let mockTheme = 'light';
let mockUser = { id: 'fixture-admin' };
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const tickets = ['A', 'B'].map(id => ({
  id, ticket_number: `TEST-${id}`, subject: `${id} request`, user_name: `Fixture ${id}`,
  user_email: `${id.toLowerCase()}@example.invalid`, priority: 'medium', status: 'open',
}));
const detail = id => ({
  ...tickets.find(ticket => ticket.id === id), description: `Details for ${id}`,
  category: 'other', user: { id: `fixture-${id}` }, messages: [],
});
const pending = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
let detailQueue;
const queueDetail = id => {
  const request = pending();
  (detailQueue[id] ||= []).push(request);
  return request;
};
const finish = async (request, data) => act(async () => { request.resolve({ data }); });
const fail = async request => act(async () => { request.reject(new Error('fixture read failed')); });
const select = id => fireEvent.click(screen.getByText(`${id} request`));
const open = async id => {
  await screen.findByText(`${id} request`);
  select(id);
  await screen.findByText(`Ticket: TEST-${id}`);
};
const editor = () => screen.getByRole('textbox', { name: 'Type your reply...' });
const send = () => screen.getByRole('button', { name: /Send Reply|Add Note|Loader2/ });
const draft = text => fireEvent.change(editor(), { target: { value: text } });
const mount = async () => {
  const view = render(<AdminSupportDashboard />);
  await screen.findByText('A request');
  return view;
};

beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.HTMLElement.prototype.releasePointerCapture = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.PointerEvent = MouseEvent;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockTheme = 'light';
  mockUser = { id: 'fixture-admin' };
  detailQueue = {};
  apiClient.get.mockImplementation(url => {
    if (url.startsWith('/admin/support/tickets?')) return Promise.resolve({ data: { tickets, total: 2 } });
    if (url.startsWith('/admin/support/metrics?')) return Promise.resolve({ data: null });
    const id = url.split('/').pop();
    return detailQueue[id]?.length ? detailQueue[id].shift().promise : Promise.resolve({ data: detail(id) });
  });
  apiClient.post.mockResolvedValue({ data: { success: true } });
  apiClient.put.mockResolvedValue({ data: { success: true } });
});

test('selection clears the previous editor while the next ticket is loading', async () => {
  await mount(); await open('A'); draft('Only for A');
  queueDetail('B'); select('B');
  expect(screen.queryByText('Details for A')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Type your reply...' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Loading ticket details');
});

test('late older selection cannot replace the latest detail', async () => {
  await mount();
  const first = queueDetail('A'); const last = queueDetail('B');
  select('A'); select('B');
  await finish(last, detail('B')); await finish(first, detail('A'));
  expect(screen.getByText('Ticket: TEST-B')).toBeInTheDocument();
  expect(screen.queryByText('Details for A')).not.toBeInTheDocument();
});

test('A to B to A ignores the first request for the same ticket', async () => {
  await mount();
  const first = queueDetail('A'); const middle = queueDetail('B'); const latest = queueDetail('A');
  select('A'); select('B'); select('A');
  await finish(latest, { ...detail('A'), description: 'Newest A data' });
  await finish(first, { ...detail('A'), description: 'Old A data' });
  await finish(middle, detail('B'));
  expect(screen.getByText('Newest A data')).toBeInTheDocument();
  expect(screen.queryByText('Old A data')).not.toBeInTheDocument();
});

test('failed selection shows no previous editor and retry loads only that selection', async () => {
  await mount(); await open('A');
  const request = queueDetail('B'); select('B'); await fail(request);
  expect(screen.queryByText('Details for A')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Type your reply...' })).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Failed to load ticket details');
  fireEvent.click(screen.getByRole('button', { name: 'Retry ticket details' }));
  await screen.findByText('Ticket: TEST-B');
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('stale detail failure cannot replace a newer success or show its error', async () => {
  await mount(); const request = queueDetail('A');
  select('A'); await open('B'); await fail(request);
  expect(screen.getByText('Ticket: TEST-B')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(toast.error).not.toHaveBeenCalled();
});

test('stale completion cannot stop the current loading indicator', async () => {
  await mount(); const first = queueDetail('A'); const last = queueDetail('B');
  select('A'); select('B'); await finish(first, detail('A'));
  expect(screen.getByRole('status')).toHaveTextContent('Loading ticket details');
  expect(screen.queryByRole('textbox', { name: 'Type your reply...' })).not.toBeInTheDocument();
  await finish(last, detail('B'));
});

test.each(['light', 'dark', 'beach'])('%s keeps text and note mode with each ticket', async theme => {
  mockTheme = theme; await mount(); await open('A');
  draft('A private draft'); fireEvent.click(screen.getByRole('checkbox', { name: 'Internal note' }));
  await open('B');
  expect(editor()).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: 'Internal note' })).not.toBeChecked();
  draft('B public draft'); await open('A');
  expect(editor()).toHaveValue('A private draft');
  expect(screen.getByRole('checkbox', { name: 'Internal note' })).toBeChecked();
  await open('B'); expect(editor()).toHaveValue('B public draft');
  expect(screen.getByRole('checkbox', { name: 'Internal note' })).not.toBeChecked();
});

test('reply completion for A cannot erase B draft or replace B detail', async () => {
  await mount(); await open('A'); draft('A private message');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Internal note' }));
  const reply = pending(); apiClient.post.mockReturnValueOnce(reply.promise);
  fireEvent.click(send()); await open('B'); draft('B draft during A send');
  const callsBefore = apiClient.get.mock.calls.filter(([url]) => url === '/admin/support/tickets/A').length;
  await finish(reply, { success: true });
  expect(editor()).toHaveValue('B draft during A send');
  expect(screen.getByText('Ticket: TEST-B')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Internal note' })).not.toBeChecked();
  expect(apiClient.get.mock.calls.filter(([url]) => url === '/admin/support/tickets/A')).toHaveLength(callsBefore);
  expect(apiClient.post).toHaveBeenCalledWith('/admin/support/tickets/A/reply', {
    message: 'A private message', is_internal_note: true, client_message_id: expect.any(String),
  });
  await open('A'); expect(editor()).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: 'Internal note' })).not.toBeChecked();
});

test('failed reply preserves the original draft and other ticket state', async () => {
  await mount(); await open('A'); draft('Retry me for A');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Internal note' }));
  const reply = pending(); apiClient.post.mockReturnValueOnce(reply.promise);
  fireEvent.click(send()); await open('B'); draft('B stays'); await fail(reply);
  expect(editor()).toHaveValue('B stays');
  await open('A'); expect(editor()).toHaveValue('Retry me for A');
  expect(screen.getByRole('checkbox', { name: 'Internal note' })).toBeChecked();
});

test('same-ticket reply refresh retains selection and clears only the sent draft', async () => {
  await mount(); await open('A'); draft('A public reply');
  fireEvent.click(send());
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
  await screen.findByText('Ticket: TEST-A');
  expect(editor()).toHaveValue('');
  expect(apiClient.post).toHaveBeenCalledWith('/admin/support/tickets/A/reply', {
    message: 'A public reply', is_internal_note: false, client_message_id: expect.any(String),
  });
});

test('an update started on A cannot reload A over newly selected B', async () => {
  await mount(); await open('A');
  const update = pending(); apiClient.put.mockReturnValueOnce(update.promise);
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Ticket status' }));
  await user.click(screen.getByRole('option', { name: 'Resolved', exact: true }));
  await open('B'); draft('B survives update');
  await finish(update, { success: true });
  expect(screen.getByText('Ticket: TEST-B')).toBeInTheDocument();
  expect(editor()).toHaveValue('B survives update');
  expect(apiClient.put).toHaveBeenCalledWith('/admin/support/tickets/A', { status: 'resolved' });
});

test('ticket buttons support keyboard selection and name reply actions meaningfully', async () => {
  await mount(); const user = userEvent.setup();
  const ticket = screen.getByRole('button', { name: /TEST-A/ });
  ticket.focus(); await user.keyboard('{Enter}');
  await screen.findByText('Ticket: TEST-A');
  expect(ticket).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Send Reply', exact: true })).toBeDisabled();
  draft('  '); expect(send()).toBeDisabled();
  draft('ready'); expect(send()).toBeEnabled();
});

test('rapid repeated send activation creates one request', async () => {
  await mount(); await open('A'); draft('Send once');
  const reply = pending(); apiClient.post.mockReturnValue(reply.promise);
  fireEvent.click(send()); fireEvent.click(send());
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  await finish(reply, { success: true });
});

test('unmount discards a late detail error', async () => {
  const view = await mount(); const request = queueDetail('A'); select('A');
  view.unmount(); await fail(request);
  expect(toast.error).not.toHaveBeenCalled();
});

test('a mismatched detail response is unavailable rather than an actionable wrong ticket', async () => {
  await mount(); const request = queueDetail('A'); select('A');
  await finish(request, detail('B'));
  expect(screen.getByRole('alert')).toHaveTextContent('Failed to load ticket details');
  expect(screen.queryByRole('textbox', { name: 'Type your reply...' })).not.toBeInTheDocument();
});

test('changing admin clears drafts and ignores a previous-account detail callback', async () => {
  const view = await mount(); await open('A'); draft('First admin draft');
  const request = queueDetail('B'); select('B');
  mockUser = { id: 'fixture-second-admin' }; view.rerender(<AdminSupportDashboard />);
  await finish(request, detail('B'));
  expect(screen.queryByText('Ticket: TEST-B')).not.toBeInTheDocument();
  await open('A'); expect(editor()).toHaveValue('');
});

test('changing admin ignores the previous-account reply completion', async () => {
  const view = await mount(); await open('A'); draft('Previous account reply');
  const reply = pending(); apiClient.post.mockReturnValueOnce(reply.promise); fireEvent.click(send());
  mockUser = { id: 'fixture-second-admin' }; view.rerender(<AdminSupportDashboard />);
  await open('A'); draft('New admin draft'); await finish(reply, { success: true });
  expect(editor()).toHaveValue('New admin draft');
  expect(toast.success).not.toHaveBeenCalled();
});

test('late reply failure after unmount has no stale notification', async () => {
  const view = await mount(); await open('A'); draft('Unfinished reply');
  const reply = pending(); apiClient.post.mockReturnValueOnce(reply.promise); fireEvent.click(send());
  view.unmount(); await fail(reply);
  expect(toast.error).not.toHaveBeenCalled();
});

test('post-update refresh supersedes a detail read already in flight', async () => {
  await mount(); await open('A');
  const update = pending(); apiClient.put.mockReturnValueOnce(update.promise);
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Ticket priority' }));
  await user.click(screen.getByRole('option', { name: 'High', exact: true }));
  await open('B'); const old = queueDetail('A'); select('A');
  const fresh = queueDetail('A'); await finish(update, { success: true });
  await finish(fresh, { ...detail('A'), description: 'Updated ticket data' });
  await finish(old, { ...detail('A'), description: 'Pre-update ticket data' });
  expect(screen.getByText('Updated ticket data')).toBeInTheDocument();
  expect(screen.queryByText('Pre-update ticket data')).not.toBeInTheDocument();
  expect(apiClient.put).toHaveBeenCalledWith('/admin/support/tickets/A', { priority: 'high' });
});


test('reply retry retains request ID and changed note intent receives a new ID', async () => {
  await mount(); await open('A'); draft('Retry safely');
  apiClient.post.mockRejectedValueOnce(new Error('Fictional lost response'));
  fireEvent.click(send()); await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to send reply'));
  const original = apiClient.post.mock.calls[0][1].client_message_id;
  expect(original).toMatch(/^[0-9a-f-]{36}$/i);
  apiClient.post.mockRejectedValueOnce(new Error('Fictional second lost response'));
  fireEvent.click(send()); await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
  expect(apiClient.post.mock.calls[1][1].client_message_id).toBe(original);
  await waitFor(() => expect(send()).not.toBeDisabled());
  fireEvent.click(screen.getByRole('checkbox', { name: 'Internal note' }));
  fireEvent.click(send()); await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(3));
  expect(apiClient.post.mock.calls[2][1].client_message_id).not.toBe(original);
});

// jsdom does not provide the browser Web Crypto API in this dependency version.
beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { value: require('crypto').webcrypto, configurable: true }); });
