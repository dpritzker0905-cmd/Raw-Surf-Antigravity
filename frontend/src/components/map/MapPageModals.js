/**
 * MapPageModals — Extracted from MapPage.js (v83)
 * Consolidates overlay modals/drawers rendered on the map page.
 */
import React from 'react';
import { JumpInSessionModal } from '../JumpInSessionModal';
import { RequestProSelfieModal } from '../RequestProSelfieModal';
import { RequestProModal } from './RequestProModal';
import EndSessionModal from '../EndSessionModal';
import ConditionsModal from '../ConditionsModal';
import { PermissionNudgeDrawer } from '../PermissionNudgeDrawer';
import { GPSSettingsGuide } from '../GPSSettingsGuide';
import { LocationPicker } from '../LocationPicker';
import { isValidLatLng } from './mapUtils';
import { toast } from 'sonner';

const MapPageModals = ({
  // JumpIn
  showJumpInModal, setShowJumpInModal, selectedPhotographer,
  setBottomSheetOpen,
  // RequestPro
  showRequestProModal, setShowRequestProModal, user, userLocation, nearestSpot,
  onDemandPhotographers, onDemandLoading, friendsList, friendsLoading,
  setRequestProSelectedPro, setSelectedFriends, setFriendSearchQuery, setShowFriendPicker,
  setActiveDispatchId, setShowRequestProSelfieModal,
  // RequestProSelfie
  showRequestProSelfieModal: showSelfie, activeDispatchId,
  // EndSession
  showEndSessionModal, closeEndSessionModal, handleEndSessionConfirmed, currentLiveSession, endSessionLoading,
  // Conditions
  showConditionsModal, closeConditionsModal, handleConditionsConfirm, goLiveSpotId, surfSpots, goLiveLoading,
  // Permission
  showPermissionNudge, setShowPermissionNudge, getUserLocation, permissionNudgeAction,
  // GPS Guide
  showGPSGuide, setShowGPSGuide, gpsLoading, setShowLocationPicker,
  // LocationPicker
  showLocationPicker, setUserLocation, mapInstanceRef,
}) => (
  <>
    {showJumpInModal && selectedPhotographer && (
      <JumpInSessionModal
        photographer={selectedPhotographer}
        onClose={() => setShowJumpInModal(false)}
        onSuccess={(_data) => {
          setShowJumpInModal(false);
          setBottomSheetOpen(false);
          toast.success(`Joined ${selectedPhotographer.full_name}'s session!`);
        }}
      />
    )}

    <RequestProModal
      isOpen={showRequestProModal}
      onClose={() => {
        setShowRequestProModal(false);
        setRequestProSelectedPro(null);
        setSelectedFriends([]);
        setFriendSearchQuery('');
        setShowFriendPicker(false);
      }}
      userId={user?.id}
      user={user}
      userLocation={userLocation}
      nearestSpot={nearestSpot}
      onDemandPhotographers={onDemandPhotographers}
      onDemandLoading={onDemandLoading}
      friendsList={friendsList}
      friendsLoading={friendsLoading}
      onSuccess={(dispatchId) => {
        setActiveDispatchId(dispatchId);
        setTimeout(() => setShowRequestProSelfieModal(true), 1500);
      }}
    />

    <RequestProSelfieModal
      dispatchId={activeDispatchId}
      isOpen={showSelfie}
      onClose={() => setShowRequestProSelfieModal(false)}
      onSuccess={(_selfieUrl) => {
        toast.success('Great! Your Pro will be able to spot you easily.');
      }}
    />

    <EndSessionModal
      isOpen={showEndSessionModal}
      onClose={closeEndSessionModal}
      onConfirm={handleEndSessionConfirmed}
      session={currentLiveSession}
      isLoading={endSessionLoading}
    />

    <ConditionsModal
      isOpen={showConditionsModal}
      onClose={closeConditionsModal}
      onConfirm={handleConditionsConfirm}
      spotName={(surfSpots || []).find(s => s.id === goLiveSpotId)?.name || 'Selected Spot'}
      isLoading={goLiveLoading}
    />

    <PermissionNudgeDrawer
      isOpen={showPermissionNudge}
      onClose={() => setShowPermissionNudge(false)}
      onRetryLocation={getUserLocation}
      action={permissionNudgeAction}
    />

    <GPSSettingsGuide
      isOpen={showGPSGuide}
      onClose={() => setShowGPSGuide(false)}
      onRetryLocation={getUserLocation}
      onManualLocation={() => setShowLocationPicker(true)}
      currentAccuracy={userLocation?.accuracy}
      isLoading={gpsLoading}
    />

    <LocationPicker
      isOpen={showLocationPicker}
      onClose={() => setShowLocationPicker(false)}
      onLocationSelected={(location) => {
        if (location && isValidLatLng(location.lat, location.lng)) {
          setUserLocation(location);
          if (mapInstanceRef.current) {
            mapInstanceRef.current.setView([location.lat, location.lng], 12);
          }
          toast.success('Location set manually!');
        } else {
          toast.error('Invalid location selected');
        }
      }}
      currentLocation={userLocation}
      currentAccuracy={userLocation?.accuracy}
      surfSpots={surfSpots}
    />
  </>
);

export default MapPageModals;
