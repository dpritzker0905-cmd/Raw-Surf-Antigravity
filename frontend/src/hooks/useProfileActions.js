/**
 * useProfileActions.js - Extracted from Profile.js
 * Profile data, social stats, gamification, avatar upload.
 * 13 pure handlers.
 */
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

const useProfileActions = ({
  user, navigate,
  profileUserId,
  profile,
  editData,
  updateUser,
  fileInputRef,
  isFollowing,
  isOwnProfile,
  socialStats,
  streak,
  setAvatarUploading,
  setContentStats,
  setCropFile,
  setEditData,
  setEditLoading,
  setFollowLoading,
  setGamificationStats,
  setImpactScore,
  setIsFollowing,
  setLoading,
  setProfile,
  setShowEditModal,
  setShowGoLiveModal,
  setSocialStats,
  setStreak,
  setTabContent,
  setTabLoading,
}) => {

  const fetchProfile = async () => {
    if (!profileUserId) {
      setLoading(false);
      return;
    }
    
    try {
      const response = await apiClient.get(`/profiles/${profileUserId}`);
      setProfile(response.data);
      if (isOwnProfile && user) {
        setEditData({
          full_name: response.data.full_name || '',
          bio: response.data.bio || '',
          location: response.data.location || '',
          instagram_url: response.data.instagram_url || '',
          website_url: response.data.website_url || '',
          stance: response.data.stance || '',
          wetsuit_color: response.data.wetsuit_color || '',
          rash_guard_color: response.data.rash_guard_color || ''
        });
      }
    } catch (error) {
      logger.error('Failed to load profile:', error);
      // Only show error toast, don't redirect - let user stay on page
      if (error.response?.status === 404) {
        toast.error('User not found');
        navigate('/explore');
      } else {
        toast.error('Failed to load profile');
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchStreak = async () => {
    try {
      const response = await apiClient.get(`/streak/${profileUserId}`);
      setStreak(response.data);
    } catch (error) {
      logger.error('Error fetching streak:', error);
    }
  };

  const fetchSocialStats = async () => {
    try {
      const [followersRes, followingRes] = await Promise.all([
        apiClient.get(`/followers/${profileUserId}`).catch(() => ({ data: [] })),
        apiClient.get(`/following/${profileUserId}`).catch(() => ({ data: [] }))
      ]);
      setSocialStats({
        followers: followersRes.data?.length || 0,
        following: followingRes.data?.length || 0
      });
    } catch (error) {
      logger.error('Error fetching social stats:', error);
    }
  };

  const fetchContentStats = async () => {
    try {
      const response = await apiClient.get(`/profile/${profileUserId}/stats`);
      setContentStats(response.data);
    } catch (error) {
      logger.error('Error fetching content stats:', error);
    }
  };

  const fetchImpactScore = async () => {
    try {
      const response = await apiClient.get(`/impact/public/${profileUserId}`);
      setImpactScore(response.data);
    } catch (error) {
      logger.error('Error fetching impact score:', error);
    }
  };

  const fetchGamificationStats = async () => {
    try {
      const response = await apiClient.get(`/gamification/user/${profileUserId}`);
      setGamificationStats(response.data);
    } catch (error) {
      logger.error('Error fetching gamification stats:', error);
    }
  };

  const handleFollow = async () => {
    if (!user?.id) {
      toast.error('Please log in to follow users');
      return;
    }
    
    // Capture previous state for rollback
    const wasFollowing = isFollowing;
    const prevFollowers = socialStats.followers;
    
    // Optimistic update - instant UI
    setIsFollowing(!wasFollowing);
    setSocialStats(prev => ({
      ...prev,
      followers: wasFollowing ? Math.max(0, prev.followers - 1) : prev.followers + 1
    }));
    setFollowLoading(true);
    
    try {
      if (wasFollowing) {
        await apiClient.delete(`/follow/${profileUserId}?follower_id=${user.id}`);
        toast.success(`Unfollowed ${profile.full_name}`);
      } else {
        await apiClient.post(`/follow/${profileUserId}?follower_id=${user.id}`);
        toast.success(`Following ${profile.full_name}`);
      }
    } catch (error) {
      // Rollback on failure
      setIsFollowing(wasFollowing);
      setSocialStats(prev => ({ ...prev, followers: prevFollowers }));
      toast.error(error.response?.data?.detail || 'Failed to update follow status');
    } finally {
      setFollowLoading(false);
    }
  };

  const fetchTabContent = async (tab) => {
    setTabLoading(true);
    try {
      let endpoint = '';
      const qs = user?.id ? `?viewer_id=${user.id}` : '';
      switch (tab) {
        case 'posts':
          endpoint = `/profile/${profileUserId}/posts${qs}`;
          break;
        case 'photos':
          endpoint = `/profile/${profileUserId}/photos${qs}`;
          break;
        case 'session_shots':
          endpoint = `/profile/${profileUserId}/session-shots${qs}`;
          break;
        case 'videos':
          endpoint = `/profile/${profileUserId}/videos${qs}`;
          break;
        case 'saved':
          // Only show saved tab for own profile
          if (!isOwnProfile) {
            setTabContent([]);
            setTabLoading(false);
            return;
          }
          endpoint = `/profile/${profileUserId}/saved${qs}`;
          break;
        case 'tagged':
          endpoint = `/profile/${profileUserId}/tagged${qs}`;
          break;
        default:
          endpoint = `/profile/${profileUserId}/posts${qs}`;
      }
      const response = await apiClient.get(endpoint);
      // Handle both array and object responses (tagged returns {items, new_count})
      // Use the `tab` parameter (not activeTab state) to avoid stale closure issues
      if (tab === 'tagged' && response.data?.items) {
        setTabContent(response.data.items);
      } else {
        setTabContent(response.data);
      }
    } catch (error) {
      logger.error('Error fetching tab content:', error);
      setTabContent([]);
    } finally {
      setTabLoading(false);
    }
  };

  const toggleLive = async () => {
    if (!profile) return; // Guard against null profile
    if (!profile.is_live) {
      // Open the Go Live modal with camera
      setShowGoLiveModal(true);
    } else {
      // End live broadcast
      try {
        const activeStreams = await apiClient.get(`/social-live/active`);
        const myStream = activeStreams.data.streams?.find(s => s.broadcaster_id === user.id);
        if (myStream) {
          await apiClient.post(`/social-live/${myStream.id}/end?broadcaster_id=${user.id}`);
        }
        setProfile({ ...profile, is_live: false });
        toast.success('Live broadcast ended');
      } catch (error) {
        logger.error('End live error:', error);
        // Fallback: update profile directly
        try {
          await apiClient.patch(`/profiles/${user.id}`, { is_live: false });
          setProfile({ ...profile, is_live: false });
          toast.success('Live broadcast ended');
        } catch (e) {
          toast.error('Failed to end live broadcast');
        }
      }
    }
  };

  const handleGoLiveEnded = () => {
    if (!profile) return; // Guard against null profile
    setProfile({ ...profile, is_live: false });
  };

  const handleSaveProfile = async () => {
    setEditLoading(true);
    try {
      const response = await apiClient.patch(`/profiles/${user.id}`, editData);
      setProfile(response.data);
      updateUser({ ...user, full_name: response.data.full_name });
      setShowEditModal(false);
      toast.success('Profile updated!');
    } catch (error) {
      toast.error('Failed to update profile');
    } finally {
      setEditLoading(false);
    }
  };

  const handleAvatarUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Open the crop modal instead of uploading directly
    setCropFile(file);
    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCropConfirm = async (croppedBase64) => {
    setCropFile(null);
    setAvatarUploading(true);

    try {
      const response = await apiClient.patch(`/profiles/${user.id}`, {
        avatar_url: croppedBase64
      });
      setProfile(response.data);
      updateUser({
        avatar_url: response.data.avatar_url,
        updated_at: new Date().toISOString()
      });
      toast.success('Avatar updated!');
    } catch (patchError) {
      toast.error('Failed to upload avatar');
      logger.error(patchError);
    } finally {
      setAvatarUploading(false);
    }
  };


  return {
    fetchProfile,
    fetchStreak,
    fetchSocialStats,
    fetchContentStats,
    fetchImpactScore,
    fetchGamificationStats,
    handleFollow,
    fetchTabContent,
    toggleLive,
    handleGoLiveEnded,
    handleSaveProfile,
    handleAvatarUpload,
    handleCropConfirm,
  };
};

export default useProfileActions;