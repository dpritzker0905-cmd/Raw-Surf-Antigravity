import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SurfLog from './SurfLog';
import { toast } from 'sonner';

const mockApi = { get: jest.fn(), post: jest.fn(), patch: jest.fn() };
let mockUserId = 'surflog-fixture-owner';
let mockSetup;
let mockPicker;
let mockClose;
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: {
  get: (...args) => mockApi.get(...args), post: (...args) => mockApi.post(...args),
  patch: (...args) => mockApi.patch(...args),
} }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('./ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }) => { mockClose = onOpenChange; return open ? <div>{children}</div> : null; },
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
}));
jest.mock('./PreSessionConfigModal', () => ({ __esModule: true, default: props => { mockSetup = props; return null; } }));
jest.mock('./LocationPicker', () => ({ LocationPicker: props => { mockPicker = props; return null; } }));
jest.mock('./LiveSessionDashboard', () => ({ __esModule: true, default: () => null }));
jest.mock('./GpxUploadModal', () => ({ __esModule: true, default: () => null }));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const reply = name => ({ ok: true, json: async () => ({ address: { beach: name }, display_name: name }) });
const entry = { id: 'session-fixture', session_date: '2026-10-21', spot_name: 'Old Beach', latitude: 0, longitude: 0, source: 'manual' };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const mount = async (entries = []) => {
  mockApi.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/stats') ? { total_sessions: 0 } : { entries } }));
  const view = render(<SurfLog />);
  await flush();
  return view;
};
const openNew = async location => {
  await act(async () => { mockSetup.onManualEntry('', location); });
};
const selectLocation = loc => act(() => { void mockPicker.onLocationSelected(loc); });
const saveButton = () => screen.getAllByRole('button').filter(node => /^(Update Session|Log Session)$/.test(node.textContent.trim())).pop();
const save = async () => {
  const button = saveButton();
  await act(async () => { fireEvent.click(button); });
};
const spotInput = () => screen.getByPlaceholderText('Pipeline');
const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = 'surflog-fixture-owner';
  mockApi.post.mockResolvedValue({ data: {} });
  mockApi.patch.mockResolvedValue({ data: {} });
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each([
  ['2026-10-30T00:30:00Z', 2026, 9, 29, '2026-10-29'],
  ['2026-10-29T23:30:00Z', 2026, 9, 30, '2026-10-30'],
  ['2026-11-01T05:30:00Z', 2026, 10, 1, '2026-11-01'],
])('defaults new sessions to local calendar fields at %s regardless of the host timezone', async (instant, year, month, day, expected) => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(instant));
  jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(year);
  jest.spyOn(Date.prototype, 'getMonth').mockReturnValue(month);
  jest.spyOn(Date.prototype, 'getDate').mockReturnValue(day);
  await mount();
  await openNew();
  expect(screen.getByLabelText('Date *').value).toBe(expected);
});

it('preserves equator and prime-meridian coordinates when editing', async () => {
  await mount([entry]);
  fireEvent.click(screen.getByRole('button', { name: /^(Edit3|Edit session)$/ }));
  await save();
  expect(mockApi.patch.mock.calls[0][1]).toMatchObject({ latitude: 0, longitude: 0 });
});

it('preserves zero coordinates supplied by the session setup', async () => {
  await mount();
  await openNew({ name: 'Zero point', lat: 0, lng: 0 });
  await save();
  expect(mockApi.post.mock.calls[0][1]).toMatchObject({ latitude: 0, longitude: 0, spot_name: 'Zero point' });
});

it('sends absent coordinates as null accepted by the optional-number API fields', async () => {
  await mount(); await openNew();
  await save();
  expect(mockApi.post.mock.calls[0][1]).toMatchObject({ latitude: null, longitude: null });
});

it('starts a new session without values from a previously edited session', async () => {
  await mount([{ ...entry, mood: 'stoked', wave_height: '4ft', personal_rating: 5 }]);
  fireEvent.click(screen.getByRole('button', { name: /^(Edit3|Edit session)$/ }));
  act(() => { mockClose(false); });
  await openNew(); await save();
  expect(mockApi.post.mock.calls[0][1]).toMatchObject({ mood: '', wave_height: '', personal_rating: 0 });
});

