import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import GromManage from './GromManage';

let mockTheme = 'light';
const mockGet = jest.fn();
const mockWrite = jest.fn();
const mockCaught = jest.fn();
jest.mock('react-router-dom', () => ({
  useSearchParams: () => {
    const [params, setParams] = require('react').useState(() => new URLSearchParams('tab=spending'));
    return [params, next => setParams(next)];
  },
  useParams: () => ({ gromId: 'fictional-child' }), useNavigate: () => jest.fn(),
}), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fictional-parent' } }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: {
  get: (...args) => mockGet(...args), post: (...args) => mockWrite(...args),
} }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

// Test-only boundary characterizes existing rejected-data behavior, not a product recovery change.
class ExistingDataBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { mockCaught(error); }
  render() { return this.state.failed ? <p>Existing invalid-data boundary</p> : this.props.children; }
}

const activityPath = '/grom-hq/activity/fictional-child?parent_id=fictional-parent';
const spendingPath = '/grom-hq/spending-summary/fictional-child?parent_id=fictional-parent';
const amountCases = [[0.49, '$0.49'], [1.5, '$1.50'], [0, '$0.00'], [7, '$7.00'], [1234.56, '$1234.56']];

beforeEach(() => { mockGet.mockReset(); mockWrite.mockReset(); mockCaught.mockReset(); });

function showSummary(data) {
  if (data.spending_by_category && typeof data.spending_by_category === 'object') Object.freeze(data.spending_by_category);
  Object.freeze(data);
  mockGet.mockImplementation(path => {
    if (path === activityPath) return Promise.resolve({ data: {
      grom_name: 'Fictional Child', parental_controls: { can_post: true, spending_limit: 20, require_approval_above: 5 },
      activity: { total_posts: 0, posts_this_week: 0, sessions_joined: 0, credits_balance: 0 }, recent_transactions: [],
    } });
    if (path === spendingPath) return Promise.resolve({ data });
    return Promise.reject(new Error('Unexpected fictional GET'));
  });
  return render(<ExistingDataBoundary><GromManage /></ExistingDataBoundary>);
}

function expectReadOnly() {
  expect(mockGet.mock.calls).toEqual([[activityPath], [spendingPath]]);
  expect(mockWrite).not.toHaveBeenCalled();
  expect(mockCaught).not.toHaveBeenCalled();
  expect(screen.getByRole('spinbutton', { name: 'Monthly Spending Limit ($)', exact: true })).toHaveValue(20);
  expect(screen.getByRole('spinbutton', { name: 'Require Approval Above ($)', exact: true })).toHaveValue(5);
}

async function expectMonthly(text) {
  const label = await screen.findByText('Spent This Month');
  expect(within(label.parentElement).getByText(text, { exact: true })).toBeVisible();
}

async function expectCategory(text) {
  const label = await screen.findByText('photo purchase');
  expect(within(label.parentElement).getByText(text, { exact: true })).toBeVisible();
}

const invalidCases = [
  ['missing monthly value', () => ({ spending_by_category: {} })],
  ['null monthly value', () => ({ monthly_spending: null, spending_by_category: {} })],
  ['string monthly value', () => ({ monthly_spending: '1.50', spending_by_category: {} })],
  ['missing category collection', () => ({ monthly_spending: 1.5 })],
  ['null category value', () => ({ monthly_spending: 1.5, spending_by_category: { photo_purchase: null } })],
  ['string category value', () => ({ monthly_spending: 1.5, spending_by_category: { photo_purchase: '1.50' } })],
];

describe.each(['light', 'dark', 'beach'])('%s spending precision', theme => {
  beforeEach(() => { mockTheme = theme; });

  test.each(amountCases)('monthly amount %s preserves the existing two-decimal currency convention', async (amount, expected) => {
    const data = { monthly_spending: amount, spending_by_category: { photo_purchase: 9.75 }, spending_limit: null };
    showSummary(data);
    await expectMonthly(expected);
    expect(data.monthly_spending).toBe(amount);
    expectReadOnly();
  });

  test.each(amountCases)('category amount %s preserves the existing two-decimal currency convention', async (amount, expected) => {
    const data = { monthly_spending: 9.75, spending_by_category: { photo_purchase: amount }, spending_limit: null };
    showSummary(data);
    await expectCategory(expected);
    expect(data.spending_by_category.photo_purchase).toBe(amount);
    expectReadOnly();
  });

  test('percentage, progress width and limit text keep their existing calculations', async () => {
    const { container } = showSummary({ monthly_spending: 1.5, spending_by_category: {}, spending_limit: 2 });
    await screen.findByText('Spent This Month');
    expect(screen.getByText('Limit: $2', { exact: true })).toBeVisible();
    expect(screen.getByText('75%', { exact: true })).toBeVisible();
    expect(container.querySelector('[style]')).toHaveStyle({ width: '75%' });
    expectReadOnly();
  });

  test('zero limit retains the existing omitted limit and progress behavior', async () => {
    const { container } = showSummary({ monthly_spending: 1.5, spending_by_category: {}, spending_limit: 0 });
    await screen.findByText('Spent This Month');
    expect(screen.queryByText(/^Limit:/)).not.toBeInTheDocument();
    expect(container.querySelector('[style]')).toBeNull();
    expectReadOnly();
  });

  test('empty categories retain the existing empty-state message', async () => {
    showSummary({ monthly_spending: 1.5, spending_by_category: {}, spending_limit: null });
    expect(await screen.findByText('No spending yet')).toBeVisible();
    expectReadOnly();
  });

  test.each([[NaN, '$NaN'], [Infinity, '$Infinity']])('non-finite value %s is not silently replaced with zero', async (value, expected) => {
    showSummary({ monthly_spending: value, spending_by_category: { photo_purchase: value }, spending_limit: null });
    await expectMonthly(expected);
    await expectCategory(expected);
    expectReadOnly();
  });

  test.each(invalidCases)('%s retains existing rejection rather than inventing a zero', async (_name, data) => {
    showSummary(data());
    expect(await screen.findByText('Existing invalid-data boundary')).toBeVisible();
    expect(mockCaught).toHaveBeenCalled();
    expect(mockCaught.mock.calls[0][0]).toBeInstanceOf(TypeError);
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(mockGet.mock.calls).toEqual([[activityPath], [spendingPath]]);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
