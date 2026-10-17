import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GalleryPage } from './GalleryPage';
import apiClient from '../lib/apiClient';
import useGalleryActions from '../hooks/useGalleryActions';

let mockTheme = 'dark';
const mockUser = { id: 'photographer-a', role: 'Photographer' };
const mockPricing = { generalSettings: null, lastUpdated: 0 };
const mockActions = { handleDistributeAll: jest.fn(), handleOpenTagAssign: jest.fn(), handleAiAutoTag: jest.fn() };
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: mockTheme }), useThemeName: () => mockTheme }));
jest.mock('../contexts/PricingContext', () => ({ usePricing: () => mockPricing }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../utils/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../hooks/useGalleryActions', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../hooks/usePullToRefresh', () => ({ __esModule: true, default: () => ({ pullRef: { current: null } }) }));
jest.mock('./GalleryGrid', () => ({ GalleryGrid: () => 'Gallery items' }));
jest.mock('./WatermarkSettings', () => () => null);
jest.mock('./gallery/UploadPhotoModal', () => ({ UploadPhotoModal: () => null }));
jest.mock('./gallery/GalleryItemModal', () => ({ GalleryItemModal: () => null }));
jest.mock('./gallery/SessionRosterCard', () => ({ SessionRosterCard: () => null }));
jest.mock('./gallery/GalleryFolderList', () => ({ GalleryFolderList: () => null }));
jest.mock('./gallery/GalleryFolderModals', () => ({ GalleryFolderModals: () => null }));
jest.mock('./gallery/GalleryPricingCard', () => ({ GalleryPricingCard: () => null }));
jest.mock('./gallery/GromHighlightsCard', () => () => null);
jest.mock('./gallery/ProStudioManager', () => ({ ProStudioManager: () => null }));
jest.mock('./ui/PullToRefreshIndicator', () => () => null);
jest.mock('./ui/SkeletonVariants', () => ({ GallerySkeleton: () => 'Loading gallery' }));

beforeEach(() => {
  jest.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: {} });
  apiClient.post.mockResolvedValue({ data: {} });
  useGalleryActions.mockImplementation(options => ({
    ...mockActions,
    fetchGallery: async () => { options.setGallery([]); options.setLoading(false); },
    fetchGalleries: async () => { options.setGalleries([]); },
    fetchParticipants: jest.fn(),
  }));
});

test.each(['light', 'dark', 'beach'])('recap initializes the real Gallery Hub data/actions in %s without an automatic write', async theme => {
  mockTheme = theme;
  const initialRecapData = {
    gallery: { id: 'gallery-a', title: 'Session A', item_count: 2, created_at: new Date().toISOString() },
    items: [{ id: 'photo-a' }, { id: 'photo-b' }],
    participants: [{ surfer_id: 'surfer-a', items_distributed: 0 }],
    session: { is_linked: true },
  };
  render(<GalleryPage initialRecapData={initialRecapData} />);
  const distribute = await screen.findByRole('button', { name: 'Distribute All to Lockers' });
  expect(screen.getByRole('heading', { name: /^Session Gallery\b/ })).toBeInTheDocument();
  expect(screen.getByText('With deliveries')).toBeInTheDocument();
  const data = useGalleryActions.mock.calls.at(-1)[0];
  expect(data.selectedGallery).toEqual(initialRecapData.gallery);
  expect(data.galleryItems).toEqual(initialRecapData.items);
  expect(data.participants).toEqual(initialRecapData.participants);
  expect(useGalleryActions.mock.results.at(-1).value.fetchParticipants).not.toHaveBeenCalled();
  fireEvent.click(distribute);
  fireEvent.click(screen.getByRole('button', { name: 'AI Tag' }));
  fireEvent.click(screen.getByRole('button', { name: 'Manual Tag' }));
  Object.values(mockActions).forEach(action => expect(action).toHaveBeenCalledTimes(1));
  const toggle = screen.getByRole('button', { name: /^Session Gallery/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button', { name: 'Distribute All to Lockers' })).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Distribute All to Lockers' })).toBeInTheDocument();
  expect(apiClient.post).not.toHaveBeenCalled();
});

test('ordinary Gallery Hub retains its default empty selection and watermark-preview behavior', async () => {
  render(<GalleryPage />);
  expect(await screen.findByRole('heading', { name: 'Gallery Hub' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Distribute All to Lockers' })).not.toBeInTheDocument();
  expect(useGalleryActions.mock.calls.at(-1)[0].selectedGallery).toBeNull();
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/gallery/generate-watermark-preview', expect.any(Object)));
});
