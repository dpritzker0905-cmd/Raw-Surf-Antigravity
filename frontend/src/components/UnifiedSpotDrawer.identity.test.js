import React from 'react';
import { act, render, screen } from '@testing-library/react';
import UnifiedSpotDrawer from './UnifiedSpotDrawer';
import apiClient from '../lib/apiClient';
let mockTheme = 'dark';
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../utils/leafletLoader', () => ({}));
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('./spot-drawer/SpotReportContent', () => ({ __esModule: true, default: () => null }));
jest.mock('./spot-drawer/SpotSetupPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('./spot-drawer/PhotographerProfileContent', () => ({ PhotographerProfileContent: () => null }));
jest.mock('./JumpInSessionModal', () => ({ JumpInSessionModal: () => null }));
jest.mock('./LockerSelfieModal', () => ({ LockerSelfieModal: () => null }));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const current = height => ({ data: { current: { wave_height_ft: height } } });
const tree = (id, open = true) => <UnifiedSpotDrawer spot={{ id, name: id }} isOpen={open} onClose={() => {}} />;
beforeEach(() => {
  jest.clearAllMocks(); mockTheme = 'dark'; localStorage.clear(); process.env.REACT_APP_FORECAST_STATE_IDENTITY = 'true';
  apiClient.get.mockResolvedValue({ data: {} });
});
afterEach(() => { delete process.env.REACT_APP_FORECAST_STATE_IDENTITY; });
test.each(['light', 'dark', 'beach'])('real %s drawer resets the old badge, retains zero and rejects late previous spot', async theme => {
  mockTheme = theme;
  const old = deferred();
  apiClient.get.mockImplementation(url => url === '/conditions/old?model=GFS' ? old.promise
    : Promise.resolve(url === '/conditions/new?model=GFS' ? current(0) : { data: {} }));
  const { rerender } = render(tree('old'));
  rerender(tree('new'));
  expect(await screen.findByTestId('live-wave-badge')).toHaveTextContent('0ft');
  await act(async () => old.resolve(current(9)));
  expect(screen.getByTestId('live-wave-badge')).toHaveTextContent('0ft');
});
test('a cached old badge is hidden as soon as a new spot opens', async () => {
  const pending = deferred();
  apiClient.get.mockImplementation(url => url === '/conditions/old?model=GFS' ? Promise.resolve(current(6)) : pending.promise);
  const { rerender } = render(tree('old'));
  expect(await screen.findByTestId('live-wave-badge')).toHaveTextContent('6ft');
  rerender(tree('new')); expect(screen.queryByTestId('live-wave-badge')).toBeNull();
  await act(async () => pending.resolve(current(null)));
  expect(screen.queryByTestId('live-wave-badge')).toBeNull();
});
test('model switch refreshes only the current reading, not ten future days', async () => {
  apiClient.get.mockImplementation(url => Promise.resolve(url.includes('model=ICON') ? current(5) : current(2)));
  render(tree('spot'));
  expect(await screen.findByTestId('live-wave-badge')).toHaveTextContent('2ft');
  act(() => { localStorage.setItem('rawsurf-active-model', 'ICON'); window.dispatchEvent(new Event('rawsurf-model-changed')); });
  expect(await screen.findByText('5ft')).toBeInTheDocument();
  expect(apiClient.get.mock.calls.some(([url]) => url.includes('/conditions/forecast/'))).toBe(false);
});
