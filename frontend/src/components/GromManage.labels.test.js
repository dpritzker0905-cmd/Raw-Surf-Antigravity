import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GromManage from './GromManage';

const mockPost = jest.fn();
jest.mock('react-router-dom', () => ({
  useParams: () => ({ gromId: 'fictional-child' }), useNavigate: () => jest.fn(),
}), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fictional-parent' } }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: {
  get: async path => ({ data: path.includes('/activity/') ? {
    grom_name: 'Fictional Child', parental_controls: { can_post: true, spending_limit: 0, require_approval_above: 0 },
    activity: { total_posts: 0, posts_this_week: 0, sessions_joined: 0, credits_balance: 0 }, recent_transactions: [],
  } : { monthly_spending: 0, spending_by_category: {} } }),
  post: (...args) => mockPost(...args),
} }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

beforeEach(() => { mockPost.mockReset().mockResolvedValue({ data: { parental_controls: { can_post: true } } }); });

test.each([
  ['Controls', 'Save Controls', '/grom-hq/update-parental-controls/fictional-child?parent_id=fictional-parent',
    { can_post: true, spending_limit: 0, require_approval_above: 0 }],
  ['Spending', 'Save Spending Limits', '/grom-hq/spending-controls/fictional-child?parent_id=fictional-parent',
    { monthly_limit: 0, require_approval_above: 0 }],
])('%s save has its visible action name while idle and saving, with the same payload', async (tab, name, path, payload) => {
  let finish;
  mockPost.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<GromManage />);
  await screen.findByRole('heading', { name: 'Fictional Child' });
  fireEvent.click(screen.getByRole('button', { name: tab, exact: true }));
  const save = screen.getByRole('button', { name, exact: true });
  expect(save).toHaveAttribute('type', 'button');
  fireEvent.click(save);
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith(path, payload));
  expect(screen.getByRole('button', { name, exact: true })).toBeDisabled();
  await act(async () => { finish({ data: { parental_controls: { can_post: true } } }); });
  expect(screen.getByRole('button', { name, exact: true })).toBeEnabled();
});

test('each spending label names and identifies its own editable numeric field', async () => {
  render(<GromManage />);
  await screen.findByRole('heading', { name: 'Fictional Child' });
  fireEvent.click(screen.getByRole('button', { name: 'Spending', exact: true }));
  for (const name of ['Monthly Spending Limit ($)', 'Require Approval Above ($)']) {
    const input = screen.getByRole('spinbutton', { name, exact: true });
    expect(screen.getByLabelText(name, { exact: true })).toBe(input);
    expect(input).toHaveValue(0);
    fireEvent.change(input, { target: { value: '25' } });
    expect(input).toHaveValue(25);
  }
  expect(mockPost).not.toHaveBeenCalled();
});

test('multiple management views keep spending label associations unique', async () => {
  render(<><GromManage /><GromManage /></>);
  await screen.findAllByRole('heading', { name: 'Fictional Child' });
  for (const tab of screen.getAllByRole('button', { name: 'Spending', exact: true })) fireEvent.click(tab);
  const limits = screen.getAllByLabelText('Monthly Spending Limit ($)', { exact: true });
  const thresholds = screen.getAllByLabelText('Require Approval Above ($)', { exact: true });
  expect(limits).toHaveLength(2);
  expect(thresholds).toHaveLength(2);
  expect(new Set([...limits, ...thresholds].map(input => input.id)).size).toBe(4);
  for (const input of [...limits, ...thresholds]) expect(document.querySelector(`label[for="${input.id}"]`).control).toBe(input);
});
