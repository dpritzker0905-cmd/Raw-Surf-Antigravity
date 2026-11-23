import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import apiClient from '../../lib/apiClient';
import SwitchBoard, { matchesSwitchGroup, stateText, laneText, serverText } from './SwitchBoard';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));

const GFS = {
  name: 'GFS_WORLD_FULL_HORIZON', kind: 'switch', defaults: ['0'], state: 'on', differs_from_default: true,
  lanes_unknown: 0, registered: false, guarded: false, files: ['backend/x.py'], file_count: 1, repo_vars: ['GFS_WORLD_FULL_HORIZON'],
  server: { value: '0', source: 'default', entry: null },
  lanes: [{ workflow: 'forecast-ingest.yml', form: 'var', var: 'GFS_WORLD_FULL_HORIZON', value: '1', source: 'repo variable GFS_WORLD_FULL_HORIZON' }],
};
const FACE = {
  name: 'SURF_FACE_RANGE', kind: 'switch', defaults: ['1'], state: 'on', differs_from_default: false, lanes_unknown: 0,
  registered: true, guarded: true, fix_version: '2026-11-04', coverage: { class: 'blind', why: 'adds two fields' },
  server: { value: '1', source: 'default', entry: null }, lanes: [], controls: 'face range', where: 'runtime manifest',
};
const UNKNOWN = {
  name: 'ECMWF_WAVE_LAND_CENTRE_BLOCK', kind: 'switch', defaults: ['0'], state: 'unknown', differs_from_default: false,
  lanes_unknown: 1, registered: false, guarded: false, server: { value: '0', source: 'default' },
  lanes: [{ workflow: 'forecast-ingest.yml', form: 'var', var: 'ECMWF_WAVE_LAND_CENTRE_BLOCK', value: null, source: 'set in CI (no snapshot read)' }],
};
const MARGIN = { ...GFS, name: 'MARINE_EXT_CEILING_MARGIN_H', kind: 'setting', state: 'setting' };
const DATA = {
  switches: [GFS, FACE, UNKNOWN, MARGIN],
  counts: { switches: 3, settings: 1, registered: 1, unregistered: 3 },
  repo_vars: [{ name: 'GFS_WORLD_FULL_HORIZON', value: '1', set: true, read_by: ['GFS_WORLD_FULL_HORIZON'] },
    { name: 'OTHER_VAR', value: null, set: false, read_by: [] }],
  repo_vars_known: true,
  snapshot: { status: 'ok', age_h: 1.5, generated_at: '2026-11-23T18:00:00Z', workflow: 'admin-ops-snapshot.yml' },
};

beforeEach(() => {
  apiClient.get.mockReset();
  apiClient.get.mockResolvedValue({ data: DATA });
});

test('a lane ON through a repo variable reads On and counts as changed from default', () => {
  expect(stateText(GFS)).toBe('On');
  expect(matchesSwitchGroup(GFS, 'changed')).toBe(true);
  expect(laneText(GFS.lanes[0])).toBe('forecast-ingest.yml: 1 (repo variable GFS_WORLD_FULL_HORIZON)');
  expect(serverText(GFS)).toBe('This server reads 0 (code default)');
  expect(stateText(UNKNOWN)).toBe('Not known here (set in CI)');
  expect(laneText(UNKNOWN.lanes[0])).toMatch(/not known here/);
  expect(matchesSwitchGroup(FACE, 'blind')).toBe(true);
  expect(matchesSwitchGroup(MARGIN, 'settings')).toBe(true);
  expect(matchesSwitchGroup(UNKNOWN, 'unknown')).toBe(true);
});

test('opens on the changed switches, filters by radio and search, lists repo variables', async () => {
  render(<SwitchBoard />);
  const row = await screen.findByTestId('switch-GFS_WORLD_FULL_HORIZON');
  expect(within(row).getByText('On')).toBeInTheDocument();
  expect(within(row).getByText(/forecast-ingest.yml: 1/)).toBeInTheDocument();
  expect(screen.queryByTestId('switch-SURF_FACE_RANGE')).toBeNull();       // default filter: changed from default
  fireEvent.click(screen.getByRole('radio', { name: /Guardrail blind \(1\)/ }));
  const face = await screen.findByTestId('switch-SURF_FACE_RANGE');
  expect(within(face).getByText(/guardrail coverage: BLIND/)).toBeInTheDocument();
  expect(within(face).getByText(/Why the guardrail cannot score it/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: /^All/ }));
  fireEvent.change(screen.getByLabelText('Search switches'), { target: { value: 'ecmwf' } });
  expect(screen.getByTestId('switch-ECMWF_WAVE_LAND_CENTRE_BLOCK')).toBeInTheDocument();
  expect(screen.queryByTestId('switch-GFS_WORLD_FULL_HORIZON')).toBeNull();
  expect(screen.getByText(/Repository variables \(1 set, 2 known\)/)).toBeInTheDocument();
  expect(screen.getByText('unset')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/ops snapshot/);
});

test('a missing snapshot is an alert, and a failed load hands over to the fallback board', async () => {
  apiClient.get.mockResolvedValueOnce({ data: { ...DATA, snapshot: { status: 'absent', error: 'no snapshot yet' } } });
  const { unmount } = render(<SwitchBoard />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/no snapshot yet/);
  unmount();
  apiClient.get.mockRejectedValueOnce(new Error('500'));
  const onUnavailable = jest.fn();
  render(<SwitchBoard onUnavailable={onUnavailable} />);
  await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
  expect(screen.queryByTestId('switch-board')).toBeNull();
});
