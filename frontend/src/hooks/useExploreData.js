/**
 * useExploreData.js
 * Extracted data fetching handlers from Explore.js
 * Covers: trending, hashtags, waves, posts, search, leaderboard/sponsors
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

const useExploreData = ({
  searchQuery, activeTab, recentSearches,
  // State setters
  setTrending, setLoading, setSpotConditions,
  setTrendingHashtags, setHashtagPosts, setHashtagLoading, setSelectedHashtag,
  setTrendingWaves, setRecentWaves, setWavesLoading,
  setSelectedWaveHashtag, setWaveHashtagResults,
  setExplorePosts, setPostsLoading,
  setSearchResults, setIsSearching, setRecentSearches,
  setLeaderboard, setLeaderboardLoading,
  setSponsorDetails, setSelectedSponsor,
}) => {
  const navigate = useNavigate();

  // Fetch batch conditions for popular spots
  const fetchSpotConditions = useCallback(async (spotIds) => {
    try {
      const activeModel = localStorage.getItem('rawsurf-active-model') || 'GFS';
      const response = await apiClient.get(`/conditions/batch?spot_ids=${spotIds}&model=${activeModel}`);
      const conditionsData = response.data.conditions || {};
      const conditionsMap = {};
      Object.entries(conditionsData).forEach(([spotId, data]) => {
        conditionsMap[spotId] = { spot_id: spotId, wave_height_ft: data.wave_height_ft, conditions_label: data.label, ...data };
      });
      setSpotConditions(conditionsMap);
    } catch (error) {
      logger.error('Error fetching conditions:', error);
    }
  }, [setSpotConditions]);

  // Fetch trending hashtags
  const fetchTrendingHashtags = useCallback(async () => {
    try {
      const response = await apiClient.get(`/hashtags/trending?limit=15&days=7`);
      setTrendingHashtags(response.data.hashtags || []);
    } catch (error) {
      logger.debug('Trending hashtags not available');
      setTrendingHashtags([]);
    }
  }, [setTrendingHashtags]);

  // Fetch trending data (main explore page)
  const fetchTrending = useCallback(async () => {
    try {
      const response = await apiClient.get(`/explore/trending`);
      setTrending(response.data);
      
      // Fetch conditions for popular spots
      if (response.data.popular_spots?.length > 0) {
        const spotIds = response.data.popular_spots.slice(0, 4).map(s => s.id).join(',');
        fetchSpotConditions(spotIds);
      }
      
      // Also fetch trending hashtags for the main explore page
      fetchTrendingHashtags();
    } catch (error) {
      logger.error('Error fetching trending:', error);
    } finally {
      setLoading(false);
    }
  }, [setTrending, setLoading, fetchSpotConditions, fetchTrendingHashtags]);

  // Fetch posts for a specific hashtag
  const fetchHashtagPosts = useCallback(async (tag) => {
    setHashtagLoading(true);
    try {
      const response = await apiClient.get(`/hashtags/${tag}/posts?limit=30`);
      setHashtagPosts(response.data.posts || []);
    } catch (error) {
      logger.error('Error fetching hashtag posts:', error);
      setHashtagPosts([]);
    } finally {
      setHashtagLoading(false);
    }
  }, [setHashtagPosts, setHashtagLoading]);

  // Handle hashtag click
  const handleHashtagClick = useCallback((tag) => {
    setSelectedHashtag(tag);
    fetchHashtagPosts(tag);
  }, [setSelectedHashtag, fetchHashtagPosts]);

  // Fetch Trending + Recent Waves for Explore
  const fetchTrendingWaves = useCallback(async () => {
    setWavesLoading(true);
    try {
      const response = await apiClient.get(`/waves/trending`, {
        params: { limit: 12, days: 7 }
      });
      setTrendingWaves(response.data.trending_waves || []);
      setRecentWaves(response.data.recent_waves || []);
    } catch (error) {
      logger.error('Error fetching trending waves:', error);
      setTrendingWaves([]);
      setRecentWaves([]);
    } finally {
      setWavesLoading(false);
    }
  }, [setTrendingWaves, setRecentWaves, setWavesLoading]);

  // Fetch Waves by hashtag (prefixed with _ as currently unused)
  const _fetchWavesByHashtag = useCallback(async (tag) => {
    setWavesLoading(true);
    setSelectedWaveHashtag(tag);
    try {
      const response = await apiClient.get(`/waves/hashtag/${tag}`, {
        params: { limit: 20 }
      });
      setWaveHashtagResults(response.data.waves || []);
    } catch (error) {
      logger.error('Error fetching waves by hashtag:', error);
      setWaveHashtagResults([]);
    } finally {
      setWavesLoading(false);
    }
  }, [setWavesLoading, setSelectedWaveHashtag, setWaveHashtagResults]);

  // Handle Wave click - navigate to Feed with Waves tab
  const handleWaveClick = useCallback((wave) => {
    navigate(`/feed?tab=waves&wave=${wave.id}`);
  }, [navigate]);

  // Fetch Explore Posts (photos/videos for Posts tab)
  const fetchExplorePosts = useCallback(async () => {
    setPostsLoading(true);
    try {
      const response = await apiClient.get(`/posts`, {
        params: { 
          limit: 24,
          content_type: 'post' // Exclude waves, only regular posts
        }
      });
      setExplorePosts(response.data.posts || response.data || []);
    } catch (error) {
      logger.error('Error fetching explore posts:', error);
      setExplorePosts([]);
    } finally {
      setPostsLoading(false);
    }
  }, [setExplorePosts, setPostsLoading]);

  // Handle post click - navigate to post detail
  const handlePostClick = useCallback((post) => {
    navigate(`/post/${post.id}`);
  }, [navigate]);

  // Search
  const performSearch = useCallback(async () => {
    setIsSearching(true);
    try {
      const response = await apiClient.get(`/explore/search`, {
        params: { q: searchQuery, type: activeTab }
      });
      setSearchResults(response.data);
      // Save to recent searches
      const query = searchQuery.trim();
      if (query.length >= 2) {
        const updated = [query, ...recentSearches.filter(s => s !== query)].slice(0, 5);
        setRecentSearches(updated);
        localStorage.setItem('rs-recent-searches', JSON.stringify(updated));
      }
    } catch (error) {
      logger.error('Error searching:', error);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, activeTab, recentSearches, setSearchResults, setIsSearching, setRecentSearches]);

  const clearSearch = useCallback(() => {
    setSearchResults({ users: [], spots: [], posts: [] });
  }, [setSearchResults]);

  // Leaderboard / Sponsors
  const fetchLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    try {
      const response = await apiClient.get(`/leaderboard/top-sponsors?limit=50`);
      setLeaderboard(response.data.leaderboard || []);
    } catch (error) {
      logger.error('Error fetching leaderboard:', error);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [setLeaderboard, setLeaderboardLoading]);

  const fetchSponsorDetails = useCallback(async (photographerId) => {
    try {
      const response = await apiClient.get(`/leaderboard/photographer/${photographerId}/details`);
      setSponsorDetails(response.data);
    } catch (error) {
      logger.error('Error fetching sponsor details:', error);
    }
  }, [setSponsorDetails]);

  const openSponsorCard = useCallback((sponsor) => {
    setSelectedSponsor(sponsor);
    fetchSponsorDetails(sponsor.photographer_id);
  }, [setSelectedSponsor, fetchSponsorDetails]);

  const closeSponsorCard = useCallback(() => {
    setSelectedSponsor(null);
    setSponsorDetails(null);
  }, [setSelectedSponsor, setSponsorDetails]);

  return {
    fetchTrending,
    fetchTrendingHashtags,
    fetchHashtagPosts,
    handleHashtagClick,
    fetchTrendingWaves,
    _fetchWavesByHashtag,
    handleWaveClick,
    fetchExplorePosts,
    handlePostClick,
    fetchSpotConditions,
    performSearch,
    clearSearch,
    fetchLeaderboard,
    fetchSponsorDetails,
    openSponsorCard,
    closeSponsorCard,
  };
};

export default useExploreData;
