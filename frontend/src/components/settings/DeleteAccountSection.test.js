/**
 * Account deletion (GDPR Art. 17) must reach the backend and must end the session (audit 2026-10-18, F-06).
 *
 * The defects: the call went to '/api/compliance/delete-my-data' on an axios base URL that already ends in /api, so
 * it requested /api/api/compliance/delete-my-data and ALWAYS 404ed (nobody could delete their data from the app);
 * and its success path never called logout(), so the deleted account's session stayed live.
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
  respond = (config) => Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
  apiClient.defaults.adapter = (config) => {
    requested.push({ method: config.method, url: `${config.baseURL}${config.url}` });
    return respond(config);
  };
});

const confirmDeletion = () => {
  render(<DeleteAccountSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Request Data Deletion' }));
  fireEvent.change(screen.getByLabelText(/type delete to confirm/i), { target: { value: 'DELETE' } });
  fireEvent.click(screen.getByRole('button', { name: 'Delete Forever' }));
};

it('posts to /api/compliance/delete-my-data exactly once (no doubled /api prefix)', async () => {
  confirmDeletion();
  await waitFor(() => expect(requested).toHaveLength(1));
  expect(requested[0].method).toBe('post');
  expect(requested[0].url).toMatch(/\/api\/compliance\/delete-my-data$/);
  expect(requested[0].url).not.toMatch(/\/api\/api\//);
});

it('ends the session (logout) once the backend has deleted the account', async () => {
  confirmDeletion();
  await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
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
