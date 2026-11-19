import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import apiClient from '../../lib/apiClient';
import SpotInspector, { heightText } from './SpotInspector';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));

const DETAIL = {
  spot: { id: 'pipe', name: 'Pipeline', region: 'Hawaii', country: 'USA', latitude: 21.665, longitude: -158.05,
    accuracy_flag: 'surveyed', is_verified_peak: true },
  geometry: { shore_normal_deg: 315, shore_normal_src: 'etopo', break_depth_m: 11.1, coastal: true },
  size_climatology: { n: 40, p80_m: 2.4 },
  ratings: { generated_at: '2026-11-18T03:00:00Z', frames: [
    { model: 'GFS', valid_time: '2026-11-18T03:00:00Z', score: 70, level: 'fair', surf_height_m: 1.8, period_s: 14,
      swell_from_deg: 315, limiter: 'wind', limiter_f: 0.62, why: ['onshore wind'], confidence: 'high' },
    { model: 'EURO', valid_time: '2026-11-18T03:00:00Z', score: 75, level: 'good', surf_height_m: 2.0 },
  ] },
};

beforeEach(() => {
  apiClient.get.mockReset();
  apiClient.get.mockImplementation((url) => Promise.resolve({ data: url.includes('?q=')
    ? { spots: [{ id: 'pipe', name: 'Pipeline', region: 'Hawaii' }] } : DETAIL }));
});

test('heights in metres and feet', () => {
  expect(heightText(1.8)).toBe('1.80 m (5.9 ft)');
  expect(heightText(null)).toBe('—');
});

test('search, pick a spot, see geometry, the size reference and every frame with its limiter', async () => {
  render(<SpotInspector />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search spots by name' }), { target: { value: 'pip' } });
  const pick = await screen.findByRole('button', { name: 'Pipeline, Hawaii' }, { timeout: 2000 });
  expect(apiClient.get).toHaveBeenCalledWith('/admin/surf-forecast/spots?q=pip');
  fireEvent.click(pick);
  const section = await screen.findByRole('region', { name: 'Inspection of Pipeline' });
  expect(apiClient.get).toHaveBeenCalledWith('/admin/surf-forecast/spots/pipe');
  expect(within(section).getByText('Break depth (caps breaking height)').nextSibling).toHaveTextContent('11.1 m');
  expect(within(section).getByText('Shore normal source').nextSibling).toHaveTextContent('etopo');
  expect(within(section).getByText('p80 m').nextSibling).toHaveTextContent('2.4');
  const rows = within(section).getAllByRole('row');
  expect(rows).toHaveLength(3);                                            // header + 2 frames
  expect(rows[1]).toHaveTextContent('wind (×0.62)');
  expect(rows[1]).toHaveTextContent('1.80 m (5.9 ft)');
  expect(within(section).getAllByRole('columnheader').every((th) => th.getAttribute('scope') === 'col')).toBe(true);
  fireEvent.click(within(section).getByRole('radio', { name: 'EURO' }));
  await waitFor(() => expect(within(section).getAllByRole('row')).toHaveLength(2));
});

test('a geometry or ratings failure is reported, not hidden', async () => {
  apiClient.get.mockImplementation((url) => Promise.resolve({ data: url.includes('?q=')
    ? { spots: [{ id: 'pipe', name: 'Pipeline' }] }
    : { ...DETAIL, geometry: { error: 'asset missing' }, ratings: { error: 'L2 timeout' } } }));
  render(<SpotInspector />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'pip' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Pipeline' }, { timeout: 2000 }));
  expect(await screen.findByText('Could not resolve: asset missing')).toHaveAttribute('role', 'alert');
  expect(screen.getByText('Could not read the ratings: L2 timeout')).toHaveAttribute('role', 'alert');
});
