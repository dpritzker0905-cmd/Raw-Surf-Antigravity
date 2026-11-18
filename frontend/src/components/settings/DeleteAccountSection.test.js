/**
 * Account deletion (GDPR Art. 17) must reach the backend and must end the session (audit 2026-10-18, F-06), and by
 * default it is SCHEDULED with a 30-day restore window (David, 2026-11-18); "Delete everything now" erases at once.
 *
 * The earlier defects: the call went to '/api/compliance/delete-my-data' on an axios base URL that already ends in
 * /api, so it requested /api/api/... and ALWAYS 404ed; and its success path never called logout().
 *
 * These tests use the REAL apiClient with a stub transport, so the URL asserted is the one that would be requested.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockLogout = jest.fn();
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ logout: mockLogout }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import apiClient from '../../lib/apiClient';
import DeleteAccountSection from './DeleteAccountSection';

let requested;
let respond;
beforeEach(() => {
  requested = [];
  mockLogout.mockReset();
  respond = (config) => Promise.resolve({
    data: { mode: 'scheduled', purge_after: '2026-12-18T20:00:00+00:00', restore_email_sent: true },
    status: 200, statusText: 'OK', headers: {}, config,
  });
  apiClient.defaults.adapter = (config) => {
    requested.push({ method: config.method, url: `${config.baseURL}${config.url}`, params: config.params || {} });
    return respond(config);
  };
});

const confirmDeletion = ({ now = false } = {}) => {
  render(<DeleteAccountSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Request Data Deletion' }));
  if (now) fireEvent.click(screen.getByRole('checkbox', { name: /delete everything now/i }));
  fireEvent.change(screen.getByLabelText(/type delete to confirm/i), { target: { value: 'DELETE' } });
  fireEvent.click(screen.getByRole('button', { name: now ? 'Delete Forever' : 'Delete in 30 Days' }));
};

it('schedules the deletion by default: one POST to /api/compliance/delete-my-data, no doubled /api, no immediate flag', async () => {
  confirmDeletion();
  await waitFor(() => expect(requested).toHaveLength(1));
  expect(requested[0].method).toBe('post');
  expect(requested[0].url).toMatch(/\/api\/compliance\/delete-my-data$/);
  expect(requested[0].url).not.toMatch(/\/api\/api\//);
  expect(requested[0].params).toEqual({});
});

it('ends the session and explains the 30-day restore window', async () => {
  confirmDeletion();
  await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Account scheduled for deletion');
  expect(status).toHaveTextContent(/restore it before then, use the link we emailed you/i);
});

it('"Delete everything now" asks the backend for an immediate erasure', async () => {
  respond = (config) => Promise.resolve({ data: { mode: 'immediate' }, status: 200, statusText: 'OK', headers: {}, config });
  confirmDeletion({ now: true });
  await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  expect(requested[0].params).toEqual({ immediate: true });
  expect(screen.getByRole('status')).toHaveTextContent('Account data deleted');
});

it('keeps the session and says why when the backend refuses', async () => {
  respond = (config) => Promise.reject(Object.assign(new Error('nope'), {
    config, response: { status: 500, data: { detail: 'Deletion failed' } },
  }));
  confirmDeletion();
  expect(await screen.findByRole('alert')).toHaveTextContent('Deletion failed');
  expect(mockLogout).not.toHaveBeenCalled();
});
