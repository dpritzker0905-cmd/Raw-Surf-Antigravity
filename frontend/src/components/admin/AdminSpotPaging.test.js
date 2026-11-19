/**
 * The admin spot tables page through every row (owner, 2026-11-18: "We should allow more spots on a table too in
 * the admin, so we can have pagination to see them all in the table better").
 *
 * Before: the Spots table asked for 5,000 rows and showed 50; the Precision Queue showed 20 of about 1,700 and its
 * tab read "Flagged (20)". These pin the request each table sends, the true totals it shows, the pager's
 * accessible controls, and that the kill switch puts the old requests back.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../lib/apiClient', () => ({
  __esModule: true, default: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../../utils/leafletLoader', () => ({}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin-1' } }) }));
jest.mock('./AdminSpotDuplicates', () => ({ AdminSpotDuplicates: () => null }));
jest.mock('./AdminSpotsStats', () => ({ AdminSpotsStats: () => null }));

import apiClient from '../../lib/apiClient';
import { AdminPager } from './AdminPager';
import { AdminPrecisionQueue } from './AdminPrecisionQueue';
import { AdminSpotCandidates } from './AdminSpotCandidates';
import { AdminSpotsPanel } from './AdminSpotsPanel';
import { pageWindow, adminSpotPagingDisabled } from './adminSpotPaging';

const spot = (n) => ({ id: `s${n}`, name: `Spot ${n}`, country: 'Portugal', region: 'R', latitude: 1, longitude: 2,
  accuracy_flag: 'unverified', flagged_for_review: false, is_active: true });
const candidate = (n) => ({ id: `c${n}`, name: `Candidate ${n}`, country: 'ID', latitude: -8.1, longitude: 115.2,
  tier: 'F', status: 'pending', nearest_spot_name: null, nearest_spot_km: null, shoreline_km: 0.21 });
const COUNTS = { all: 23732, by_status: { pending: 23000, held: 2, rejected: 700, duplicate: 30, promoted: 0 },
  by_tier: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 23732 } };

// Answers each admin endpoint with one page; records what was asked.
const serve = ({ spots = 1776, queue = 1702, candidates = 23732 } = {}) => {
  apiClient.get.mockImplementation((url, config) => {
    const params = config?.params || Object.fromEntries(new URLSearchParams(url.split('?')[1] || ''));
    const limit = Number(params.limit || 20);
    const page = Number(params.page || 1);
    const rows = (total, make) => Array.from(
      { length: Math.max(0, Math.min(limit, total - (page - 1) * limit)) }, (_, i) => make((page - 1) * limit + i + 1));
    if (url.startsWith('/admin/spots/stats')) {
      return Promise.resolve({ data: { total_spots: 1776, by_country: [{ country: 'Portugal', count: 90 }, { country: 'Fiji', count: 12 }] } });
    }
    if (url.startsWith('/admin/spots/list')) return Promise.resolve({ data: { spots: rows(spots, spot), total: spots, page, limit } });
    if (url.startsWith('/admin/spots/queue')) return Promise.resolve({ data: { queue: rows(queue, spot), total: queue, page, limit } });
    if (url.startsWith('/admin/spots/suggestions')) return Promise.resolve({ data: { suggestions: [], total: 0 } });
    if (url.startsWith('/admin/spots/candidates')) {
      return Promise.resolve({ data: { candidates: rows(candidates, candidate), total: candidates, page, limit, counts: COUNTS } });
    }
    return Promise.reject(new Error(`unexpected ${url}`));
  });
};
const asked = (prefix) => apiClient.get.mock.calls.filter(([url]) => url.startsWith(prefix))
  .map(([url, config]) => config?.params || Object.fromEntries(new URLSearchParams(url.split('?')[1] || '')));
const last = (prefix) => asked(prefix).slice(-1)[0];

beforeEach(() => { jest.clearAllMocks(); delete window.__RAW_DISABLE_ADMIN_SPOT_PAGING__; });
afterEach(() => { jest.useRealTimers(); });

describe('pageWindow', () => {
  it('places a page in the list and clamps a page past the end', () => {
    expect(pageWindow(1, 50, 1702)).toEqual({ page: 1, pages: 35, from: 1, to: 50, total: 1702 });
    expect(pageWindow(35, 50, 1702)).toEqual({ page: 35, pages: 35, from: 1701, to: 1702, total: 1702 });
    expect(pageWindow(99, 50, 1702).page).toBe(35);
    expect(pageWindow(0, 50, 120).page).toBe(1);
    expect(pageWindow(3, 50, 0)).toEqual({ page: 1, pages: 1, from: 0, to: 0, total: 0 });
    expect(pageWindow(1, 50, 50).pages).toBe(1);
    expect(pageWindow(1, 50, 51).pages).toBe(2);
  });
});

describe('AdminPager', () => {
  const setup = (props = {}) => {
    const onPage = jest.fn();
    const onPageSize = jest.fn();
    render(<AdminPager label="spots" page={2} pageSize={50} total={1702} onPage={onPage} onPageSize={onPageSize} {...props} />);
    return { onPage, onPageSize };
  };

  it('says the range and the page in words, and names every control', () => {
    setup();
    expect(screen.getByRole('navigation', { name: 'spots pages' })).toBeInTheDocument();
    expect(screen.getByTestId('admin-pager-range')).toHaveTextContent('Showing 51–100 of 1,702 spots');
    expect(screen.getByTestId('admin-pager-range')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('admin-pager-page')).toHaveTextContent('Page 2 of 35');
    for (const name of ['First page', 'Previous page', 'Next page', 'Last page']) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
    expect(screen.getByLabelText('Rows per page')).toHaveValue('50');
  });

  it('moves by one, jumps to the ends and changes the page size', () => {
    const { onPage, onPageSize } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    expect(onPage.mock.calls.map(([p]) => p)).toEqual([3, 1, 35, 1]);
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '200' } });
    expect(onPageSize).toHaveBeenCalledWith(200);
  });

  it('disables what cannot be done at either end and says when there is nothing', () => {
    setup({ page: 1 });
    expect(screen.getByRole('button', { name: 'First page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('reads an empty list as empty, not as page 1 of 0', () => {
    setup({ page: 1, total: 0 });
    expect(screen.getByTestId('admin-pager-range')).toHaveTextContent('No spots');
    expect(screen.getByTestId('admin-pager-page')).toHaveTextContent('Page 1 of 1');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });
});

describe('AdminSpotsPanel', () => {
  it('asks for one page and shows the true total', async () => {
    serve();
    render(<AdminSpotsPanel userId="admin-1" />);
    await waitFor(() => expect(screen.getByTestId('admin-pager-range')).toHaveTextContent('Showing 1–50 of 1,776 spots'));
    expect(last('/admin/spots/list')).toEqual({ page: '1', limit: '50' });
    expect(screen.getAllByText(/^Spot \d+$/)).toHaveLength(50);
    expect(screen.getByText(/1,776 matching/)).toBeInTheDocument();
  });

  it('turns the page, filters in the database and starts a new filter at page 1', async () => {
    serve();
    render(<AdminSpotsPanel userId="admin-1" />);
    await waitFor(() => expect(screen.getByTestId('admin-pager')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(last('/admin/spots/list')).toEqual({ page: '2', limit: '50' }));
    await waitFor(() => expect(screen.getByText('Spot 51')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Filter spots by accuracy state'), { target: { value: 'unverified' } });
    await waitFor(() => expect(last('/admin/spots/list')).toEqual({ page: '1', limit: '50', accuracy: 'unverified' }));
    // every country in the database is offered, not only the ones on this page
    fireEvent.change(screen.getByLabelText('Filter spots by country'), { target: { value: 'Fiji' } });
    await waitFor(() => expect(last('/admin/spots/list'))
      .toEqual({ page: '1', limit: '50', country: 'Fiji', accuracy: 'unverified' }));
    fireEvent.change(screen.getByLabelText('Search spots...'), { target: { value: ' pipe ' } });
    await waitFor(() => expect(last('/admin/spots/list').search).toBe('pipe'));
    expect(screen.getByLabelText('Search spots...')).toHaveValue(' pipe ');   // the box was not unmounted mid-word
  });

  it('kill switch: the old request and the old first-50 view', async () => {
    window.__RAW_DISABLE_ADMIN_SPOT_PAGING__ = true;
    expect(adminSpotPagingDisabled()).toBe(true);
    serve({ spots: 120 });
    render(<AdminSpotsPanel userId="admin-1" />);
    await waitFor(() => expect(screen.getByText(/Showing 50 of 120 matching/)).toBeInTheDocument());
    expect(last('/admin/spots/list')).toEqual({ limit: '5000' });
    expect(screen.queryByTestId('admin-pager')).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Spot \d+$/)).toHaveLength(50);
  });
});

describe('AdminPrecisionQueue', () => {
  it('shows the true queue total and pages through it', async () => {
    serve();
    render(<AdminPrecisionQueue />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Flagged (1,702)' })).toBeInTheDocument());
    expect(last('/admin/spots/queue')).toEqual({ page: 1, limit: 50 });
    expect(screen.getByTestId('admin-pager-range')).toHaveTextContent('Showing 1–50 of 1,702 flagged spots');
    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    await waitFor(() => expect(last('/admin/spots/queue')).toEqual({ page: 35, limit: 50 }));
    await waitFor(() => expect(screen.getByText('Spot 1702')).toBeInTheDocument());
    expect(screen.getByText('1702')).toBeInTheDocument();      // the row number continues across pages
  });

  it('opens the candidates tab: the holding table, with its true total', async () => {
    serve();
    render(<AdminPrecisionQueue />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Candidates' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Candidates' }));
    await waitFor(() => expect(screen.getByTestId('admin-pager-range')).toHaveTextContent('Showing 1–50 of 23,732 candidates'));
    expect(last('/admin/spots/candidates')).toEqual({ page: 1, limit: 50, status: 'pending' });
    expect(screen.getByRole('button', { name: 'Candidates (23,000 waiting)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Candidates are not surf spots/)).toBeInTheDocument();
    expect(screen.getAllByText('F: No existing spot nearby').length).toBeGreaterThan(0);
  });

  it('kill switch: the old first-page request, no pager, no candidates tab', async () => {
    window.__RAW_DISABLE_ADMIN_SPOT_PAGING__ = true;
    serve();
    render(<AdminPrecisionQueue />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Flagged (20)' })).toBeInTheDocument());
    expect(apiClient.get.mock.calls.find(([url]) => url === '/admin/spots/queue')[1]).toBeUndefined();
    expect(screen.queryByTestId('admin-pager')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Candidates/ })).not.toBeInTheDocument();
  });
});

describe('AdminSpotCandidates', () => {
  it('filters in the database and starts each new filter at page 1', async () => {
    serve();
    render(<AdminSpotCandidates />);
    await waitFor(() => expect(screen.getByTestId('admin-pager-range')).toHaveTextContent('of 23,732 candidates'));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(last('/admin/spots/candidates')).toEqual({ page: 2, limit: 50, status: 'pending' }));
    fireEvent.change(screen.getByLabelText('Filter candidates by duplicate check'), { target: { value: 'F' } });
    await waitFor(() => expect(last('/admin/spots/candidates')).toEqual({ page: 1, limit: 50, status: 'pending', tier: 'F' }));
    fireEvent.change(screen.getByLabelText('Filter candidates by review status'), { target: { value: '' } });
    await waitFor(() => expect(last('/admin/spots/candidates')).toEqual({ page: 1, limit: 50, tier: 'F' }));
  });

  it('says the holding table is empty instead of showing a blank list', async () => {
    apiClient.get.mockResolvedValue({ data: { candidates: [], total: 0, page: 1, limit: 50,
      counts: { all: 0, by_status: {}, by_tier: {} } } });
    render(<AdminSpotCandidates />);
    await waitFor(() => expect(screen.getByText(/The holding table is empty/)).toBeInTheDocument());
    expect(screen.getByTestId('admin-pager-range')).toHaveTextContent('No candidates');
  });

  it('a failed read is an error, never an empty table', async () => {
    apiClient.get.mockRejectedValue(new Error('401'));
    render(<AdminSpotCandidates />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded'));
    expect(screen.queryByText(/holding table is empty/)).not.toBeInTheDocument();
    await act(async () => {});
  });
});
