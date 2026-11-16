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
    target_id: 'p1', reason: 'two weeks of checks', detail: { from: null, to: 'probation' }, at: '2026-11-16T10:00:00Z' }],
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

test('a status change needs a reason and posts only status + reason', async () => {
  render(<AnchorsTab />);
  fireEvent.click(await screen.findByRole('button', { name: /change anchor status for pat/i }));
  const save = screen.getByRole('button', { name: /save status/i });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole('radio', { name: 'Active' }));
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'passed probation' } });
  fireEvent.click(save);
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/admin/surf-truth/anchors/p1/status',
    { status: 'active', reason: 'passed probation' }));
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
