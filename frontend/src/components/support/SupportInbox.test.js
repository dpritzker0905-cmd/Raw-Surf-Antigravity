import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import apiClient from '../../lib/apiClient';
import SupportInbox from './SupportInbox';
import { supportAuthParams, supportReturnPath } from './supportRoutes';

let mockUser = { id: 'fixture-owner' };
let mockTicket;
let mockRerender;
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useParams: () => ({ ticketId: mockTicket }),
  useNavigate: () => path => { mockNavigate(path); mockTicket = path.split('/').pop(); mockRerender?.(); },
}), { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, loading: false }) }));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
const A = '44444444-4444-4444-8444-444444444444';
const B = '55555555-5555-4555-8555-555555555555';
const rows = [A, B].map((id, i) => ({ id, ticket_number: `TEST-${i}`, subject: `Request ${i}`, status: 'open' }));
const detail = id => ({ ...rows.find(row => row.id === id), description: `Description ${id}`, messages: [
  { id: 'public', from_support: true, message: 'Public staff reply' },
] });
const pending = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const mount = (path = '/support') => {
  mockTicket = path.startsWith('/support/tickets/') ? path.split('/').pop() : undefined;
  const view = render(<SupportInbox />);
  mockRerender = () => view.rerender(<SupportInbox />);
  return view;
};
const open = async id => { fireEvent.click(await screen.findByRole('button', { name: new RegExp(rows.find(row => row.id === id).subject) })); await screen.findByText(`Description ${id}`); };
beforeEach(() => {
  jest.clearAllMocks(); mockUser = { id: 'fixture-owner' }; mockTicket = undefined; mockRerender = null;
  apiClient.get.mockImplementation(url => Promise.resolve({ data: url.includes('?') ? { tickets: rows, total: 2 } : detail(url.split('/').pop()) }));
  apiClient.post.mockResolvedValue({ data: { success: true, ticket_id: A } });
});
test('owner reads route conversation and sends only a public keyed message', async () => {
  mount(`/support/tickets/${A}`); await screen.findByText('Public staff reply');
  expect(screen.queryByLabelText('Internal note')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Owner response' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(`/support/tickets/${A}/messages`, { message: 'Owner response', client_message_id: expect.any(String) }));
  await waitFor(() => expect(screen.getByLabelText('Your reply')).toHaveValue(''));
});
test('failed reply keeps text and reuses the idempotency key', async () => {
  mount(`/support/tickets/${A}`); await screen.findByText('Public staff reply');
  fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Keep me' } });
  apiClient.post.mockRejectedValueOnce(new Error('Fictional lost response'));
  fireEvent.click(screen.getByRole('button', { name: 'Send reply' })); await screen.findByRole('alert');
  const first = apiClient.post.mock.calls[0][1]; expect(screen.getByLabelText('Your reply')).toHaveValue('Keep me');
  fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
  expect(apiClient.post.mock.calls[1][1]).toEqual(first);
});
test('selection races discard old detail and keep drafts by ticket', async () => {
  const old = pending();
  apiClient.get.mockImplementation(url => url === `/support/tickets/${A}` ? old.promise : Promise.resolve({ data: url.includes('?') ? { tickets: rows, total: 2 } : detail(B) }));
  mount(); fireEvent.click(await screen.findByRole('button', { name: /Request 0/ }));
  await open(B); fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'B draft' } });
  await act(async () => old.resolve({ data: detail(A) }));
  expect(screen.queryByText(`Description ${A}`)).not.toBeInTheDocument(); expect(screen.getByLabelText('Your reply')).toHaveValue('B draft');
});
test('a failed detail has no actionable editor and retry performs GET', async () => {
  apiClient.get.mockImplementation(url => url.includes('?') ? Promise.resolve({ data: { tickets: rows, total: 2 } }) : Promise.reject(new Error('Fictional404')));
  mount(`/support/tickets/${A}`); await screen.findByRole('alert');
  expect(screen.queryByLabelText('Your reply')).not.toBeInTheDocument();
  apiClient.get.mockImplementation(url => Promise.resolve({ data: url.includes('?') ? { tickets: rows, total: 2 } : detail(A) }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry conversation' })); await screen.findByLabelText('Your reply');
  expect(apiClient.post).not.toHaveBeenCalled();
});
test('account change clears old conversation and old pending completions', async () => {
  const old = pending(); apiClient.get.mockImplementation(url => url.includes('?') ? Promise.resolve({ data: { tickets: rows, total: 2 } }) : old.promise);
  const view = mount(`/support/tickets/${A}`); await screen.findByRole('button', { name: /Request 0/ });
  mockUser = null; view.rerender(<SupportInbox />);
  await act(async () => old.resolve({ data: detail(A) }));
  expect(screen.queryByText('Public staff reply')).not.toBeInTheDocument(); expect(screen.getByRole('status')).toHaveTextContent('Sign in');
});
test('new ticket failure preserves a stable request key and success opens its route', async () => {
  mount(); fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'New request' } });
  fireEvent.change(screen.getByLabelText('How can we help?'), { target: { value: 'Description' } });
  apiClient.post.mockRejectedValueOnce(new Error('Fictional lost response'));
  fireEvent.click(screen.getByRole('button', { name: 'Create ticket' })); await screen.findByRole('alert');
  const first = apiClient.post.mock.calls[0][1]; fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(`/support/tickets/${A}`));
  expect(apiClient.post.mock.calls[1][1]).toEqual(first);
});
test('support auth return survives tab/category changes and rejects other destinations', () => {
  const path = `/support/tickets/${A}`; const params = new URLSearchParams({ redirect: path });
  expect(supportAuthParams(params, { tab: 'login' })).toEqual({ tab: 'login', redirect: path });
  expect(supportAuthParams(params, { tab: 'signup', category: 'surfer' })).toEqual({ tab: 'signup', category: 'surfer', redirect: path });
  for (const invalid of ['//outside.invalid', 'https://outside.invalid', '/support/tickets/../admin', `${path}?token=anything`, '/support/tickets/no-id']) expect(supportReturnPath(invalid)).toBeNull();
  expect(supportReturnPath('/support')).toBe('/support');
});

test('all owner tickets remain reachable and failed page retry performs only GET', async () => {
  const many = Array.from({ length: 53 }, (_, index) => ({ id: `page-${index}`, ticket_number: `PAGE-${index}`, subject: `Paged request ${index}`, status: 'open' }));
  let failPage = true;
  apiClient.get.mockImplementation(url => {
    const offset = Number(new URLSearchParams(url.split('?')[1]).get('offset'));
    if (offset === 50 && failPage) return Promise.reject(new Error('Fictional page failure'));
    return Promise.resolve({ data: { tickets: many.slice(offset, offset + 50), total: 53 } });
  });
  mount(); await screen.findByRole('button', { name: /Paged request 49/ });
  fireEvent.click(screen.getByRole('button', { name: 'Next tickets' }));
  await screen.findByRole('alert'); expect(screen.queryByText('No support tickets yet.')).not.toBeInTheDocument();
  failPage = false; fireEvent.click(screen.getByRole('button', { name: 'Retry tickets' }));
  await screen.findByRole('button', { name: /Paged request 52/ });
  expect(screen.getByRole('button', { name: 'Next tickets' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Previous tickets' }));
  await screen.findByRole('button', { name: /Paged request 0 / });
  expect(apiClient.post).not.toHaveBeenCalled();
});

// jsdom does not provide the browser Web Crypto API in this dependency version.
beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { value: require('crypto').webcrypto, configurable: true }); });