it('saving before a lookup returns does not submit the old beach name', async () => {
  const request = deferred(); global.fetch.mockReturnValue(request.promise);
  await mount(); await openNew({ name: 'Old Beach', lat: 1, lng: 2 });
  selectLocation({ lat: 30, lng: 40 });
  await save();
  expect(mockApi.post.mock.calls[0][1]).toMatchObject({ latitude: 30, longitude: 40, spot_name: '' });
  await act(async () => { request.resolve(reply('Too late')); });
});

it('keeps the latest selected coordinates and name when responses arrive in reverse order', async () => {
  const first = deferred(); const second = deferred();
  global.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await mount(); await openNew({ name: 'Old Beach', lat: 1, lng: 2 });
  selectLocation({ lat: 10, lng: 20 });
  selectLocation({ lat: 30, lng: 40 });
  await act(async () => { second.resolve(reply('New Beach')); });
  await act(async () => { first.resolve(reply('Old Response')); });
  expect(spotInput().value).toBe('New Beach');
  await save();
  expect(mockApi.post.mock.calls[0][1]).toMatchObject({ latitude: 30, longitude: 40, spot_name: 'New Beach' });
});

it('does not keep the old beach name beside new coordinates after a lookup failure', async () => {
  const request = deferred(); global.fetch.mockReturnValue(request.promise);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await mount(); await openNew({ name: 'Old Beach', lat: 1, lng: 2 });
  selectLocation({ lat: 30, lng: 40 });
  await act(async () => { request.reject(new Error('fixture lookup failed')); });
  expect(spotInput().value).toBe('');
  console.warn.mockRestore();
});

it('keeps a manually entered spot name when an earlier lookup finishes', async () => {
  const request = deferred(); global.fetch.mockReturnValue(request.promise);
  await mount(); await openNew();
  selectLocation({ lat: 30, lng: 40 });
  fireEvent.change(spotInput(), { target: { value: 'My local name' } });
  await act(async () => { request.resolve(reply('Provider name')); });
  expect(spotInput().value).toBe('My local name');
});

it('ignores an earlier modal lookup after closing and opening a new session', async () => {
  const request = deferred(); global.fetch.mockReturnValue(request.promise);
  await mount(); await openNew();
  selectLocation({ lat: 30, lng: 40 });
  act(() => { mockClose(false); });
  await openNew({ name: 'Next Session', lat: 50, lng: 60 });
  await act(async () => { request.resolve(reply('Previous Session')); });
  expect(spotInput().value).toBe('Next Session');
  await save();
  expect(mockApi.post.mock.calls[0][1]).toMatchObject({ latitude: 50, longitude: 60, spot_name: 'Next Session' });
});

it('aborts the previous lookup when a new location is selected and on unmount', async () => {
  const first = deferred(); const second = deferred();
  global.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = await mount(); await openNew();
  selectLocation({ lat: 10, lng: 20 });
  const firstSignal = global.fetch.mock.calls[0][1]?.signal;
  selectLocation({ lat: 30, lng: 40 });
  expect(firstSignal?.aborted).toBe(true);
  const secondSignal = global.fetch.mock.calls[1][1]?.signal;
  view.unmount();
  expect(secondSignal?.aborted).toBe(true);
});

it('ignores a lookup belonging to the previous signed-in form context', async () => {
  const request = deferred(); global.fetch.mockReturnValue(request.promise);
  const view = await mount(); await openNew();
  selectLocation({ lat: 30, lng: 40 });
  mockUserId = 'surflog-next-fixture-owner';
  view.rerender(<SurfLog />);
  await flush();
  expect(screen.queryByRole('heading', { name: 'Log a Session' })).not.toBeInTheDocument();
  await openNew();
  await act(async () => { request.resolve(reply('Previous user lookup')); });
  expect(spotInput().value).toBe('');
  expect(global.fetch.mock.calls[0][1].signal.aborted).toBe(true);
});

