import React from 'react';
import { render, screen, within } from '@testing-library/react';
import apiClient from '../../lib/apiClient';
import GuardrailHistory, { reenableCommand } from './GuardrailHistory';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));

const VIEW = {
  schedule_utc: '02:30, 08:30, 14:30 and 20:30 UTC',
  workflow_url: 'https://github.com/o/r/actions/workflows/flag-guardrail.yml',
  guarded: { SURF_TIDE_DEPTH: { code_default: '1', fix_version: '2026-11-20' } },
  entries: { SURF_TIDE_DEPTH: { state: 'off', reason: 'auto-disabled: WORSE', set_by: 'flag-guardrail',
    set_at: '2026-11-18T02:30:00Z', evidence: 'https://example.invalid/run/1', fix_version: '2026-11-04' } },
  actions: [{ at: '2026-11-18T02:30:00Z', flag: 'SURF_TIDE_DEPTH', action: 'disable', reason: 'WORSE', run: 'https://example.invalid/run/1' }],
  errors: [],
};

beforeEach(() => apiClient.get.mockReset());

test('the re-enable command names the flag and asks for the owner\'s words', () => {
  expect(reenableCommand('X')).toBe('gh workflow run flag-guardrail.yml -f reenable=X -f owner_words="<your words, verbatim>"');
});

test('shows what the guardrail set, why, how it comes back, and the decisions it applied', async () => {
  apiClient.get.mockResolvedValue({ data: VIEW });
  render(<GuardrailHistory />);
  const entry = await screen.findByTestId('guardrail-entry-SURF_TIDE_DEPTH');
  expect(apiClient.get).toHaveBeenCalledWith('/admin/surf-forecast/guardrail');
  expect(entry).toHaveTextContent('SURF_TIDE_DEPTH: OFF by flag-guardrail');
  expect(entry).toHaveTextContent('auto-disabled: WORSE');
  expect(entry).toHaveTextContent('a newer version is in the code, so the next run clears this');
  expect(within(entry).getByRole('button', { name: 'Copy the re-enable command for SURF_TIDE_DEPTH' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /open the guardrail workflow/i })).toHaveAttribute('href', VIEW.workflow_url);
  const table = within(screen.getByRole('region', { name: 'Guardrail decisions' })).getByRole('table');
  expect(table).toHaveTextContent('Turned off');
  expect(within(table).getByRole('link', { name: /guardrail run for SURF_TIDE_DEPTH/i })).toBeInTheDocument();
});

test('nothing recorded is explained, and read errors are shown', async () => {
  apiClient.get.mockResolvedValue({ data: { ...VIEW, entries: {}, actions: [], errors: ['decision history unreadable: 403'] } });
  render(<GuardrailHistory />);
  expect(await screen.findByText(/every guarded fix runs on its code default/)).toBeInTheDocument();
  expect(screen.getByText(/records only the decisions it applies \(enforce mode\)/)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('decision history unreadable: 403');
});
