import { useCallback, useMemo } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';
import { toast } from 'sonner';
import { isGrom } from '../constants/roles';

/**
 * usePublicGalleryActions — Extracted handler logic from PublicPhotographerGallery.js
 * Handles: data fetching, purchasing, AI face match, swipe navigation, filtering/sorting
 */
export default function usePublicGalleryActions({
  photographerId,
  user,
  galleries,
  setGalleries,
  items,
  setItems,
  setLoading,
  selectedGallery,
  setSelectedGallery,
  setPhotographer,
  setPurchasedIds,
  purchasedIds,
  selectedItem,
  setSelectedItem,
  serviceFilter,
  searchQuery,
  sortBy,
  setShowPurchaseModal,
  setPurchaseLoading,
  selectedQuality,
  setAIMatchLoading,
  setAIMatchResults,
  setShowAIMatch,
  setGalleriesReady,
  galleryContentRef,
  isAnimating,
  setIsAnimating,
}) {
  // Fetch photographer profile
  const fetchPhotographer = useCallback(async () => {
    if (!photographerId) return;

    try {
      const res = await apiClient.get(`/profiles/${photographerId}`);
      setPhotographer(res.data);
    } catch (error) {
      logger.error('Failed to fetch photographer:', error);
      toast.error('Photographer not found');
    }
  }, [photographerId, setPhotographer]);

  // Fetch photographer's galleries (albums)
  const fetchGalleries = useCallback(async () => {
    if (!photographerId) return;

    try {
      const res = await apiClient.get(`/galleries/photographer/${photographerId}`);
      // Only show public galleries, and exclude private sessions (on_demand/booking)
      const PRIVATE_SESSION_TYPES = ['on_demand', 'booking'];
      setGalleries(res.data.filter(g => g.is_public && !PRIVATE_SESSION_TYPES.includes(g.session_type)));
      setGalleriesReady(true);
    } catch (error) {
      logger.error('Failed to fetch galleries:', error);
      setGalleriesReady(true); // Mark ready even on error so UI doesn't hang
    }
  }, [photographerId, setGalleries, setGalleriesReady]);

  // Fetch gallery items
  const fetchItems = useCallback(async () => {
    if (!photographerId) return;

    try {
      setLoading(true);
      let url = `/gallery/photographer/${photographerId}?include_in_folders=true&limit=100`;
      if (user?.id) {
        url += `&viewer_id=${user.id}`;
      }

      const res = await apiClient.get(url);
      setItems(res.data);

      // Track purchased items
      if (user?.id) {
        const purchased = new Set(res.data.filter(i => i.is_purchased).map(i => i.id));
        setPurchasedIds(purchased);
      }
    } catch (error) {
      logger.error('Failed to fetch gallery items:', error);
    } finally {
      setLoading(false);
    }
  }, [photographerId, user?.id, setItems, setLoading, setPurchasedIds]);

  // AI Face Match - Find photos of the current user
  const runAIFaceMatch = useCallback(async () => {
    if (!user?.id || !photographerId) {
      toast.error('Please log in to find your photos');
      return;
    }

    setAIMatchLoading(true);
    try {
      const res = await apiClient.post(`/ai/face-match`, {
        photographer_id: photographerId,
        surfer_id: user.id
      });
      setAIMatchResults(res.data.matches || []);
      setShowAIMatch(true);

      if (res.data.matches?.length > 0) {
        toast.success(`Found ${res.data.matches.length} photos that might be you!`);
      } else {
        toast.info('No matching photos found yet. Check back after your session!');
      }
    } catch (error) {
      logger.error('AI face match failed:', error);
      toast.error('Face matching unavailable');
    } finally {
      setAIMatchLoading(false);
    }
  }, [user?.id, photographerId, setAIMatchLoading, setAIMatchResults, setShowAIMatch]);

  // Purchase item
  const handlePurchase = useCallback(async () => {
    if (!user?.id || !selectedItem) {
      toast.error('Please log in to purchase');
      return;
    }
    if (isGrom(user)) {
      toast.info('\u{1F468}\u200D\u{1F467} Ask your parent to approve this purchase!');
      return;
    }

    setPurchaseLoading(true);
    try {
      const _res = await apiClient.post(`/gallery/${selectedItem.id}/purchase`, {
        buyer_id: user.id,
        quality_tier: selectedQuality
      });

      toast.success('Purchase successful!');
      setPurchasedIds(prev => new Set([...prev, selectedItem.id]));
      setShowPurchaseModal(false);
      setSelectedItem(null);

      // Refresh items to get download URL
      fetchItems();
    } catch (error) {
      logger.error('Purchase failed:', error);
      toast.error(error.response?.data?.detail || 'Purchase failed');
    } finally {
      setPurchaseLoading(false);
    }
  }, [user, selectedItem, selectedQuality, setPurchaseLoading, setPurchasedIds, setShowPurchaseModal, setSelectedItem, fetchItems]);

  // Filter and sort items
  const filteredItems = useMemo(() => {
    return items
      .filter(item => {
        // Service type filter
        if (serviceFilter !== 'all') {
          // This would require service_type on items - for now, show all
        }

        // Gallery filter
        if (selectedGallery && item.gallery_id !== selectedGallery.id) {
          return false;
        }

        // Search filter
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          return (
            item.title?.toLowerCase().includes(query) ||
            item.description?.toLowerCase().includes(query) ||
            item.spot_name?.toLowerCase().includes(query) ||
            item.tags?.some(t => t.toLowerCase().includes(query))
          );
        }

        return true;
      })
      .sort((a, b) => {
        switch (sortBy) {
          case 'newest':
            return new Date(b.created_at) - new Date(a.created_at);
          case 'oldest':
            return new Date(a.created_at) - new Date(b.created_at);
          case 'price_low':
            return (a.custom_price || a.price) - (b.custom_price || b.price);
          case 'price_high':
            return (b.custom_price || b.price) - (a.custom_price || a.price);
          case 'popular':
            return b.purchase_count - a.purchase_count;
          default:
            return 0;
        }
      });
  }, [items, serviceFilter, selectedGallery, searchQuery, sortBy]);

  // Swipe handler: navigate between gallery folders
  const handleSwipeGallery = useCallback((direction) => {
    if (!selectedGallery || galleries.length <= 1) return;
    const currentIdx = galleries.findIndex(g => g.id === selectedGallery.id);
    const nextIdx = direction === 'left' ? currentIdx + 1 : currentIdx - 1;
    if (nextIdx >= 0 && nextIdx < galleries.length) {
      setIsAnimating(true);
      if (galleryContentRef.current) {
        galleryContentRef.current.style.transition = 'transform 0.22s ease-out, opacity 0.22s ease-out';
        galleryContentRef.current.style.transform = `translateX(${direction === 'left' ? '-100%' : '100%'})`;
        galleryContentRef.current.style.opacity = '0';
      }
      setTimeout(() => {
        setSelectedGallery(galleries[nextIdx]);
        if (galleryContentRef.current) {
          galleryContentRef.current.style.transition = 'none';
          galleryContentRef.current.style.transform = `translateX(${direction === 'left' ? '60%' : '-60%'})`;
          galleryContentRef.current.style.opacity = '0.5';
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (galleryContentRef.current) {
              galleryContentRef.current.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out';
              galleryContentRef.current.style.transform = 'translateX(0)';
              galleryContentRef.current.style.opacity = '1';
            }
            setTimeout(() => {
              setIsAnimating(false);
              if (galleryContentRef.current) {
                galleryContentRef.current.style.transition = '';
                galleryContentRef.current.style.transform = '';
                galleryContentRef.current.style.opacity = '';
              }
            }, 260);
          });
        });
      }, 200);
    }
  }, [selectedGallery, galleries, setSelectedGallery, setIsAnimating, galleryContentRef]);

  // Get price for quality tier
  const getQualityPrice = useCallback((item, quality) => {
    if (!item) return 5; // Default price if item is null

    if (item.media_type === 'video') {
      switch (quality) {
        case '720p': return item.price_720p || item.price || 10;
        case '1080p': return item.price_1080p || (item.price || 10) * 1.5;
        case '4k': return item.price_4k || (item.price || 10) * 2;
        default: return item.price || 10;
      }
    } else {
      switch (quality) {
        case 'web': return item.price_web || (item.price || 5) * 0.5;
        case 'standard': return item.custom_price || item.price || 5;
        case 'high': return item.price_high || (item.price || 5) * 2;
        default: return item.custom_price || item.price || 5;
      }
    }
  }, []);

  return {
    fetchPhotographer,
    fetchGalleries,
    fetchItems,
    runAIFaceMatch,
    handlePurchase,
    filteredItems,
    handleSwipeGallery,
    getQualityPrice,
  };
}