it('handles missing geocoder address names without retaining an old name', async () => {
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ address: {} }) });
  await mount(); await openNew({ name: 'Old Beach', lat: 1, lng: 2 });
  selectLocation({ lat: 30, lng: 40 });
  await flush();
  expect(spotInput().value).toBe('');
});

it('an old successful save refreshes its account list without closing or changing a new form', async () => {
  const request = deferred(); mockApi.post.mockReturnValue(request.promise);
  await mount(); await openNew();
  await save();
  act(() => { mockClose(false); });
  await openNew({ name: 'New draft', lat: 30, lng: 40 });
  const readsBeforeCompletion = mockApi.get.mock.calls.length;
  await act(async () => { request.resolve({ data: {} }); });
  expect(screen.getByRole('heading', { name: 'Log a Session' })).toBeInTheDocument();
  expect(spotInput().value).toBe('New draft');
  expect(mockApi.get.mock.calls).toHaveLength(readsBeforeCompletion + 2);
  expect(toast.success).not.toHaveBeenCalled();
});

it('a newly opened form is not held by an old save and old failure cannot release a new save', async () => {
  const oldRequest = deferred(); const newRequest = deferred();
  mockApi.post.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
  await mount(); await openNew(); await save();
  act(() => { mockClose(false); });
  await openNew();
  expect(saveButton()).not.toBeDisabled();
  await save();
  expect(saveButton()).toBeDisabled();
  await act(async () => { oldRequest.reject(new Error('old save failed')); });
  expect(saveButton()).toBeDisabled();
  expect(toast.error).not.toHaveBeenCalled();
  await act(async () => { newRequest.resolve({ data: {} }); });
  expect(screen.queryByRole('heading', { name: 'Log a Session' })).not.toBeInTheDocument();
  expect(toast.success).toHaveBeenCalledTimes(1);
});

it('ignores save completion after the signed-in user changes without retrying the write', async () => {
  const request = deferred(); mockApi.post.mockReturnValue(request.promise);
  const view = await mount(); await openNew(); await save();
  mockUserId = 'surflog-next-fixture-owner';
  view.rerender(<SurfLog />);
  await flush();
  expect(screen.queryByRole('heading', { name: 'Log a Session' })).not.toBeInTheDocument();
  await openNew();
  const readsBeforeCompletion = mockApi.get.mock.calls.length;
  await act(async () => { request.resolve({ data: {} }); });
  expect(screen.getByRole('heading', { name: 'Log a Session' })).toBeInTheDocument();
  expect(saveButton()).not.toBeDisabled();
  expect(mockApi.get.mock.calls).toHaveLength(readsBeforeCompletion);
  expect(mockApi.post).toHaveBeenCalledTimes(1);
  expect(toast.success).not.toHaveBeenCalled();
});

it('reads back a completed same-account save after its modal was closed', async () => {
  const request = deferred(); mockApi.post.mockReturnValue(request.promise);
  await mount(); await openNew(); await save();
  act(() => { mockClose(false); });
  mockApi.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/stats')
    ? { total_sessions: 0 } : { entries: [{ ...entry, spot_name: 'Saved after close' }] } }));
  await act(async () => { request.resolve({ data: {} }); });
  expect(screen.getByText('Saved after close')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Log a Session' })).not.toBeInTheDocument();
  expect(toast.success).not.toHaveBeenCalled();
});

