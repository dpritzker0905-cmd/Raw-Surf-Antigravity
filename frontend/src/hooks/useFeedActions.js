/**
 * useFeedActions.js — Orchestrator Hook (v77 decomposition)
 * 
 * Composes three domain-specific sub-hooks:
 *   - useFeedDataActions    (posts, pagination, follow, lineups, live)
 *   - useFeedReactionActions (likes, reactions, comments, save, collaboration)
 *   - useFeedCheckInActions  (check-in, GPS, streak, passport)
 *
 * This file is the single entry point consumed by Feed.js.
 * Each sub-hook receives only the state it needs.
 */
import useFeedDataActions from './feed/useFeedDataActions';
import useFeedReactionActions from './feed/useFeedReactionActions';
import useFeedCheckInActions from './feed/useFeedCheckInActions';

var useFeedActions = ({
  user, navigate, activeTab, selectedCountry, selectedState, selectedCity, posts,
  latestPostIdRef,
  isPhotographer,
  spots,
  showReactionPicker,
  commentInputs,
  postModalOpen,
  postMenuOpen,
  showAllComments,
  nearestSpot,
  checkInData,
  loadingComments,
  streak,
  // State setters
  setAllComments,
  setCheckInData,
  setCheckInLoading,
  setCheckInReward,
  setCollaborationLoading,
  setCommentInputs,
  setConnectingToStream,
  setFeedLastUpdated,
  setFeedLineups,
  setFeedLineupsLoading,
  setFollowLoading,
  setFollowingUsers,
  setGpsLoading,
  setIsRefreshing,
  setLiveStreamInfo,
  setLiveUsers,
  setLoading,
  setLoadingComments,
  setLocationHierarchy,
  setNearestSpot,
  setNewPostsChip,
  setPickerAnchor,
  setPostMenuOpen,
  setPostModalOpen,
  setPosts,
  setPressingPostId,
  setSelectedCity,
  setSelectedCountry,
  setSelectedState,
  setShowAllComments,
  setShowCheckInModal,
  setShowCollaboratorsModal,
  setShowLiveViewer,
  setShowReactionPicker,
  setSpots,
  setStreak,
  setUpcomingSessions,
  setUpcomingSessionsLoading,
}) => {

  // --- Data layer: posts, pagination, follow, lineups, live streams ---
  const dataActions = useFeedDataActions({
    user, posts, latestPostIdRef, isPhotographer,
    postModalOpen, postMenuOpen,
    setConnectingToStream, setFeedLastUpdated, setFeedLineups,
    setFeedLineupsLoading, setFollowLoading, setFollowingUsers,
    setIsRefreshing, setLiveStreamInfo, setLiveUsers,
    setLoading, setNewPostsChip, setPostMenuOpen, setPostModalOpen,
    setPosts, setShowLiveViewer, setUpcomingSessions,
    setUpcomingSessionsLoading,
  });

  // --- Reaction layer: likes, emoji, comments, save, collaboration ---
  const reactionActions = useFeedReactionActions({
    user, posts,
    showReactionPicker, commentInputs, showAllComments, loadingComments,
    setAllComments, setCommentInputs, setLoadingComments,
    setPosts, setPressingPostId, setPickerAnchor,
    setShowAllComments, setShowReactionPicker, setCollaborationLoading,
    setShowCollaboratorsModal,
  });

  // --- Check-in layer: GPS, streak, passport, spot discovery ---
  const checkInActions = useFeedCheckInActions({
    user, spots, nearestSpot, checkInData, streak,
    setCheckInData, setCheckInLoading, setCheckInReward,
    setGpsLoading, setLocationHierarchy, setNearestSpot,
    setSelectedCity, setSelectedCountry, setSelectedState,
    setShowCheckInModal, setSpots, setStreak,
  });

  return {
    // Data actions
    handleFeedRefresh: dataActions.handleFeedRefresh,
    handleLoadNewPosts: dataActions.handleLoadNewPosts,
    fetchFeedLineups: dataActions.fetchFeedLineups,
    fetchUpcomingSessions: dataActions.fetchUpcomingSessions,
    fetchLiveUsers: dataActions.fetchLiveUsers,
    fetchFollowing: dataActions.fetchFollowing,
    handleFollowFromFeed: dataActions.handleFollowFromFeed,
    handleUnfollowFromMenu: dataActions.handleUnfollowFromMenu,
    handlePostUpdated: dataActions.handlePostUpdated,
    handlePostDeleted: dataActions.handlePostDeleted,
    handleJoinLive: dataActions.handleJoinLive,
    fetchPosts: dataActions.fetchPosts,
    loadMorePosts: dataActions.loadMorePosts,
    feedHasMoreRef: dataActions.feedHasMoreRef,
    loadingMoreRef: dataActions.loadingMoreRef,
    // Reaction actions
    handleLike: reactionActions.handleLike,
    handleShakaTapToggle: reactionActions.handleShakaTapToggle,
    handleShakaPointerDown: reactionActions.handleShakaPointerDown,
    handleShakaPointerUp: reactionActions.handleShakaPointerUp,
    handleShakaPointerLeave: reactionActions.handleShakaPointerLeave,
    handleShakaClick: reactionActions.handleShakaClick,
    handleReaction: reactionActions.handleReaction,
    handleSavePost: reactionActions.handleSavePost,
    handleCommentSubmit: reactionActions.handleCommentSubmit,
    loadAllComments: reactionActions.loadAllComments,
    hideAllComments: reactionActions.hideAllComments,
    handleIWasThere: reactionActions.handleIWasThere,
    handleViewCollaborators: reactionActions.handleViewCollaborators,
    // Check-in actions
    fetchStreak: checkInActions.fetchStreak,
    fetchSpots: checkInActions.fetchSpots,
    fetchLocationHierarchy: checkInActions.fetchLocationHierarchy,
    calculateDistance: checkInActions.calculateDistance,
    getGpsLocation: checkInActions.getGpsLocation,
    handleCheckIn: checkInActions.handleCheckIn,
    submitCheckIn: checkInActions.submitCheckIn,
    closeCheckInModal: checkInActions.closeCheckInModal,
  };
};

export default useFeedActions;
