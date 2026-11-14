import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GalleryPage } from './GalleryPage';
import apiClient from '../lib/apiClient';

let mockUser = { id: 'photographer-a', role: 'Photographer' };
let mockTheme = 'light';
const mockPricing = { generalSettings: null, lastUpdated: 0 };
const mockFolders = jest.fn();
const mockItems = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }), useThemeName: () => mockTheme }));
jest.mock('../contexts/PricingContext', () => ({ usePricing: () => mockPricing }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../hooks/usePullToRefresh', () => ({ __esModule: true, default: () => ({ pullRef: { current: null } }) }));
// Keep the real page, actions composition, folder loader and folder list. These children do not own load state.
jest.mock('./GalleryGrid', () => ({ GalleryGrid: ({ items }) => <div>{items.map(item => <span key={item.id}>{item.title || item.id}</span>)}</div> }));
jest.mock('./WatermarkSettings', () => () => null);
jest.mock('./gallery/UploadPhotoModal', () => ({ UploadPhotoModal: () => null }));
jest.mock('./gallery/GalleryItemModal', () => ({ GalleryItemModal: () => null }));
jest.mock('./gallery/SessionRosterCard', () => ({ SessionRosterCard: () => null }));
jest.mock('./gallery/PostSessionSummary', () => ({ PostSessionSummary: () => null }));
jest.mock('./gallery/GalleryFolderModals', () => ({ GalleryFolderModals: () => null }));
jest.mock('./gallery/GalleryModals', () => ({ TagAssignModal: () => null }));
jest.mock('./gallery/GalleryPricingCard', () => ({ GalleryPricingCard: () => null }));
jest.mock('./gallery/GromHighlightsCard', () => () => null);
jest.mock('./gallery/ProStudioManager', () => ({ ProStudioManager: () => null }));
jest.mock('./ui/PullToRefreshIndicator', () => () => null);
jest.mock('./ui/SkeletonVariants', () => ({ GallerySkeleton: () => 'Loading gallery' }));

const folder = { id: 'folder-a', title: 'Session A', item_count: 1, created_at: '2026-10-20T12:00:00Z' };
const unavailable = () => Object.assign(new Error('Unavailable'), { response: { status: 503 } });
const pending = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'photographer-a', role: 'Photographer' };
  mockTheme = 'light';
  mockPricing.lastUpdated = 0;
  mockFolders.mockReset().mockResolvedValue({ data: [] });
  mockItems.mockReset().mockResolvedValue({ data: [] });
  apiClient.get.mockImplementation(url => {
    if (url.startsWith('/galleries/photographer/')) return mockFolders(url);
    if (/^\/galleries\/[^/]+\/items\?/.test(url)) return mockItems(url);
    return Promise.resolve({ data: url.startsWith('/gallery/photographer/') ? [] : {} });
  });
  apiClient.post.mockResolvedValue({ data: {} });
});

