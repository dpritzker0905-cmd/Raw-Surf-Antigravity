import { useState, useRef, useMemo } from 'react';
import { useRequestProState } from './useRequestProState';
import { useFriendsOnMap } from './useFriendsOnMap';

/**
 * useMapPhotographerState — Extracted from MapPage.js to reduce LOC.
 * Manages photographer/booking-related state, request-pro modals,
 * friends-on-map, on-demand requests, permission nudges, and role derivation.
 */
export function useMapPhotographerState({ user, mapInstanceRef, getEffectiveRole }) {
  const {
    showRequestProModal, setShowRequestProModal,
    requestProLoading, setRequestProLoading,
    estimatedDuration, setEstimatedDuration,
    inviteFriends, setInviteFriends,
    pendingRequestPro, setPendingRequestPro,
    requestProLocationLoading, setRequestProLocationLoading,
    showRequestProSelfieModal, setShowRequestProSelfieModal,
    boostHours, setBoostHours,
    onDemandPhotographers, setOnDemandPhotographers,
    requestProSelectedPro, setRequestProSelectedPro,
    onDemandLoading, setOnDemandLoading,
    friendsList, setFriendsList,
    selectedFriends, setSelectedFriends,
    friendsLoading, setFriendsLoading,
    setShowFriendPicker,
    friendSearchQuery, setFriendSearchQuery,
  } = useRequestProState();

  const {
    friendsOnMap,
    showFriendsOnMap,
    setShowFriendsOnMap,
    friendMarkersRef,
    _fetchFriendsOnMap,
    _clearFriendMarkers,
  } = useFriendsOnMap({ user, mapInstanceRef });

  const [activeOnDemandRequests, setActiveOnDemandRequests] = useState([]);
  const onDemandMarkersRef = useRef([]);
  const [, setLockedShooterCount] = useState(null);

  const [trackingMarkersRef] = useState({ surfer: null, photographer: null, routeLine: null });
  const userMarkerRef = useRef(null);
  const userAccuracyCircleRef = useRef(null);
  const [showPermissionNudge, setShowPermissionNudge] = useState(false);
  const [permissionNudgeAction, setPermissionNudgeAction] = useState('booking');

  const effectiveRole = getEffectiveRole(user?.role);
  const isPhotographer = useMemo(() =>
    ['Hobbyist', 'Photographer', 'Approved Pro'].includes(effectiveRole),
    [effectiveRole]
  );

  return {
    // Request Pro State
    showRequestProModal, setShowRequestProModal,
    requestProLoading, setRequestProLoading,
    estimatedDuration, setEstimatedDuration,
    inviteFriends, setInviteFriends,
    pendingRequestPro, setPendingRequestPro,
    requestProLocationLoading, setRequestProLocationLoading,
    showRequestProSelfieModal, setShowRequestProSelfieModal,
    boostHours, setBoostHours,
    onDemandPhotographers, setOnDemandPhotographers,
    requestProSelectedPro, setRequestProSelectedPro,
    onDemandLoading, setOnDemandLoading,
    friendsList, setFriendsList,
    selectedFriends, setSelectedFriends,
    friendsLoading, setFriendsLoading,
    setShowFriendPicker,
    friendSearchQuery, setFriendSearchQuery,
    // Friends on Map
    friendsOnMap,
    showFriendsOnMap, setShowFriendsOnMap,
    friendMarkersRef,
    _fetchFriendsOnMap, _clearFriendMarkers,
    // On-Demand
    activeOnDemandRequests, setActiveOnDemandRequests,
    onDemandMarkersRef,
    setLockedShooterCount,
    // Tracking
    trackingMarkersRef,
    userMarkerRef,
    userAccuracyCircleRef,
    // Permissions
    showPermissionNudge, setShowPermissionNudge,
    permissionNudgeAction, setPermissionNudgeAction,
    // Role
    effectiveRole,
    isPhotographer,
  };
}

export default useMapPhotographerState;
