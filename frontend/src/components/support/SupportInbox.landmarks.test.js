import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import SupportRoute from './SupportRoute';
import apiClient from '../../lib/apiClient';

// Use the real router; CRA cannot resolve react-router-dom 7 package exports.
jest.mock('react-router-dom', () => {
  global.TextEncoder = global.TextEncoder || require('util').TextEncoder;
  global.TextDecoder = global.TextDecoder || require('util').TextDecoder;
  return jest.requireActual('react-router');
}, { virtual: true });
let mockTheme = 'light';
const mockUser = { id: 'synthetic-landmark-owner', role: 'Surfer' };
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser, loading: false }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
// Unrelated shell chrome and device services are boundaries; the route, auth gate,
// ToS gate, layout's main and inbox/forms/UI primitives remain production code.
jest.mock('../Sidebar', () => ({ Sidebar: () => null }));
jest.mock('../RightSidebar', () => ({ RightSidebar: () => null }));
jest.mock('../TopNav', () => ({ TopNav: () => null }));
jest.mock('../BottomNav', () => ({ BottomNav: () => null }));
jest.mock('../ActiveSessionBanner', () => ({ ActiveSessionBanner: () => null }));
jest.mock('../ImpersonationBanner', () => ({ __esModule: true, default: () => null }));
jest.mock('../PersonaMaskBanner', () => ({ __esModule: true, default: () => null }));
jest.mock('../ViolationBanner', () => ({ __esModule: true, default: () => null }));
jest.mock('../PushNotificationPrompt', () => ({ __esModule: true, default: () => null }));
jest.mock('../GromSafetyGate', () => ({ __esModule: true, default: ({ children }) => children }));
jest.mock('../../hooks/usePushNotifications', () => ({ usePushNotifications: () => ({}), hasPushOptIn: () => false }));
jest.mock('../../hooks/useWebRTCCall', () => ({ useWebRTCCall: () => ({}), CALL_STATE: {} }));
jest.mock('../messages/IncomingCallModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../messages/OutgoingCallModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../messages/InCallView', () => ({ __esModule: true, default: () => null }));
jest.mock('../messages/PermissionDeniedModal', () => ({ __esModule: true, default: () => null }));

const ID = '44444444-4444-4444-8444-444444444444';
const row = { id: ID, subject: 'Synthetic support question', ticket_number: 'TEST-1', status: 'open' };
const detail = { ...row, description: 'Synthetic description', messages: [{ id: 'reply-1', message: 'Synthetic public reply', from_support: true }] };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const Location = () => <output data-testid="route">{useLocation().pathname}</output>;
const mount = deep => render(<MemoryRouter initialEntries={[deep ? `/support/tickets/${ID}` : '/support']}>
  <Routes>
    <Route path="/support" element={<SupportRoute />} />
    <Route path="/support/tickets/:ticketId" element={<SupportRoute />} />
  </Routes><Location />
</MemoryRouter>);
const expectLandmarks = () => {
  // Global role query catches duplicate main roles as well as native nested mains.
  const mains = screen.getAllByRole('main');
  expect(mains).toHaveLength(1);
  const main = mains[0];
  expect(main).toHaveAttribute('id', 'main-content');
  expect(main.querySelector('main, [role="main"]')).toBeNull();
  expect(document.querySelectorAll('#main-content')).toHaveLength(1);
  expect(within(main).getByRole('heading', { name: 'Support inbox' })).toBeInTheDocument();
  for (const name of ['Your support tickets', 'Support conversation', 'New support ticket']) {
    expect(within(main).getByRole('region', { name })).toBeInTheDocument();
  }
};
beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear();
  apiClient.get.mockResolvedValue({ data: { tickets: [], total: 0 } });
  Element.prototype.scrollIntoView = jest.fn();
});

describe.each(['light', 'dark', 'beach'])('%s production support landmarks', theme => {
  beforeEach(() => { mockTheme = theme; });
  describe.each([390, 1440])('%s px synthetic viewport', width => {
    beforeEach(() => { window.innerWidth = width; });
    test('list loading keeps one global main and named regions', async () => {
      const list = deferred(); apiClient.get.mockReturnValue(list.promise);
      mount(false);
      expect(screen.getByText('Loading tickets…')).toBeInTheDocument();
      // Settle the read without changing the loading observation or leaking work.
      expectLandmarks();
      await act(async () => list.resolve({ data: { tickets: [], total: 0 } }));
    });
    test('empty inbox retains create form and skip target', async () => {
      mount(false);
      await screen.findByText('No support tickets yet.');
      expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue('');
      expect(screen.getByRole('textbox', { name: 'How can we help?' })).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Create ticket' })).toBeDisabled();
      expectLandmarks();
    });
    test('list error and retry preserve landmark structure and read URL', async () => {
      apiClient.get.mockRejectedValueOnce(new Error('Synthetic list failure'));
      mount(false);
      await screen.findByRole('alert');
      expectLandmarks();
      fireEvent.click(screen.getByRole('button', { name: 'Retry tickets' }));
      await screen.findByText('No support tickets yet.');
      expect(apiClient.get.mock.calls).toEqual([['/support/tickets?limit=50&offset=0'], ['/support/tickets?limit=50&offset=0']]);
      expect(apiClient.post).not.toHaveBeenCalled();
      expectLandmarks();
    });
    test('deep-link conversation and return retain real router and named sections', async () => {
      apiClient.get.mockImplementation(url => Promise.resolve({ data: url.includes('?') ? { tickets: [row], total: 1 } : detail }));
      mount(true);
      await screen.findByText('Synthetic public reply');
      expect(screen.getByRole('list', { name: 'Public replies' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Your reply' })).toHaveValue('');
      expect(apiClient.get).toHaveBeenCalledWith(`/support/tickets/${ID}`);
      expectLandmarks();
      fireEvent.click(screen.getByRole('button', { name: 'Back to inbox' }));
      await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent(/^\/support$/));
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Your tickets' })).toHaveFocus());
      expectLandmarks();
    });
    test('deep-link loading keeps the conversation region inside the global main', async () => {
      const request = deferred();
      apiClient.get.mockImplementation(url => url.includes('?') ? Promise.resolve({ data: { tickets: [row], total: 1 } }) : request.promise);
      mount(true);
      await screen.findByText('1 tickets · Page 1');
      expect(screen.getByText('Loading conversation…')).toBeInTheDocument();
      expectLandmarks();
      await act(async () => request.resolve({ data: detail }));
    });
    test('deep-link read error retains named conversation and retry control', async () => {
      apiClient.get.mockImplementation(url => url.includes('?') ? Promise.resolve({ data: { tickets: [], total: 0 } }) : Promise.reject(new Error('Synthetic detail failure')));
      mount(true);
      await screen.findByText('Ticket unavailable or you do not have access.');
      expect(screen.getByRole('button', { name: 'Retry conversation' })).toBeEnabled();
      expect(apiClient.post).not.toHaveBeenCalled();
      expectLandmarks();
    });
  });
});