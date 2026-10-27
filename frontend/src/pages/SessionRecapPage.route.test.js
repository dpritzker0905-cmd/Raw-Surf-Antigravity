import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import apiClient from '../lib/apiClient';

const mockUser = { id: 'photographer-a', role: 'Photographer' };
const mockGalleryProps = jest.fn();
// CRA/Jest cannot resolve the v7 DOM package's exports-only entry; use its real core router exports.
jest.mock('react-router-dom', () => jest.requireActual('react-router'), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ AuthProvider: ({ children }) => children, useAuth: () => ({ user: mockUser }) }));
jest.mock('../contexts/ThemeContext', () => ({ ThemeProvider: ({ children }) => children }));
jest.mock('../contexts/PricingContext', () => ({ PricingProvider: ({ children }) => children }));
jest.mock('../contexts/PersonaContext', () => ({ PersonaProvider: ({ children }) => children }));
jest.mock('../components/routing/ErrorBoundary', () => ({ __esModule: true, default: ({ children }) => children }));
jest.mock('../components/routing/ProtectedRoute', () => ({ __esModule: true, default: ({ children }) => children }));
jest.mock('../components/routing/AppLayout', () => ({
  __esModule: true, default: ({ children }) => children,
  CallManager: () => null, PushNotificationInit: () => null, BackButtonHandler: () => null,
}));
jest.mock('../components/AccessCodeScreen', () => ({ __esModule: true, default: ({ children }) => children }));
jest.mock('../components/PushNotificationPrompt', () => () => null);
jest.mock('../components/ui/CookieConsentBanner', () => () => null);
jest.mock('../components/ui/sonner', () => ({ Toaster: () => null }));
jest.mock('../components/Home', () => ({ Home: () => 'Home' }));
jest.mock('../components/Auth', () => ({ Auth: () => null }));
jest.mock('../components/PasswordReset', () => ({ ForgotPassword: () => null, ResetPassword: () => null }));
jest.mock('../utils/audioUnlock', () => ({ ensureAudioUnlocked: jest.fn() }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../components/GalleryPage', () => {
  const React = require('react');
  return { GalleryPage: props => {
    mockGalleryProps(props);
    return React.createElement('section', { 'data-testid': 'recap-gallery' }, props.initialRecapData.gallery.title);
  } };
});

const gallery = (id = 'gallery-a', session = 'session-a', extra = {}) => ({
  id, title: `Gallery ${id}`, live_session_id: session, created_at: new Date().toISOString(), item_count: 2, ...extra,
});
const roster = { participants: [{ surfer_id: 'surfer-a', items_distributed: 1 }], session: { is_linked: true } };
const items = [{ id: 'photo-a' }, { id: 'photo-b' }];
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function respond(galleries = [gallery()]) {
  apiClient.get.mockImplementation(path => {
    if (path.startsWith('/galleries/photographer/')) return Promise.resolve({ data: galleries });
    if (path.endsWith('/session-participants')) return Promise.resolve({ data: roster });
    if (path.endsWith('/items')) return Promise.resolve({ data: items });
    throw new Error(`Unexpected fixture endpoint ${path}`);
  });
}
function open(session = 'session-a') {
  window.history.replaceState({}, '', `/session-recap/${encodeURIComponent(session)}`);
  return render(<App />);
}
beforeEach(() => {
  jest.clearAllMocks();
  respond();
});

test('registered recap route loads the current photographer session, items and roster into the gallery consumer', async () => {
  open();
  expect(await screen.findByTestId('recap-gallery')).toHaveTextContent('Gallery gallery-a');
  expect(apiClient.get).toHaveBeenCalledWith('/galleries/photographer/photographer-a', expect.objectContaining({ signal: expect.any(Object) }));
  expect(apiClient.get).toHaveBeenCalledWith('/galleries/gallery-a/items', expect.objectContaining({ params: { viewer_id: mockUser.id } }));
  expect(apiClient.get).toHaveBeenCalledWith('/gallery/gallery-a/session-participants', expect.objectContaining({ params: { photographer_id: mockUser.id } }));
  expect(mockGalleryProps.mock.calls.at(-1)[0].initialRecapData).toEqual({ gallery: expect.objectContaining({ id: 'gallery-a' }), participants: roster.participants, session: roster.session, items });
});

test('a real empty owner gallery list is an explicit missing recap without item or roster reads', async () => {
  respond([]);
  open();
  expect(await screen.findByRole('alert')).toHaveTextContent(/no gallery.*session/i);
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(mockGalleryProps).not.toHaveBeenCalled();
});

test('denied roster access never becomes an empty successful recap', async () => {
  const base = apiClient.get.getMockImplementation();
  apiClient.get.mockImplementation(path => path.endsWith('/session-participants')
    ? Promise.reject({ response: { status: 403 } }) : base(path));
  open();
  expect(await screen.findByRole('alert')).toHaveTextContent(/access/i);
  expect(mockGalleryProps).not.toHaveBeenCalled();
});

test('old sessions retain their gallery and explicitly explain the recent-summary window', async () => {
  respond([gallery('gallery-a', 'session-a', { created_at: new Date(Date.now() - 72 * 3600000).toISOString() })]);
  open();
  expect(await screen.findByTestId('recap-gallery')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/older than 48 hours/i);
});

test('malformed roster data is unavailable, rather than zero participants', async () => {
  const base = apiClient.get.getMockImplementation();
  apiClient.get.mockImplementation(path => path.endsWith('/session-participants')
    ? Promise.resolve({ data: {} }) : base(path));
  open();
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
  expect(mockGalleryProps).not.toHaveBeenCalled();
});

test('retry recovers a failed read and repeated clicks do not start duplicate loads', async () => {
  const base = apiClient.get.getMockImplementation();
  apiClient.get.mockRejectedValueOnce(new Error('Offline')).mockImplementation(base);
  open();
  const retry = await screen.findByRole('button', { name: /try again/i });
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(await screen.findByTestId('recap-gallery')).toBeInTheDocument();
  expect(apiClient.get.mock.calls.filter(([path]) => path.startsWith('/galleries/photographer/'))).toHaveLength(2);
});

test('switching session aborts and ignores a delayed older response', async () => {
  const old = deferred();
  apiClient.get.mockImplementationOnce(() => old.promise).mockImplementation(path => {
    if (path.startsWith('/galleries/photographer/')) return Promise.resolve({ data: [gallery('gallery-b', 'session-b')] });
    return Promise.resolve({ data: path.endsWith('/items') ? items : roster });
  });
  open();
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
  const firstSignal = apiClient.get.mock.calls[0][1].signal;
  act(() => {
    window.history.pushState({}, '', '/session-recap/session-b');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(await screen.findByTestId('recap-gallery')).toHaveTextContent('Gallery gallery-b');
  await act(async () => { old.resolve({ data: [gallery()] }); });
  expect(firstSignal.aborted).toBe(true);
  expect(screen.getByTestId('recap-gallery')).toHaveTextContent('Gallery gallery-b');
  expect(apiClient.get.mock.calls.some(([path]) => path.includes('/gallery-a/'))).toBe(false);
});

test('multiple galleries require an explicit choice before loading mutation-capable gallery controls', async () => {
  respond([gallery(), gallery('gallery-b')]);
  open();
  expect(await screen.findByText(/choose a gallery/i)).toBeInTheDocument();
  expect(mockGalleryProps).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Gallery gallery-b' }));
  expect(await screen.findByTestId('recap-gallery')).toHaveTextContent('Gallery gallery-b');
  expect(apiClient.get.mock.calls.filter(([path]) => path.startsWith('/galleries/photographer/'))).toHaveLength(1);
});
