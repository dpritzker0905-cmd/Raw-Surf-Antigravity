import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import apiClient from '../../../lib/apiClient';
import AdminSurfTruthPanel, { SURF_TRUTH_TABS } from './AdminSurfTruthPanel';
import ObserversTab from './ObserversTab';
import QualityQueueTab from './QualityQueueTab';
import AnchorsTab from './AnchorsTab';

jest.mock('../../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const DATA = {
  '/admin/surf-truth/anchors': [{ profile_id: 'p1', name: 'Pat', status: 'probation',
    status_since: '2026-11-16T10:00:00Z', appointed_at: '2026-11-16T10:00:00Z', observations_30d: 4 }],
  '/admin/surf-truth/actions?limit=50': [{ id: 'a1', admin_id: 'boss', action: 'anchor_status', target_type: 'anchor',
    target_id: 'p1', reason: 'new_anchor_watch', detail: { from: null, to: 'probation' }, at: '2026-11-16T10:00:00Z' }],
  '/admin/surf-truth/observers?days=30': [{ profile_id: 'u1', name: 'Uma', anchor_status: null, observations: 3,
    quality_ok: 2, flagged: 1, corroborated: 1, xp_paid: 1, blind: 2, spots: 2, last_at: '2026-11-16T09:00:00Z' }],
  '/admin/surf-truth/coverage?days=30': { days: 30, spots: [], totals: { spots: 0, observations: 0, quality_ok: 0,
    multi_observer_spots: 0 } },
  '/admin/surf-observations/audits': [{ id: 'o9', spot_id: 's0', surface: 'condition_report',
    received_at: '2026-11-16T09:00:00Z', media_url: 'https://cdn.example.test/p.jpg', gps_distance_m: 120,
    exif_distance_m: 340, exif_age_s: 60, flags: ['range_only'] }],
};

beforeEach(() => {
  apiClient.get.mockImplementation((path) => Promise.resolve({ data: DATA[path] }));
  apiClient.post.mockResolvedValue({ data: {} });
});

test('six labelled tabs in a keyboard-operable tablist', async () => {
  render(<AdminSurfTruthPanel />);
  const list = screen.getByRole('tablist', { name: /surf truth sections/i });
  const tabs = within(list).getAllByRole('tab');
  expect(tabs.map((t) => t.textContent)).toEqual(SURF_TRUTH_TABS.map((t) => t.label));
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  await screen.findByText('Pat');
});

test('a status change needs a reason code and posts only status + reason', async () => {
  render(<AnchorsTab />);
  expect(await screen.findByText('Reason: New anchor: watch period first')).toBeInTheDocument();   // code shown as words
  fireEvent.click(await screen.findByRole('button', { name: /change anchor status for pat/i }));
  const save = screen.getByRole('button', { name: /save status/i });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: 'Active' }));
  // a fixed list, not a text box: the logs are append-only and must not hold free text about a person
  expect(screen.getByLabelText('Reason').tagName).toBe('SELECT');
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'probation_passed' } });
  fireEvent.click(save);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/admin/surf-truth/anchors/p1/status',
    { status: 'active', reason: 'probation_passed' }));
});

test('observers view shows counts and offers to make an anchor, never a height', async () => {
  const { container } = render(<ObserversTab />);
  expect(await screen.findByRole('button', { name: /set anchor status for uma/i })).toHaveTextContent('Make anchor');
  expect(container.textContent).not.toMatch(/\bft\b|face_m|height/i);
});

test('audit queue hides the height and records a verdict', async () => {
  const { container } = render(<QualityQueueTab />);
  const pass = await screen.findByRole('button', { name: /pass report/i });
  expect(container.textContent).not.toMatch(/\bft\b|height_value|face_m/);
  expect(screen.getByText(/gave a range/)).toBeInTheDocument();
  fireEvent.click(pass);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/admin/surf-observations/o9/audit',
    { verdict: 'pass' }));
});

