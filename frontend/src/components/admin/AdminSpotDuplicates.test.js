/**
 * AdminSpotDuplicates — the duplicate review surface.
 *
 * These exist because the previous way to check this panel was to run a script, read a terminal,
 * and take someone's word for it. The payloads below are the REAL shapes the live catalogue
 * produces (measured 2026-07-28: 1773 spots -> 0 IDENTICAL / 107 VARIANT / 26 WEAK / 82
 * DISTINCT_PEAKS), so a regression here fails in CI rather than in a screenshot nobody took.
 *
 * ★ The load-failure case is pinned deliberately: this panel's whole reason to exist is telling a
 * human what is true, and the same component family already shipped a bug where a 401 rendered as
 * a confident "0" (see AdminSpotsStats). A failed scan must read "—", never zero.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

import apiClient from '../../lib/apiClient';
import { AdminSpotDuplicates } from './AdminSpotDuplicates';

const pair = (tier, km, why, a, b) => ({
  tier, km, why,
  a: { id: `${a}-id`, name: a, region: 'R1', latitude: 1.2345, longitude: 2.3456,
       accuracy_flag: 'unverified', is_verified_peak: false },
  b: { id: `${b}-id`, name: b, region: 'R2', latitude: 1.24, longitude: 2.35,
       accuracy_flag: 'low_accuracy', is_verified_peak: false },
});

const PAYLOAD = {
  scanned_spots: 1773,
  max_km: 8.0,
  counts: { IDENTICAL: 0, VARIANT: 107, WEAK: 26, DISTINCT_PEAKS: 82 },
  pairs: [
    pair('VARIANT', 0.348, 'one name contains the other; extra: peak',
         'Uluwatu', 'Uluwatu - The Peak'),
    pair('DISTINCT_PEAKS', 0.15, 'differ by position: north, south',
         'Ponce Inlet North Jetty', 'Ponce Inlet South Jetty'),
  ],
};

beforeEach(() => jest.clearAllMocks());

describe('AdminSpotDuplicates', () => {
  it('shows the live tier counts and what was scanned', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AdminSpotDuplicates />);
    await waitFor(() => expect(screen.getByText('107')).toBeInTheDocument());
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('26')).toBeInTheDocument();
    expect(screen.getByText(/1773 spots scanned within 8 km/)).toBeInTheDocument();
  });

  it('defaults to the IDENTICAL tier and reports it empty rather than blank', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AdminSpotDuplicates />);
    await waitFor(() => expect(screen.getByText('No pairs in this tier.')).toBeInTheDocument());
  });

  it('shows a pair with its distance, reason and BOTH spots when its tier is selected', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AdminSpotDuplicates />);
    await waitFor(() => expect(screen.getByText('107')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: /Variant/i }));
    expect(await screen.findByText('Uluwatu')).toBeInTheDocument();
    expect(screen.getByText('Uluwatu - The Peak')).toBeInTheDocument();
    expect(screen.getByText('0.348 km apart')).toBeInTheDocument();
    expect(screen.getByText(/one name contains the other/)).toBeInTheDocument();
    // the evidence a human needs to judge: coordinates and the accuracy flag
    expect(screen.getByText(/1\.2345/)).toBeInTheDocument();
    expect(screen.getByText('low_accuracy')).toBeInTheDocument();
  });

  it('keeps real separate peaks in their own tier, not among the merge candidates', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AdminSpotDuplicates />);
    await waitFor(() => expect(screen.getByText('82')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: /Distinct peaks/i }));
    expect(await screen.findByText('Ponce Inlet North Jetty')).toBeInTheDocument();
    expect(screen.getByText(/differ by position/)).toBeInTheDocument();
    expect(screen.queryByText('Uluwatu')).not.toBeInTheDocument();
  });

  it('★ a failed scan renders "—" and says why — never a confident zero', async () => {
    apiClient.get.mockRejectedValue({ response: { status: 401 } });
    render(<AdminSpotDuplicates />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i));
    expect(screen.getAllByText('—')).toHaveLength(4);   // one per tier tile
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('rescans on demand, so the panel verifies a merge instead of caching a stale answer', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AdminSpotDuplicates />);
    // Wait for the LOADED state, not merely for the call — the Rescan button is disabled while
    // loading, so clicking too early silently does nothing.
    await waitFor(() => expect(screen.getByText('107')).toBeInTheDocument());
    expect(apiClient.get).toHaveBeenCalledTimes(1);

    apiClient.get.mockResolvedValue({
      data: { ...PAYLOAD, counts: { IDENTICAL: 0, VARIANT: 3, WEAK: 0, DISTINCT_PEAKS: 0 },
              pairs: [] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Rescan for duplicate spots/i }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    // the count moved on its own — which is what makes this panel a verification of a merge
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.queryByText('107')).not.toBeInTheDocument();
  });

  it('tier tiles are real tabs with selection state (accessibility mandate)', async () => {
    apiClient.get.mockResolvedValue({ data: PAYLOAD });
    render(<AdminSpotDuplicates />);
    await waitFor(() => expect(screen.getByText('107')).toBeInTheDocument());

    const identical = screen.getByRole('tab', { name: /Identical/i });
    const variant = screen.getByRole('tab', { name: /Variant/i });
    expect(identical).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(variant);
    expect(variant).toHaveAttribute('aria-selected', 'true');
    expect(identical).toHaveAttribute('aria-selected', 'false');
  });
});