test.each(['light', 'dark', 'beach'])('initial folder failure is persistent and recoverable with keyboard in %s', async theme => {
  mockTheme = theme;
  mockFolders.mockRejectedValueOnce(unavailable()).mockResolvedValueOnce({ data: [folder] });
  render(<GalleryPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/unable to load folders/i);
  expect(screen.queryByText(/No folders yet/)).not.toBeInTheDocument();
  const retry = screen.getByRole('button', { name: 'Retry folders' });
  retry.focus();
  await userEvent.setup().keyboard('{Enter}');
  expect(await screen.findByTestId('session-gallery-folder-a')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(apiClient.delete).not.toHaveBeenCalled();
  expect(apiClient.patch).not.toHaveBeenCalled();
});

test('same-owner refresh failure retains folders; only successful empty retry renders empty', async () => {
  mockFolders.mockResolvedValueOnce({ data: [folder] }).mockRejectedValueOnce(unavailable()).mockResolvedValueOnce({ data: [] });
  const { rerender } = render(<GalleryPage />);
  await screen.findByTestId('session-gallery-folder-a');
  mockPricing.lastUpdated = 1;
  rerender(<GalleryPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/unable to load folders/i);
  expect(screen.getByTestId('session-gallery-folder-a')).toBeInTheDocument();
  expect(screen.queryByText(/No folders yet/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry folders' }));
  expect(await screen.findByText(/No folders yet/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('selected folder failure is not an empty gallery, and retry recovers items', async () => {
  mockFolders.mockResolvedValue({ data: [folder] });
  mockItems.mockRejectedValueOnce(unavailable()).mockResolvedValueOnce({ data: [{ id: 'photo-a', title: 'Photo A' }] });
  render(<GalleryPage />);
  fireEvent.click(await screen.findByTestId('session-gallery-folder-a'));
  expect(await screen.findByRole('alert')).toHaveTextContent(/unable to load gallery items/i);
  expect(screen.queryByText('No items in this gallery yet')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry gallery items' }));
  expect(await screen.findByText('Photo A')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a failed load for the next user never retains the previous user folders', async () => {
  const nextUserLoad = pending();
  mockFolders.mockResolvedValueOnce({ data: [folder] }).mockReturnValueOnce(nextUserLoad.promise);
  const { rerender } = render(<GalleryPage />);
  await screen.findByTestId('session-gallery-folder-a');
  mockUser = { id: 'photographer-b', role: 'Photographer' };
  rerender(<GalleryPage />);
  await waitFor(() => expect(mockFolders).toHaveBeenCalledWith('/galleries/photographer/photographer-b'));
  await act(async () => { nextUserLoad.reject(unavailable()); });
  expect(await screen.findByRole('alert')).toHaveTextContent(/unable to load folders/i);
  expect(screen.queryByTestId('session-gallery-folder-a')).not.toBeInTheDocument();
  expect(screen.queryByText(/No folders yet/)).not.toBeInTheDocument();
});


test('retry is busy and cannot claim empty until a successful empty folder response', async () => {
  const retryLoad = pending();
  mockFolders.mockRejectedValueOnce(unavailable()).mockReturnValueOnce(retryLoad.promise);
  render(<GalleryPage />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry folders' }));
  expect(screen.getByRole('button', { name: 'Retry folders' })).toBeDisabled();
  expect(screen.getByRole('status', { name: 'Loading folders' })).toBeInTheDocument();
  expect(screen.queryByText(/No folders yet/)).not.toBeInTheDocument();
  await act(async () => { retryLoad.resolve({ data: [] }); });
  expect(await screen.findByText(/No folders yet/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('successful empty items after retry is an authoritative empty gallery', async () => {
  const retryLoad = pending();
  mockFolders.mockResolvedValue({ data: [folder] });
  mockItems.mockRejectedValueOnce(unavailable()).mockReturnValueOnce(retryLoad.promise);
  render(<GalleryPage />);
  fireEvent.click(await screen.findByTestId('session-gallery-folder-a'));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry gallery items' }));
  expect(screen.getByRole('button', { name: 'Retry gallery items' })).toBeDisabled();
  expect(screen.getByRole('status', { name: 'Loading gallery items' })).toBeInTheDocument();
  expect(screen.queryByText('No items in this gallery yet')).not.toBeInTheDocument();
  await act(async () => { retryLoad.resolve({ data: [] }); });
  expect(await screen.findByText('No items in this gallery yet')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});


test('StrictMode cleanup does not discard the current failure or its successful retry', async () => {
  mockFolders.mockRejectedValue(unavailable());
  render(<React.StrictMode><GalleryPage /></React.StrictMode>);
  expect(await screen.findByRole('alert')).toHaveTextContent(/unable to load folders/i);
  mockFolders.mockResolvedValue({ data: [folder] });
  fireEvent.click(screen.getByRole('button', { name: 'Retry folders' }));
  expect(await screen.findByTestId('session-gallery-folder-a')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});


test.each([null, {}])('a successful malformed folders payload %p is unavailable until a valid empty retry', async data => {
  mockFolders.mockResolvedValueOnce({ status: 200, data }).mockResolvedValueOnce({ status: 200, data: [] });
  render(<GalleryPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/unable to load folders/i);
  expect(screen.queryByText(/No folders yet/)).not.toBeInTheDocument();
  expect(screen.getByText('Folders unavailable')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry folders' }));
  expect(await screen.findByText(/No folders yet/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test.each([null, {}])('a successful malformed items payload %p is unavailable until a valid empty retry', async data => {
  mockFolders.mockResolvedValue({ data: [folder] });
  mockItems.mockResolvedValueOnce({ status: 200, data }).mockResolvedValueOnce({ status: 200, data: [] });
  render(<GalleryPage />);
  fireEvent.click(await screen.findByTestId('session-gallery-folder-a'));
  expect(await screen.findByRole('alert')).toHaveTextContent(/unable to load gallery items/i);
  expect(screen.queryByText('No items in this gallery yet')).not.toBeInTheDocument();
  expect(screen.getByText('Items unavailable')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry gallery items' }));
  expect(await screen.findByText('No items in this gallery yet')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
