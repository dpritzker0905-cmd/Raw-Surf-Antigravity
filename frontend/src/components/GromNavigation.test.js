import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import GromHQ from './GromHQ';
import GromManage from './GromManage';

jest.mock('react-router-dom', () => {
  global.TextEncoder = global.TextEncoder || require('util').TextEncoder;
  global.TextDecoder = global.TextDecoder || require('util').TextDecoder;
  return jest.requireActual('react-router');
}, { virtual: true });
let mockTheme = 'light';
const mockPost = jest.fn();
const mockInfo = jest.fn();
let mockChildren;
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fictional-parent' } }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: {
  get: async path => ({ data: path.includes('/linked-groms/') ? {
    linked_groms: mockChildren, pending_requests: [], stats: {},
  } : path.includes('/activity/') ? {
    grom_name: path.includes('child-b') ? 'Fictional Child B' : 'Fictional Child A',
    parental_controls: { can_post: true, spending_limit: 30, require_approval_above: 5 },
    activity: { total_posts: 0, posts_this_week: 0, sessions_joined: 0, credits_balance: 0 },
    recent_transactions: [],
  } : path.includes('/spending-summary/') ? {
    monthly_spending: 0, spending_by_category: {},
  } : { age_verified: true, alerts: [], activities: [] } }),
  post: (...args) => mockPost(...args),
} }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../utils/media', () => ({ getFullUrl: () => null }));
jest.mock('sonner', () => ({ toast: { info: (...args) => mockInfo(...args), success: jest.fn(), error: jest.fn() } }));
jest.mock('./grom/PurchaseRequestsPanel', () => ({ PurchaseRequestsPanel: () => null }));
jest.mock('./grom/LinkMyChildPanel', () => () => <div>Fictional child-link panel</div>);

const child = suffix => ({ id: `child-${suffix}`, full_name: `Fictional Child ${suffix.toUpperCase()}`,
  credits_balance: 0, guardian_level: 'L1', unlocked: {} });
const Location = () => {
  const location = useLocation();
  return <output data-testid="current-location">{location.pathname}{location.search}{location.hash}</output>;
};
const mount = (initial = '/grom-hq') => render(
  <MemoryRouter initialEntries={[initial]}>
    <Routes>
      <Route path="/grom-hq" element={<GromHQ />} />
      <Route path="/grom-hq/manage/:gromId" element={<GromManage />} />
    </Routes>
    <Location />
  </MemoryRouter>
);
beforeEach(() => {
  mockTheme = 'light'; mockChildren = [child('a'), child('b')];
  mockPost.mockReset(); mockInfo.mockReset();
});

test('each child has a named native focusable management action, preserving child identity', async () => {
  mount();
  await screen.findByText('Fictional Child A');
  const manage = screen.getByRole('button', { name: 'Manage Fictional Child B', exact: true });
  expect(manage).toHaveAttribute('type', 'button');
  manage.focus();
  expect(manage).toHaveFocus();
  fireEvent.click(manage);
  await screen.findByRole('heading', { name: 'Fictional Child B', exact: true });
  expect(screen.getByTestId('current-location')).toHaveTextContent('/grom-hq/manage/child-b');
  expect(screen.getByText('Recent Activity')).toBeVisible();
  expect(mockPost).not.toHaveBeenCalled();
});

test.each(['light', 'dark', 'beach'])('Spending Controls opens the first linked child spending view in %s', async theme => {
  mockTheme = theme; mount();
  await screen.findByText('Fictional Child A');
  fireEvent.click(screen.getByRole('button', { name: /^Spending Controls/ }));
  await screen.findByRole('heading', { name: 'Fictional Child A', exact: true });
  expect(screen.getByTestId('current-location')).toHaveTextContent('/grom-hq/manage/child-a?tab=spending');
  expect(screen.getByRole('spinbutton', { name: 'Monthly Spending Limit ($)', exact: true })).toHaveValue(30);
  expect(screen.getByRole('button', { name: 'Save Spending Limits', exact: true })).toBeVisible();
  expect(mockPost).not.toHaveBeenCalled();
});

test('a direct spending URL opens its form and tab changes preserve unrelated query parameters and unsaved limits', async () => {
  mount('/grom-hq/manage/child-a?tab=spending&origin=family');
  await screen.findByRole('heading', { name: 'Fictional Child A', exact: true });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Monthly Spending Limit ($)', exact: true }), { target: { value: '25' } });
  fireEvent.click(screen.getByRole('button', { name: 'Controls', exact: true }));
  expect(screen.getByRole('switch', { name: /Can Post:/ })).toBeVisible();
  expect(screen.getByTestId('current-location')).toHaveTextContent('tab=controls&origin=family');
  fireEvent.click(screen.getByRole('button', { name: 'Spending', exact: true }));
  expect(screen.getByRole('spinbutton', { name: 'Monthly Spending Limit ($)', exact: true })).toHaveValue(25);
  expect(mockPost).not.toHaveBeenCalled();
});

test.each(['', '?tab=unknown'])('ordinary and unsupported management entries keep Activity as the default (%s)', async query => {
  mount(`/grom-hq/manage/child-a${query}`);
  await screen.findByRole('heading', { name: 'Fictional Child A', exact: true });
  expect(screen.getByText('Recent Activity')).toBeVisible();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(mockPost).not.toHaveBeenCalled();
});

test('the spending shortcut without linked children retains guidance and does not navigate or write', async () => {
  mockChildren = []; mount();
  await screen.findByText('Fictional child-link panel');
  fireEvent.click(screen.getByRole('button', { name: /^Spending Controls/ }));
  expect(mockInfo).toHaveBeenCalledWith('Link a Grom first to manage spending controls.');
  expect(screen.getByTestId('current-location')).toHaveTextContent(/^\/grom-hq$/);
  expect(mockPost).not.toHaveBeenCalled();
});
