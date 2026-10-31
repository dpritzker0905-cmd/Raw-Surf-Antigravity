import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GromManage from './GromManage';
import { toast } from 'sonner';

let mockGromId = 'child-a';
let mockParentId = 'parent-a';
let mockTheme = 'light';
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('react-router-dom', () => ({
  useParams: () => ({ gromId: mockGromId }), useNavigate: () => jest.fn(),
}), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: mockParentId } }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: {
  get: (...args) => mockGet(...args), post: (...args) => mockPost(...args),
} }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const activity = (name = 'Child A', controls = { can_post: true, spending_limit: 0, require_approval_above: 0 }) => ({
  data: { grom_name: name, parental_controls: controls, recent_transactions: [],
    activity: { total_posts: 0, posts_this_week: 0, sessions_joined: 0, credits_balance: 0 } },
});
const spending = { data: { monthly_spending: 0, spending_by_category: {} } };
const ready = () => screen.findByRole('heading', { name: 'Child A' });

beforeEach(() => {
  mockGromId = 'child-a'; mockParentId = 'parent-a'; mockTheme = 'light';
  mockGet.mockReset().mockImplementation(url => Promise.resolve(url.includes('/activity/') ? activity() : spending));
  mockPost.mockReset().mockResolvedValue({ data: { parental_controls: { can_post: false }, ignored_keys: [] } });
  jest.clearAllMocks();
});

test.each(['activity', 'spending-summary'])('%s load failure never exposes default settings or save actions', async endpoint => {
  mockGet.mockImplementation(url => url.includes(`/${endpoint}/`) ? Promise.reject(new Error('offline')) : Promise.resolve(
    url.includes('/activity/') ? activity() : spending));
  render(<GromManage />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not.*load|could not be loaded/i);
  expect(screen.queryByText('Save Controls')).not.toBeInTheDocument();
  expect(screen.queryByText('Save Spending Limits')).not.toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(mockPost).not.toHaveBeenCalled();
});

test('retry loads both responses before exposing saved settings, including zero limits', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline'));
  render(<GromManage />);
  fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
  await ready();
  fireEvent.click(screen.getByRole('button', { name: /controls/i }));
  expect(screen.getByRole('switch', { name: /Can Post:/ })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: /spending/i }));
  expect(screen.getAllByRole('spinbutton').map(input => input.value)).toEqual(['0', '0']);
  expect(mockGet).toHaveBeenCalledTimes(4);
  expect(mockPost).not.toHaveBeenCalled();
});

test.each(['light', 'dark', 'beach'])('%s load error supports repeated retry without writes', async theme => {
  mockTheme = theme; mockGet.mockRejectedValue(new Error('offline'));
  render(<GromManage />);
  fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
  await screen.findByRole('alert');
  expect(mockGet).toHaveBeenCalledTimes(4);
  expect(mockPost).not.toHaveBeenCalled();
});

test.each(['child', 'parent'])('%s change hides previous settings while loading and ignores the previous response', async identity => {
  const oldActivity = deferred(); const newActivity = deferred();
  mockGet.mockImplementation(url => {
    if (!url.includes('/activity/')) return Promise.resolve(spending);
    return url.includes('child-a?parent_id=parent-a') ? oldActivity.promise : newActivity.promise;
  });
  const view = render(<GromManage />);
  if (identity === 'child') mockGromId = 'child-b'; else mockParentId = 'parent-b';
  view.rerender(<GromManage />);
  await act(async () => { newActivity.resolve(activity('Child B', { can_post: false })); });
  await screen.findByRole('heading', { name: 'Child B' });
  await act(async () => { oldActivity.resolve(activity('Child A', { can_post: true })); });
  expect(screen.queryByRole('heading', { name: 'Child A' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /controls/i }));
  expect(screen.getByRole('switch', { name: /Can Post:/ })).not.toBeChecked();
  fireEvent.click(screen.getByText('Save Controls'));
  await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
  expect(mockPost.mock.calls[0][0]).toBe(`/grom-hq/update-parental-controls/${mockGromId}?parent_id=${mockParentId}`);
  expect(mockPost.mock.calls[0][1].can_post).toBe(false);
});

test('a failed new child load cannot expose or save the previous child settings', async () => {
  const view = render(<GromManage />); await ready();
  fireEvent.click(screen.getByRole('button', { name: /controls/i }));
  expect(screen.getByRole('switch', { name: /Can Post:/ })).toBeChecked();
  mockGromId = 'child-b'; mockGet.mockRejectedValue(new Error('offline'));
  view.rerender(<GromManage />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.queryByText('Save Controls')).not.toBeInTheDocument();
  expect(mockPost).not.toHaveBeenCalled();
});

test('saved controls retain server readback rather than the submitted toggle draft', async () => {
  render(<GromManage />); await ready();
  fireEvent.click(screen.getByRole('button', { name: /controls/i }));
  fireEvent.click(screen.getByText('Save Controls'));
  await waitFor(() => expect(screen.getByRole('switch', { name: /Can Post:/ })).not.toBeChecked());
  expect(mockPost).toHaveBeenCalledTimes(1);
});

test('retry waits for the spending response before exposing any editable settings', async () => {
  mockGet.mockRejectedValueOnce(new Error('offline'));
  render(<GromManage />);
  const retry = await screen.findByRole('button', { name: /retry/i });
  const waiting = deferred();
  mockGet.mockImplementation(url => url.includes('/activity/') ? Promise.resolve(activity()) : waiting.promise);
  fireEvent.click(retry);
  await screen.findByRole('status');
  expect(screen.queryByRole('heading', { name: 'Child A' })).not.toBeInTheDocument();
  expect(screen.queryByText('Save Controls')).not.toBeInTheDocument();
  await act(async () => { waiting.resolve(spending); });
  await ready();
});

test('leaving a loaded child removes its editable state until the next child is loaded', async () => {
  const view = render(<GromManage />); await ready();
  fireEvent.click(screen.getByRole('button', { name: /controls/i }));
  const waiting = deferred();
  mockGet.mockImplementation(url => url.includes('/activity/') ? waiting.promise : Promise.resolve(spending));
  mockGromId = 'child-b'; view.rerender(<GromManage />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading Grom settings');
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  await act(async () => { waiting.resolve(activity('Child B')); });
  await screen.findByRole('heading', { name: 'Child B' });
  expect(mockPost).not.toHaveBeenCalled();
});

test('a late failed request after leaving the view does not announce a stale error', async () => {
  const waiting = deferred(); mockGet.mockImplementation(() => waiting.promise);
  const view = render(<GromManage />); view.unmount();
  await act(async () => { waiting.reject(new Error('late offline')); });
  expect(toast.error).not.toHaveBeenCalled();
  expect(mockPost).not.toHaveBeenCalled();
});

test('save still warns when the server ignores a requested control', async () => {
  mockPost.mockResolvedValue({ data: { parental_controls: { can_post: true }, ignored_keys: ['can_post'] } });
  render(<GromManage />); await ready();
  fireEvent.click(screen.getByRole('button', { name: /controls/i }));
  fireEvent.click(screen.getByText('Save Controls'));
  await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('These controls were not saved: can_post'));
  expect(screen.getByRole('switch', { name: /Can Post:/ })).toBeChecked();
});
