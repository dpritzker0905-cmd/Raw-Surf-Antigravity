import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import apiClient from '../../lib/apiClient';
import VerificationPanel, { queueText } from './VerificationPanel';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));

const rows = Array.from({ length: 15 }, (_, i) => ({
  date: `2026-11-${String(i + 1).padStart(2, '0')} 00:00Z`, commit: 'abc', id: `S${i}`, metric: `metric ${i}`, value: `v${i}`, source: 's',
}));
const DATA = {
  snapshot: { status: 'ok', age_h: 2 }, generated_at: '2026-11-23T18:00:00Z', commit: 'abc123', run_url: 'https://github.com/x/actions/runs/1',
  workflow: 'admin-ops-snapshot.yml',
  verification: {
    skill_pending: { entries: 61093, cap: 68000, fill_pct: 89.8, headroom: 6907, beyond_48h: 21000 },
    served_wave: { holdout: 'NOT_READ', reason: 'not frozen', holdout_error: false, sampler: { objects: 40, newest: '2026-11-23T10:00:00Z' },
      truth_snapshots: { objects: 300 }, scores: { objects: 0 } },
    gust_verify: { cycles: { objects: 21 }, obs: { error: 'list: HTTP 500' } },
    workflows: [{ workflow: 'tide-g3-gate.yml', label: 'tide gate G3', runs: [
      { conclusion: 'success', createdAt: '2026-11-17T00:00:00Z', url: 'https://github.com/x/actions/runs/2' }, { conclusion: 'failure' }] },
    { workflow: 'served-wave-verify-score.yml', label: 'served-wave scorer', runs: [] }],
    memory_audit: { fail: 0, warn: 390, overdue_total: 77, open_total: 18,
      overdue: [{ where: 'ledger.d/x:1', due: '2026-11-08T00:00:00Z', target: 'D-059 read', check: 'one live read' }] },
    scoreboard: { total: 289, rows },
  },
  coverage: { guarded: 33, by_class: { blind: ['SURF_FACE_RANGE', 'SURF_TIDE_CMEMS'], replay: ['SURF_TIDE_DEPTH'] },
    blind_effectively_on: ['SURF_FACE_RANGE'] },
  alerts: [],
};

beforeEach(() => {
  apiClient.get.mockReset();
  apiClient.get.mockResolvedValue({ data: DATA });
});

test('queue text says headroom before eviction', () => {
  expect(queueText(DATA.verification.skill_pending)).toBe('61093 of 68000 rows (89.8% full, 6907 rows of headroom before eviction)');
  expect(queueText({ error: 'HTTP 500' })).toMatch(/Could not read/);
  expect(queueText(undefined)).toBe('Not reported');
});

test('shows every section in words, read-only', async () => {
  render(<VerificationPanel />);
  expect(await screen.findByRole('progressbar', { name: 'Skill ledger pending queue fill' })).toHaveAttribute('aria-valuenow', '89.8');
  expect(screen.getByText(/Collect-only: the scorer reads nothing/)).toBeInTheDocument();
  expect(screen.getByText(/Sampler archive.*40 objects/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(/Buoy observations: could not read/);
  expect(screen.getByRole('link', { name: /tide gate G3: success/ })).toHaveAttribute('href', 'https://github.com/x/actions/runs/2');
  expect(screen.getByText('never run')).toBeInTheDocument();
  expect(screen.getByText(/33 guarded flags: 2 BLIND, 1 replay/)).toBeInTheDocument();
  expect(screen.getByText(/ON now and BLIND/)).toHaveTextContent('SURF_FACE_RANGE');
  expect(screen.getByText(/77 overdue read-backs, 18 open/)).toBeInTheDocument();
  expect(screen.getByText(/No drift alerts are produced yet/)).toBeInTheDocument();
  expect(screen.getAllByText(/^metric /)).toHaveLength(12);
  const more = screen.getByRole('button', { name: /Show all 15 rows/ });
  expect(more).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(more);
  expect(screen.getAllByText(/^metric /)).toHaveLength(15);
  expect(screen.getAllByText(/^metric /)[0]).toHaveTextContent('metric 14');      // newest first
});

test('an absent snapshot and a failed load are both said plainly', async () => {
  apiClient.get.mockResolvedValueOnce({ data: { ...DATA, snapshot: { status: 'absent', error: 'no snapshot yet' }, verification: {} } });
  const { unmount } = render(<VerificationPanel />);
  expect(await screen.findByText(/no snapshot yet/)).toBeInTheDocument();
  unmount();
  apiClient.get.mockRejectedValueOnce(new Error('500'));
  render(<VerificationPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the verification view.');
});
