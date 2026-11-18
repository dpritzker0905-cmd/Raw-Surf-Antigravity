import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import apiClient from '../../lib/apiClient';
import AdminSurfForecastPanel, { flagValueText, matchesGroup } from './AdminSurfForecastPanel';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), delete: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

const FLAGS = [
  { name: 'SURF_TIDE_DEPTH', value: '0', default: '1', kind: 'switch', source: 'manifest', guarded: true,
    fix_version: '2026-11-04', serve_box_value: true, controls: 'tide depth', where: 'runtime manifest',
    manifest_entry: { state: 'off', reason: 'hs_station worse', set_by: 'flag-guardrail', set_at: '2026-11-18T01:00:00Z', evidence: 'run 9' } },
  { name: 'SURF_REFRACTION_KR', value: '0.873', default: '0.873', kind: 'setting', source: 'default', guarded: false,
    serve_box_value: true, controls: 'refraction coefficient', where: 'Render env', manifest_entry: null },
  { name: 'ICON_PEAK_PERIOD', value: '0', default: '0', kind: 'switch', source: 'default', guarded: false,
    serve_box_value: false, controls: 'GWAM peak periods', where: 'workflow env; NOT Render', manifest_entry: null },
];
const STATUS = {
  flags: FLAGS,
  manifest: { good_at: 1763427600, read_at: 1763427600, error: null, entries: 1 },
  blobs: { spot_ratings: { frames: 120, models: ['gfs'], generated_at: '2026-11-18T00:00:00Z', confirmed_spot_frames: 3 },
    spot_size_climatology: { error: 'L2 timeout' }, grid_size_climatology: { cells_ready: 5, cells_tracked: 9 } },
  regional_tile_first: { decisions: 4 }, gulf_fill_targeted: { error: 'not loaded' },
};
const REPORTS = [{ id: 'r1', spot_name: 'Pier', rating: 5, created_at: '2026-11-18T01:00:00Z', influences_rating_now: true }];

beforeEach(() => {
  apiClient.get.mockReset();
  apiClient.delete.mockReset();
  apiClient.get.mockImplementation((url) => Promise.resolve(
    { data: url.startsWith('/admin/surf-forecast/status') ? STATUS : { reports: REPORTS } }));
  apiClient.delete.mockResolvedValue({ data: { deleted: 'r1' } });
});

test('value text and groups', () => {
  expect(flagValueText(FLAGS[0])).toBe('Off');
  expect(flagValueText(FLAGS[1])).toBe('0.873');
  expect(matchesGroup(FLAGS[0], 'guardrail')).toBe(true);
  expect(matchesGroup(FLAGS[1], 'settings')).toBe(true);
  expect(matchesGroup(FLAGS[1], 'changed')).toBe(false);
});

test('a guardrail OFF shows its reason, a setting shows its value, a lane-only flag says so', async () => {
  render(<AdminSurfForecastPanel />);
  const tide = await screen.findByTestId('flag-SURF_TIDE_DEPTH');
  expect(within(tide).getByText(/turned OFF — hs_station worse \(by flag-guardrail/)).toBeInTheDocument();
  expect(within(tide).getByText('set by the guardrail manifest')).toBeInTheDocument();
  expect(within(tide).getByText(/default On/)).toBeInTheDocument();
  expect(within(screen.getByTestId('flag-SURF_REFRACTION_KR')).getByText('0.873')).toBeInTheDocument();
  expect(within(screen.getByTestId('flag-ICON_PEAK_PERIOD')).getByText(/says nothing about the lane/)).toBeInTheDocument();
  expect(screen.getByText(/Guardrail manifest read .*: 1 entry\./)).toHaveAttribute('role', 'status');
});

test('search and groups filter the board', async () => {
  render(<AdminSurfForecastPanel />);
  await screen.findByTestId('flag-SURF_TIDE_DEPTH');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search flags' }), { target: { value: 'refraction' } });
  expect(screen.getByText('Showing 1 of 3 flags')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search flags' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('radio', { name: /set by guardrail \(1\)/i }));
  expect(screen.getByText('Showing 1 of 3 flags')).toBeInTheDocument();
  expect(screen.queryByTestId('flag-SURF_REFRACTION_KR')).toBeNull();
});

test('a failed data read is shown as a failure, not as zero', async () => {
  render(<AdminSurfForecastPanel />);
  expect(await screen.findByText(/Could not read: L2 timeout/)).toBeInTheDocument();
  expect(screen.getByText(/Targeted Gulf fill .*could not read \(not loaded\)/)).toBeInTheDocument();
});

test('deleting a report asks in a dialog, names the report, and calls the API', async () => {
  render(<AdminSurfForecastPanel />);
  const del = await screen.findByRole('button', { name: /^Delete report: Pier,/ });
  expect(screen.getAllByRole('columnheader').every((th) => th.getAttribute('scope') === 'col')).toBe(true);
  fireEvent.click(del);
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(/influencing live ratings now/);
  expect(apiClient.delete).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete report' }));
  await waitFor(() => expect(apiClient.delete).toHaveBeenCalledWith('/admin/surf-forecast/reports/r1'));
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Delete report: Pier,/ })).toBeNull());
});