test('failing an audit asks for a reason in a dialog and sends it; no reason, no request', async () => {
  render(<QualityQueueTab />);
  fireEvent.click(await screen.findByRole('button', { name: /fail report received/i }));
  const dialog = await screen.findByRole('dialog');
  const submit = screen.getByRole('button', { name: /^fail report$/i });
  expect(submit).toBeDisabled();                                    // no reason, no request
  expect(screen.getByLabelText('Reason').tagName).toBe('SELECT');    // reason codes only
  expect(apiClient.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'photo_wrong_spot' } });
  fireEvent.click(submit);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/admin/surf-observations/o9/audit',
    { verdict: 'fail', reason: 'photo_wrong_spot' }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
});


// ── anchor history + model exports (admin survey follow-ups) ──────────────────────────────────────────────────────
test('an anchor\'s status history opens from its row and names who changed it and why', async () => {
  apiClient.get.mockImplementation((path) => Promise.resolve({ data: path === '/admin/surf-truth/anchors/p1/events'
    ? [{ from_status: null, to_status: 'probation', actor_id: 'boss', actor_name: 'Boss', reason: 'two weeks of checks',
      at: '2026-11-16T10:00:00Z' },
    { from_status: 'probation', to_status: 'active', actor_id: 'boss', actor_name: 'Boss', reason: 'probation_passed',
      at: '2026-11-17T10:00:00Z' }] : DATA[path] }));
  render(<AnchorsTab />);
  fireEvent.click(await screen.findByRole('button', { name: 'Status history for Pat' }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('appointed as probation')).toBeInTheDocument();
  expect(dialog).toHaveTextContent('by Boss');
  expect(dialog).toHaveTextContent('two weeks of checks');        // an older free-text reason is shown as written
  expect(dialog).toHaveTextContent('Reason: Probation passed');    // a reason code is shown by its label, not the code
  expect(dialog).not.toHaveTextContent('probation_passed');
});

test('an export needs the owner-approval box, then posts and shows the run; past exports are listed', async () => {
  const actions = [{ id: 'x1', admin_id: 'boss', admin_name: 'Boss', action: 'export', target_type: 'surf_truth_export',
    target_id: 'run0', detail: { rows: 12, object: 'surf-truth/exports/2026-11-17/run0.jsonl' }, at: '2026-11-17T10:00:00Z' },
  { id: 'a1', admin_id: 'boss', action: 'anchor_status', target_type: 'anchor', target_id: 'p1', at: '2026-11-16T10:00:00Z' }];
  apiClient.get.mockImplementation((path) => Promise.resolve({ data: path === '/admin/surf-truth/actions?limit=200' ? actions : DATA[path] }));
  apiClient.post.mockResolvedValue({ data: { run_id: 'run1', rows: 20, data_object: 'x' } });
  const { default: ModelTab } = await import('./ModelTab');
  render(<ModelTab />);
  const list = await screen.findByRole('list', { name: 'Exports, newest first' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  expect(list).toHaveTextContent('Run run0');
  expect(list).toHaveTextContent('12 rows');
  fireEvent.click(screen.getByRole('button', { name: /run an export/i }));
  const dialog = await screen.findByRole('dialog');
  const run = within(dialog).getByRole('button', { name: 'Run export' });
  expect(run).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /owner has approved exports/i }));
  fireEvent.click(run);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/admin/surf-truth/export'));
  expect(await within(dialog).findByText('Written: 20 rows, run run1.')).toBeInTheDocument();
});

test('a refused export says why', async () => {
  apiClient.get.mockImplementation((path) => Promise.resolve({ data: path === '/admin/surf-truth/actions?limit=200' ? [] : DATA[path] }));
  apiClient.post.mockRejectedValue({ response: { status: 503, data: { detail: 'SURF_TRUTH_EXPORT_KEY is not set' } } });
  const { default: ModelTab } = await import('./ModelTab');
  render(<ModelTab />);
  fireEvent.click(await screen.findByRole('button', { name: /run an export/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Run export' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('SURF_TRUTH_EXPORT_KEY is not set');
});