it('keeps a newer account list when the earlier account read finishes last', async () => {
  const oldEntries = deferred(); const oldStats = deferred();
  mockApi.get.mockImplementation(url => {
    if (url.includes('surflog-fixture-owner')) return url.endsWith('/stats') ? oldStats.promise : oldEntries.promise;
    return Promise.resolve({ data: url.endsWith('/stats')
      ? { total_sessions: 1, favourite_spot: 'Current favourite', favourite_spot_count: 1 }
      : { entries: [{ ...entry, spot_name: 'Current account session' }] } });
  });
  const view = render(<SurfLog />);
  mockUserId = 'surflog-next-fixture-owner';
  view.rerender(<SurfLog />);
  await flush();
  await act(async () => {
    oldEntries.resolve({ data: { entries: [{ ...entry, spot_name: 'Old account session' }] } });
    oldStats.resolve({ data: { total_sessions: 1, favourite_spot: 'Old favourite', favourite_spot_count: 1 } });
  });
  expect(screen.getByText('Current account session')).toBeInTheDocument();
  expect(screen.getByText('Current favourite')).toBeInTheDocument();
  expect(screen.queryByText('Old account session')).not.toBeInTheDocument();
  expect(screen.queryByText('Old favourite')).not.toBeInTheDocument();
});

it('does not retain previous-account sessions if the next account read fails', async () => {
  const view = await mount([{ ...entry, spot_name: 'Previous account session' }]);
  mockApi.get.mockRejectedValue(new Error('next account unavailable'));
  mockUserId = 'surflog-next-fixture-owner';
  view.rerender(<SurfLog />);
  await flush();
  expect(screen.queryByText('Previous account session')).not.toBeInTheDocument();
});

it('does not allow a pre-save read to overwrite the newer successful save refresh', async () => {
  const initialEntries = deferred(); const initialStats = deferred();
  mockApi.get.mockImplementation(url => url.endsWith('/stats') ? initialStats.promise : initialEntries.promise);
  render(<SurfLog />);
  await openNew();
  mockApi.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/stats')
    ? { total_sessions: 0 } : { entries: [{ ...entry, spot_name: 'Newly saved session' }] } }));
  await save();
  expect(screen.getByText('Newly saved session')).toBeInTheDocument();
  await act(async () => {
    initialEntries.resolve({ data: { entries: [] } });
    initialStats.resolve({ data: { total_sessions: 0 } });
  });
  expect(screen.getByText('Newly saved session')).toBeInTheDocument();
});

it('invalidates reads on logout and ignores their late responses', async () => {
  const pending = deferred();
  mockApi.get.mockReturnValue(pending.promise);
  const view = render(<SurfLog />);
  const signal = mockApi.get.mock.calls[0][1]?.signal;
  mockUserId = null;
  view.rerender(<SurfLog />);
  expect(signal?.aborted).toBe(true);
  await act(async () => { pending.resolve({ data: { entries: [{ ...entry, spot_name: 'Logged out session' }], total_sessions: 1 } }); });
  expect(screen.queryByText('Logged out session')).not.toBeInTheDocument();
  view.unmount();
});

it('does not trigger a readback after its page has unmounted', async () => {
  const request = deferred(); mockApi.post.mockReturnValue(request.promise);
  const view = await mount(); await openNew(); await save();
  const reads = mockApi.get.mock.calls.length;
  view.unmount();
  await act(async () => { request.resolve({ data: {} }); });
  expect(mockApi.get.mock.calls).toHaveLength(reads);
  expect(toast.success).not.toHaveBeenCalled();
});

it.each(['surflog-next-fixture-owner', null])('closes an existing-entry editor on account transition to %s', async nextId => {
  const view = await mount([{ ...entry, mood: 'stoked', board_model: 'Old owner board', notes: 'Old owner notes' }]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit session' }));
  expect(spotInput()).toHaveValue('Old Beach');
  mockApi.get.mockImplementation(url => Promise.resolve({ data: url.endsWith('/stats') ? { total_sessions: 0 } : { entries: [] } }));
  mockUserId = nextId;
  view.rerender(<SurfLog />);
  await flush();
  expect(screen.queryByRole('heading', { name: 'Edit Session' })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Old owner notes')).not.toBeInTheDocument();
  if (nextId) {
    await openNew(); await save();
    expect(mockApi.post.mock.calls[0][0]).toBe(`/surf-log/${nextId}`);
    expect(mockApi.post.mock.calls[0][1]).toMatchObject({
      spot_name: '', latitude: null, longitude: null, board_model: '', notes: '', mood: '',
    });
  }
});
