/**
 * ChallengesTab asked for /api/api/challenges/* (audit 2026-10-18, F-06): its paths began with '/api' on an axios base
 * URL that already ends in /api, so the Career hub's challenges tab could never load. Real apiClient, stub transport.
 */
import { render, screen, waitFor } from '@testing-library/react';
import apiClient from '../../lib/apiClient';
import ChallengesTab from './ChallengesTab';

let requested;
beforeEach(() => {
  requested = [];
  apiClient.defaults.adapter = (config) => {
    requested.push(`${config.baseURL}${config.url}`);
    const data = config.url.endsWith('/history') ? { history: [] } : { challenge: null, leaderboard: [], time_remaining_seconds: 0 };
    return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config });
  };
});

it('loads /api/challenges/current and /api/challenges/history (no doubled /api prefix)', async () => {
  render(<ChallengesTab userId="u1" />);
  await waitFor(() => expect(requested).toHaveLength(2));
  expect(requested.some((u) => /\/api\/challenges\/current$/.test(u))).toBe(true);
  expect(requested.some((u) => /\/api\/challenges\/history$/.test(u))).toBe(true);
  expect(requested.every((u) => !/\/api\/api\//.test(u))).toBe(true);
  expect(screen.queryByText('Unable to load challenges')).toBeNull();
});
