/**
 * THE UPDATED-TERMS GATE RECORDS ACCEPTANCE ONLY FROM THE USER'S OWN TICK AND CLICK.
 *
 * Why this is pinned (2026-10-23): a live trace of dev saw POST /api/compliance/acknowledge-tos?user_id=... during a
 * page load that its agent did not click through. That URL shape is only this gate's `handleAccept`. Offline
 * (`scripts/offline-backend/scn_request_rates.js`, phase `tos`) the dialog stayed up for 60 s with 0 POSTs and the
 * tick + click sent exactly 1, so the app does not accept by itself; this keeps it that way.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import apiClient from '../../lib/apiClient';
import TosReacceptanceGate from './TosReacceptanceGate';

const posts = () => apiClient.post.mock.calls.filter(([url]) => url === '/compliance/acknowledge-tos');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('raw-surf-user', JSON.stringify({ id: 'u1', access_token: 'test-only' }));
  apiClient.get.mockImplementation((url) => Promise.resolve({
    data: url.startsWith('/compliance/tos-status/') ? { acknowledged: false } : { sections: [{ title: 'T', body: 'B' }] },
  }));
  apiClient.post.mockResolvedValue({ data: {} });
});

it('shows the dialog and posts nothing on its own', async () => {
  render(<TosReacceptanceGate><p>app</p></TosReacceptanceGate>);
  await screen.findByRole('dialog');
  await act(() => new Promise((r) => setTimeout(r, 50)));
  expect(posts()).toHaveLength(0);
});

it('the accept button does nothing until the box is ticked', async () => {
  render(<TosReacceptanceGate><p>app</p></TosReacceptanceGate>);
  await screen.findByRole('dialog');
  const accept = screen.getByTestId('tos-gate-accept-button');
  expect(accept).toBeDisabled();
  fireEvent.click(accept);
  expect(posts()).toHaveLength(0);
});

it('records acceptance once after the tick and the click', async () => {
  render(<TosReacceptanceGate><p>app</p></TosReacceptanceGate>);
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByTestId('tos-gate-accept-button'));
  await waitFor(() => expect(posts()).toHaveLength(1));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
