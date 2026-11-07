import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import XPLeaderboard from './XPLeaderboard';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

// Keep actual React hooks; the forwarding mock lets the unmount test observe dispatches
// even when Babel has copied named imports before a spy is installed.
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return { ...actual, useState: jest.fn(actual.useState) };
});

const mockNavigate = jest.fn();
let mockTheme = 'dark';
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }) }));
// CRA/Jest 27 cannot resolve the router v7 exports; match the repository's navigation mock convention.
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }), { virtual: true });

const fallbackNames = ['Kelly Waters', 'Sarah Waves', 'Mike Shooter', 'Lisa Surf', 'Tom Tube'];
const oldRows = [{ id: 'old', name: 'Superseded Surfer', xp: 99, rank: 9 }];
const latestRows = [
  { id: 'latest-a', name: 'Current Alpha', xp: 12, rank: 4, badge: 'the_patron', badge_tier: 'gold' },
  { id: 'latest-b', name: 'Current Bravo', xp: 7600, rank: 8 },
  { id: 'latest-c', name: 'Current Charlie', xp: 41, rank: 6 },
  { id: 'latest-d', name: 'Current Delta', xp: 83, rank: 5 },
];
let requests;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle(request, outcome, rows = latestRows) {
  await act(async () => {
    if (outcome === 'success') request.resolve({ data: { leaderboard: rows } });
    else request.reject(new Error('controlled leaderboard failure'));
    await request.promise.catch(() => {});
  });
}

function expectLoading(count) {
  expect(screen.getAllByText('Loading...')).toHaveLength(count);
  expect(screen.queryByText('Superseded Surfer')).not.toBeInTheDocument();
  expect(screen.queryByText('Kelly Waters')).not.toBeInTheDocument();
}

function expectLatest(outcome, compact = false) {
  expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  expect(screen.queryByText('Superseded Surfer')).not.toBeInTheDocument();
  const names = outcome === 'success' ? latestRows.map(row => row.name) : fallbackNames;
  names.slice(0, compact ? 3 : names.length).forEach(name => expect(screen.getByText(name)).toBeInTheDocument());
  if (compact) names.slice(3).forEach(name => expect(screen.queryByText(name)).not.toBeInTheDocument());
  if (outcome === 'success') expect(screen.queryByText('Kelly Waters')).not.toBeInTheDocument();
  else expect(screen.queryByText('Current Alpha')).not.toBeInTheDocument();
}

beforeEach(() => {
  // CRA resets mock implementations before each test; restore the actual hook forwarder.
  React.useState.mockImplementation(jest.requireActual('react').useState);
  requests = [];
  mockTheme = 'dark';
  jest.clearAllMocks();
  apiClient.get.mockImplementation(() => {
    const request = deferred();
    requests.push(request);
    return request.promise;
  });
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  React.useState.mockImplementation(jest.requireActual('react').useState);
});

const transitions = [
  { name: 'week', button: 'This Week', params: { time_range: 'week', category: 'all', limit: 10 } },
  { name: 'month', button: 'This Month', params: { time_range: 'month', category: 'all', limit: 10 } },
  { name: 'patrons', button: 'Patrons', params: { time_range: 'all', category: 'patrons', limit: 10 } },
  { name: 'workhorses', button: 'Workhorses', params: { time_range: 'all', category: 'workhorses', limit: 10 } },
  { name: 'full limit', limit: 2, params: { time_range: 'all', category: 'all', limit: 2 } },
  { name: 'compact limit', limit: 2, compact: true, params: { time_range: 'all', category: 'all', limit: 2 } },
];

describe.each(transitions)('$name transition', transition => {
  test.each([
    ['success', 'before', 'success'], ['failure', 'before', 'success'],
    ['success', 'after', 'success'], ['failure', 'after', 'success'],
    ['success', 'before', 'failure'], ['failure', 'before', 'failure'],
    ['success', 'after', 'failure'], ['failure', 'after', 'failure'],
  ])('old %s settles %s current %s', async (oldOutcome, order, currentOutcome) => {
    const view = render(<XPLeaderboard compact={transition.compact} />);
    expect(apiClient.get).toHaveBeenNthCalledWith(1, '/gamification/leaderboard', {
      params: { time_range: 'all', category: 'all', limit: 10 },
    });
    if (transition.button) fireEvent.click(screen.getByRole('button', { name: transition.button }));
    else view.rerender(<XPLeaderboard compact={transition.compact} limit={transition.limit} />);
    expect(requests).toHaveLength(2);
    expect(apiClient.get).toHaveBeenNthCalledWith(2, '/gamification/leaderboard', { params: transition.params });

    if (order === 'before') {
      await settle(requests[0], oldOutcome, oldRows);
      // A stale finally must not remove the current request's placeholders.
      expectLoading(transition.compact ? 3 : transition.params.limit);
      expect(logger.error).not.toHaveBeenCalled();
    }
    await settle(requests[1], currentOutcome);
    expectLatest(currentOutcome, transition.compact);
    if (order === 'after') {
      await settle(requests[0], oldOutcome, oldRows);
      expectLatest(currentOutcome, transition.compact);
    }
    expect(logger.error).toHaveBeenCalledTimes(currentOutcome === 'failure' ? 1 : 0);
  });
});

