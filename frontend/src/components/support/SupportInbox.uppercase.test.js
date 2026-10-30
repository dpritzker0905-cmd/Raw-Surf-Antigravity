import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { webcrypto } from 'crypto';
import apiClient from '../../lib/apiClient';
import SupportInbox from './SupportInbox';
import { canonicalSupportTicketId, supportAuthParams, supportReturnPath } from './supportRoutes';

let mockTicket;
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useParams: () => ({ ticketId: mockTicket }), useNavigate: () => mockNavigate }), { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fictional-owner' }, loading: false }) }));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
const ID = 'abcdef01-2345-4789-abcd-ef0123456789';
const row = { id: ID, ticket_number: 'TEST-CASE', subject: 'Synthetic case request', description: 'Synthetic case details', messages: [] };

beforeEach(() => {
  jest.clearAllMocks(); mockTicket = ID.toUpperCase();
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  apiClient.get.mockImplementation(url => Promise.resolve({ data: url.includes('?') ? { total: 1, tickets: [row] } : row }));
  apiClient.post.mockResolvedValue({ data: {} });
});

test('uppercase route requests and displays canonical ticket and selected row', async () => {
  render(<SupportInbox />);
  await screen.findByText('Synthetic case details');
  expect(apiClient.get).toHaveBeenCalledWith(`/support/tickets/${ID}`);
  expect(screen.getByRole('button', { name: /TEST-CASE Synthetic case request/ })).toHaveAttribute('aria-pressed', 'true');
});

test('case aliases share the same memory draft and do not issue a second detail read', async () => {
  const view = render(<SupportInbox />); await screen.findByText('Synthetic case details');
  fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Retain across case aliases' } });
  mockTicket = ID; view.rerender(<SupportInbox />);
  expect(screen.getByLabelText('Your reply')).toHaveValue('Retain across case aliases');
  expect(apiClient.get.mock.calls.filter(([url]) => !url.includes('?'))).toHaveLength(1);
});

test('uppercase reply and lost-ack retry use canonical endpoint and one request key', async () => {
  apiClient.post.mockRejectedValueOnce(new Error('Synthetic lost acknowledgement')).mockResolvedValueOnce({ data: {} });
  render(<SupportInbox />); await screen.findByText('Synthetic case details');
  fireEvent.change(screen.getByLabelText('Your reply'), { target: { value: 'Synthetic reply' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
  await screen.findByText(/Reply not confirmed/);
  fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
  await waitFor(() => expect(screen.getByLabelText('Your reply')).toHaveValue(''));
  expect(apiClient.post).toHaveBeenCalledTimes(2);
  expect(apiClient.post.mock.calls[0][0]).toBe(`/support/tickets/${ID}/messages`);
  expect(apiClient.post.mock.calls[0]).toEqual(apiClient.post.mock.calls[1]);
});

test('case normalization never accepts another resource response', async () => {
  apiClient.get.mockImplementation(url => Promise.resolve({ data: url.includes('?') ? { total: 1, tickets: [row] } : {
    ...row, id: 'fedcba10-4321-4897-bcde-9876543210ab', description: 'Other resource sentinel',
  } }));
  render(<SupportInbox />);
  await screen.findByText('Ticket unavailable.');
  expect(screen.queryByText('Other resource sentinel')).not.toBeInTheDocument();
});

test('normalizers accept only existing hyphenated UUID shape and preserve safe return rules', () => {
  expect(canonicalSupportTicketId(ID.toUpperCase())).toBe(ID);
  expect(canonicalSupportTicketId('opaque-Legacy')).toBe('opaque-Legacy');
  expect(canonicalSupportTicketId(undefined)).toBeUndefined();
  expect(supportReturnPath(`/support/tickets/${ID.toUpperCase()}`)).toBe(`/support/tickets/${ID}`);
  expect(supportAuthParams(new URLSearchParams({ redirect: `/support/tickets/${ID.toUpperCase()}` }), { tab: 'login' }))
    .toEqual({ tab: 'login', redirect: `/support/tickets/${ID}` });
  for (const value of [`/support/tickets/${ID.replaceAll('-', '')}`, `/support/tickets/{${ID}}`,
    `/support/tickets/${ID}?next=elsewhere`, `https://outside.invalid/support/tickets/${ID}`]) expect(supportReturnPath(value)).toBeNull();
});
