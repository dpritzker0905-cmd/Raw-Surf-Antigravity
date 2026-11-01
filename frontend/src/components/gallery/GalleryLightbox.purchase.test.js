import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import apiClient from '../../lib/apiClient';
import useSurferGalleryActions from '../../hooks/useSurferGalleryActions';
import { GalleryLightbox } from './GalleryLightbox';

jest.mock('../../lib/apiClient', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../../utils/logger', () => ({ error: jest.fn(), debug: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

// Audit 2026-10-18 F-10: the lightbox played "Unlocked!" whether or not the purchase went through.
const item = { id: 'asset-fixture', media_type: 'photo', url: '/p.jpg', price: 7, is_paid: false };

function lightbox(onPurchase) {
  render(<GalleryLightbox item={item} items={[item]} onClose={jest.fn()} onPurchase={onPurchase} />);
}

test('a refused purchase does not play "Unlocked!" and keeps the lock overlay', async () => {
  const onPurchase = jest.fn().mockResolvedValue(false);
  lightbox(onPurchase);
  await act(async () => { fireEvent.click(screen.getByText(/Buy for/)); });
  expect(onPurchase).toHaveBeenCalledWith('asset-fixture', 'high');
  expect(screen.queryByText('Unlocked!')).toBeNull();
  expect(screen.getByText('Unlock Full Resolution')).toBeTruthy();
});

test('a completed purchase plays "Unlocked!"', async () => {
  const onPurchase = jest.fn().mockResolvedValue(true);
  lightbox(onPurchase);
  await act(async () => { fireEvent.click(screen.getByText(/Buy for/)); });
  expect(screen.getByText('Unlocked!')).toBeTruthy();
});

describe('handleSinglePurchase reports whether the purchase went through', () => {
  const setup = () => renderHook(() => useSurferGalleryActions({
    user: { id: 'buyer-fixture' }, galleryItems: [], selectedItems: [], filteredItems: [],
    setLoading: jest.fn(), setGalleryItems: jest.fn(), setClaimQueue: jest.fn(), setStats: jest.fn(),
    setPendingSelections: jest.fn(), setAiSessions: jest.fn(), setDownloadModal: jest.fn(),
    setSelectedItems: jest.fn(), setMultiSelectMode: jest.fn(), setShowVisibilityOnboarding: jest.fn(),
  }));

  beforeEach(() => { jest.clearAllMocks(); apiClient.get.mockResolvedValue({ data: [] }); });

  test('true on a 2xx', async () => {
    apiClient.post.mockResolvedValue({ data: { success: true } });
    const { result } = setup();
    let outcome;
    await act(async () => { outcome = await result.current.handleSinglePurchase('asset-fixture', 'high'); });
    expect(outcome).toBe(true);
  });

  test('false when the server refuses it', async () => {
    apiClient.post.mockRejectedValue({ response: { status: 400, data: { detail: 'Insufficient credits' } } });
    const { result } = setup();
    let outcome;
    await act(async () => { outcome = await result.current.handleSinglePurchase('asset-fixture', 'high'); });
    expect(outcome).toBe(false);
  });
});