test('rapid time/category/limit changes and return to all preserve the exact latest query', async () => {
  const view = render(<XPLeaderboard />);
  fireEvent.click(screen.getByRole('button', { name: 'This Week' }));
  fireEvent.click(screen.getByRole('button', { name: 'Patrons' }));
  view.rerender(<XPLeaderboard limit={7} />);
  fireEvent.click(screen.getByRole('button', { name: 'This Month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Workhorses' }));
  fireEvent.click(screen.getByRole('button', { name: 'All Time' }));
  fireEvent.click(screen.getByRole('button', { name: 'All', exact: true }));
  expect(apiClient.get.mock.calls.map(([, options]) => options.params)).toEqual([
    { time_range: 'all', category: 'all', limit: 10 },
    { time_range: 'week', category: 'all', limit: 10 },
    { time_range: 'week', category: 'patrons', limit: 10 },
    { time_range: 'week', category: 'patrons', limit: 7 },
    { time_range: 'month', category: 'patrons', limit: 7 },
    { time_range: 'month', category: 'workhorses', limit: 7 },
    { time_range: 'all', category: 'workhorses', limit: 7 },
    { time_range: 'all', category: 'all', limit: 7 },
  ]);
  await settle(requests[4], 'failure');
  await settle(requests[0], 'success', oldRows);
  expectLoading(7);
  await settle(requests[7], 'success');
  for (const index of [6, 1, 5, 2, 3]) await settle(requests[index], index % 2 ? 'failure' : 'success', oldRows);
  expectLatest('success');
});

describe.each([false, true])('compact=%s', compact => {
  test.each(['success', 'failure'])('unmount forbids all pending %s state writes', async outcome => {
    // React 19 silently discards updates after unmount, so empty DOM alone cannot prove
    // request cleanup. Observe dispatches while retaining React's real state/effect runtime.
    const useState = jest.requireActual('react').useState;
    const writes = jest.fn();
    React.useState.mockImplementation(initial => {
      const [value, setValue] = useState(initial);
      return [value, next => { writes(next); setValue(next); }];
    });
    const view = render(<XPLeaderboard compact={compact} />);
    expectLoading(compact ? 3 : 10);
    view.unmount();
    writes.mockClear();
    await settle(requests[0], outcome);
    expect(writes).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(view.container).toBeEmptyDOMElement();
  });

  test.each([
    ['success', 'before'], ['failure', 'before'], ['success', 'after'], ['failure', 'after'],
  ])('StrictMode replay ignores first %s completing %s active effect', async (outcome, order) => {
    render(<StrictMode><XPLeaderboard compact={compact} /></StrictMode>);
    expect(requests).toHaveLength(2);
    if (order === 'before') {
      await settle(requests[0], outcome, oldRows);
      expectLoading(compact ? 3 : 10);
    }
    await settle(requests[1], 'success');
    if (order === 'after') await settle(requests[0], outcome, oldRows);
    expectLatest('success', compact);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test.each(['light', 'dark', 'beach'])('current success preserves %s rendering, server order and navigation', async theme => {
    mockTheme = theme;
    render(<XPLeaderboard compact={compact} />);
    await settle(requests[0], 'success');
    expectLatest('success', compact);
    const alpha = screen.getByText('Current Alpha');
    const bravo = screen.getByText('Current Bravo');
    expect(alpha.compareDocumentPosition(bravo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alpha).toHaveClass(theme === 'light' ? 'text-gray-900' : 'text-white');
    if (compact) {
      expect(screen.getByText('12 XP')).toBeInTheDocument();
      expect(screen.getByText('7600 XP')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(mockNavigate).toHaveBeenCalledWith('/leaderboard');
    } else {
      expect(screen.getByText('#4')).toBeInTheDocument();
      expect(screen.getByText('#8')).toBeInTheDocument();
      expect(screen.getByText('Patron (gold)')).toBeInTheDocument();
      expect(screen.getByText((7600).toLocaleString())).toBeInTheDocument();
      fireEvent.click(alpha);
      expect(mockNavigate).toHaveBeenCalledWith('/profile/latest-a');
    }
  });

  test('current failure still renders the existing fallback', async () => {
    render(<XPLeaderboard compact={compact} />);
    await settle(requests[0], 'failure');
    expectLatest('failure', compact);
    expect(logger.error).toHaveBeenCalledWith('Failed to fetch leaderboard:', expect.any(Error));
  });

  test.each([[], undefined])('current empty or absent leaderboard clears loading', async rows => {
    render(<XPLeaderboard compact={compact} />);
    await act(async () => { requests[0].resolve({ data: { leaderboard: rows } }); });
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.queryByText('Kelly Waters')).not.toBeInTheDocument();
    if (!compact) expect(screen.getByText('No rankings yet. Be the first to earn XP!')).toBeInTheDocument();
    else expect(screen.getByText('Top Earners')).toBeInTheDocument();
  });
});
