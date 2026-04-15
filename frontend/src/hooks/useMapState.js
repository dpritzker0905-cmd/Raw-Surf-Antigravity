/**
 * useMapState Hook
 * Manages map-related UI state (selection, drawers, modals)
 * Extracted from MapPage.js for better organization
 */

import { useState, useCallback } from 'react';

export const useMapState = () => {
  // Selection state
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [selectedPhotographer, setSelectedPhotographer] = useState(null);
  
  // Bottom sheet / drawer state
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const [showSpotDrawer, setShowSpotDrawer] = useState(false);
  const [unifiedDrawerOpen, setUnifiedDrawerOpen] = useState(false);
  const [showFeaturedPanel, setShowFeaturedPanel] = useState(false);
  
  // Filter state
  const [filter, setFilter] = useState('all'); // all, spots, photographers
  
  // Modal states
  const [showJumpInModal, setShowJumpInModal] = useState(false);
  const [showGPSGuide, setShowGPSGuide] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showConditionsModal, setShowConditionsModal] = useState(false);
  const [showEndSessionModal, setShowEndSessionModal] = useState(false);
  
  // Banner state
  const [showIpBanner, setShowIpBanner] = useState(true);
  
  // Active shooters at selected spot
  const [activeShootersAtSpot, setActiveShootersAtSpot] = useState([]);
  
  // Pulsing markers for visual feedback
  const [pulsingMarkers, setPulsingMarkers] = useState(new Set());

  /**
   * Handle filter change
   */
  const handleFilterChange = useCallback((newFilter) => {
    setFilter(newFilter);
  }, []);

  /**
   * Close unified drawer
   */
  const handleCloseUnifiedDrawer = useCallback(() => {
    setUnifiedDrawerOpen(false);
    setSelectedSpot(null);
  }, []);

  /**
   * Select and show spot
   */
  const selectSpot = useCallback((spot) => {
    setSelectedSpot(spot);
    setShowSpotDrawer(true);
  }, []);

  /**
   * Select and show photographer
   */
  const selectPhotographer = useCallback((photographer) => {
    setSelectedPhotographer(photographer);
    // Additional logic can be added here
  }, []);

  /**
   * Reset all selections
   */
  const resetSelections = useCallback(() => {
    setSelectedSpot(null);
    setSelectedPhotographer(null);
    setShowSpotDrawer(false);
    setUnifiedDrawerOpen(false);
    setShowFeaturedPanel(false);
  }, []);

  /**
   * Add pulsing effect to marker
   */
  const addPulsingMarker = useCallback((markerId) => {
    setPulsingMarkers(prev => new Set([...prev, markerId]));
  }, []);

  /**
   * Remove pulsing effect from marker
   */
  const removePulsingMarker = useCallback((markerId) => {
    setPulsingMarkers(prev => {
      const newSet = new Set(prev);
      newSet.delete(markerId);
      return newSet;
    });
  }, []);

  return {
    // Selection state
    selectedSpot,
    setSelectedSpot,
    selectedPhotographer,
    setSelectedPhotographer,
    
    // Drawer/sheet state
    bottomSheetOpen,
    setBottomSheetOpen,
    showSpotDrawer,
    setShowSpotDrawer,
    unifiedDrawerOpen,
    setUnifiedDrawerOpen,
    showFeaturedPanel,
    setShowFeaturedPanel,
    
    // Filter
    filter,
    setFilter,
    handleFilterChange,
    
    // Modals
    showJumpInModal,
    setShowJumpInModal,
    showGPSGuide,
    setShowGPSGuide,
    showLocationPicker,
    setShowLocationPicker,
    showConditionsModal,
    setShowConditionsModal,
    showEndSessionModal,
    setShowEndSessionModal,
    
    // Banner
    showIpBanner,
    setShowIpBanner,
    
    // Spot-related
    activeShootersAtSpot,
    setActiveShootersAtSpot,
    
    // Visual effects
    pulsingMarkers,
    setPulsingMarkers,
    addPulsingMarker,
    removePulsingMarker,
    
    // Actions
    handleCloseUnifiedDrawer,
    selectSpot,
    selectPhotographer,
    resetSelections
  };
};

export default useMapState;
