import { useState } from 'react';

export var useRequestProState = () => {
  const [showRequestProModal, setShowRequestProModal] = useState(false);
  const [requestProLoading, setRequestProLoading] = useState(false);
  const [estimatedDuration, setEstimatedDuration] = useState(1);
  const [inviteFriends, setInviteFriends] = useState(false);
  const [pendingRequestPro, setPendingRequestPro] = useState(false);
  const [requestProLocationLoading, setRequestProLocationLoading] = useState(false);
  const [showRequestProSelfieModal, setShowRequestProSelfieModal] = useState(false);
  const [boostHours, setBoostHours] = useState(0);
  const [onDemandPhotographers, setOnDemandPhotographers] = useState([]);
  const [requestProSelectedPro, setRequestProSelectedPro] = useState(null);
  const [onDemandLoading, setOnDemandLoading] = useState(false);
  
  // Friend invite state for split sessions
  const [friendsList, setFriendsList] = useState([]);
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [showFriendPicker, setShowFriendPicker] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');

  return {
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
    showFriendPicker, setShowFriendPicker,
    friendSearchQuery, setFriendSearchQuery,
  };
};
