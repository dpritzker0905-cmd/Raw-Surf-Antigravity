import React, { useState, useEffect, useCallback, useRef } from 'react';

import { useNavigate, useSearchParams } from 'react-router-dom';

import { Search, MapPin, Users, Image, TrendingUp, Radio, X, Waves, Heart, Trophy, MessageCircle, Camera, Clock, ChevronDown, ChevronRight, ChevronLeft, Navigation, Compass, Filter, Loader2, Play, Hash, Globe, ArrowLeft } from 'lucide-react';

import { Input } from './ui/input';

import { Badge } from './ui/badge';

import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';

import { getExpandedRoleInfo } from '../contexts/PersonaContext';

import { useConditionsSync, useLiveStreamSync } from '../hooks/useWebSocket';

import { useAuth } from '../contexts/AuthContext';

import { SocialAdCard } from './SocialAdCard';

import { toast } from 'sonner';

import apiClient, { BACKEND_URL } from '../lib/apiClient';

import ExploreSpotCard from './ExploreSpotCard';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';



// Media Preview component for Posts, Waves, and Videos
const PostMediaPreview = ({ post, isHoverScale = true }) => {
  const mediaUrl = post?.media_url || post?.image_url || post?.thumbnail_url;
  const isVideo = post?.media_type === 'video' || (mediaUrl && typeof mediaUrl === 'string' && mediaUrl.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i)) || post?.is_wave === true || typeof post?.view_count !== 'undefined';
  const thumbnailUrl = post?.thumbnail_url || (isVideo ? null : mediaUrl);

  const formatUrl = (url) => {
    if (!url) return null;
    return url.startsWith('/api') ? `${process.env.REACT_APP_BACKEND_URL}${url}` : url;
  };

  const finalMediaUrl = formatUrl(mediaUrl);
  const finalThumbnailUrl = formatUrl(thumbnailUrl);
  const hoverClass = isHoverScale ? "group-hover:scale-105 transition-transform duration-300" : "group-hover:opacity-80 transition-opacity duration-300";

  if (isVideo && finalMediaUrl) {
    return (
      <>
        <video 
          src={finalMediaUrl}
          poster={finalThumbnailUrl || ""}
          autoPlay 
          muted 
          loop 
          playsInline
          className={`w-full h-full object-cover absolute inset-0 pointer-events-none ${hoverClass}`}
        />
        <div className="absolute top-2 right-2 bg-black/60 rounded-full w-6 h-6 flex items-center justify-center opacity-80 shadow-md z-10">
          <Play className="w-3 h-3 text-white fill-white ml-0.5" />
        </div>
      </>
    );
  }

  if (finalThumbnailUrl || finalMediaUrl) {
    return (
      <img
        src={finalThumbnailUrl || finalMediaUrl}
        alt=""
        className={`w-full h-full object-cover absolute inset-0 ${hoverClass}`}
      />
    );
  }

  return (
    <div className="w-full h-full bg-zinc-800 flex items-center justify-center absolute inset-0">
      <Image className="w-8 h-8 text-zinc-600" />
    </div>
  );
};

// Role badge component for user results
const UserRoleBadge = ({ role }) => {
  const roleInfo = getExpandedRoleInfo(role);
  return (
    <span className={`text-sm ${roleInfo.color}`} title={roleInfo.label}>
      {roleInfo.icon}
    </span>
  );
};

export const Explore = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ users: [], spots: [], posts: [] });
  const [trending, setTrending] = useState({ live_photographers: [], popular_spots: [], trending_posts: [] });
  const [spotConditions, setSpotConditions] = useState({});
  const [activeTab, setActiveTab] = useState('all');
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Tabs carousel refs and state
  const tabsContainerRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  
  // Trending Hashtags state
  const [trendingHashtags, setTrendingHashtags] = useState([]);
  const [hashtagPosts, setHashtagPosts] = useState([]);
  const [selectedHashtag, setSelectedHashtag] = useState(null);
  const [hashtagLoading, setHashtagLoading] = useState(false);
  
  // Leaderboard state
  const [leaderboard, setLeaderboard] = useState([]);
  const [selectedSponsor, setSelectedSponsor] = useState(null);
  const [sponsorDetails, setSponsorDetails] = useState(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  
  // Conditions Explorer state
  const [conditionReports, setConditionReports] = useState([]);
  const [conditionsRegions, setConditionsRegions] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState('All');
  const [conditionsLoading, setConditionsLoading] = useState(false);
  const [showRegionDropdown, setShowRegionDropdown] = useState(false);
  
  // Trending Waves state
  const [trendingWaves, setTrendingWaves] = useState([]);
  const [wavesLoading, setWavesLoading] = useState(false);
  const [selectedWaveHashtag, setSelectedWaveHashtag] = useState(null);
  const [waveHashtagResults, setWaveHashtagResults] = useState([]);
  
  // Posts/Photos tab state
  const [explorePosts, setExplorePosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  
  // Surf Spots with Forecasts state
  const [surfSpots, setSurfSpots] = useState([]);
  const [surfSpotsLoading, setSurfSpotsLoading] = useState(false);
  const [surfSpotsRegions, setSurfSpotsRegions] = useState([]);
  const [selectedSpotsRegion, setSelectedSpotsRegion] = useState('All');
  const [showSpotsRegionDropdown, setShowSpotsRegionDropdown] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  
  // Location Discovery state
  const [locationHierarchy, setLocationHierarchy] = useState(null);
  const [locationHierarchyLoading, setLocationHierarchyLoading] = useState(false);
  const [discoveryMode, setDiscoveryMode] = useState('browse'); // 'nearby' | 'browse'
  const [locationPath, setLocationPath] = useState([]); // breadcrumb path: [{type, name, data}]
  const [spotSearchQuery, setSpotSearchQuery] = useState('');
  const [nearbySpots, setNearbySpots] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyRadius, setNearbyRadius] = useState(25);

  // WebSocket: Real-time conditions updates
  const handleNewCondition = useCallback((newCondition) => {
    // Add new condition to the top of the list
    setConditionReports(prev => {
      // Check if this condition already exists (by id)
      const exists = prev.some(c => c.id === newCondition.id);
      if (exists) return prev;
      
      // Add to top, limit to 50 items
      const updated = [newCondition, ...prev].slice(0, 50);
      toast.success(`New condition report at ${newCondition.spot_name || 'a spot'}!`, { duration: 3000 });
      return updated;
    });
  }, []);

  // WebSocket: Real-time live photographer updates
  const handleLiveUpdate = useCallback((liveData) => {
    // Backend sends: { user_id, is_live, stream }
    if (liveData.is_live) {
      // Photographer went live - add to list if not already there
      if (liveData.stream?.photographer) {
        setTrending(prev => ({
          ...prev,
          live_photographers: prev.live_photographers.some(p => p.id === liveData.user_id)
            ? prev.live_photographers
            : [liveData.stream.photographer, ...prev.live_photographers].slice(0, 10)
        }));
      }
    } else {
      // Photographer went offline - remove from list
      setTrending(prev => ({
        ...prev,
        live_photographers: prev.live_photographers.filter(p => p.id !== liveData.user_id)
      }));
    }
  }, []);

  // Connect WebSockets
  const { isConnected: _conditionsConnected } = useConditionsSync(handleNewCondition);
  const { isConnected: _liveConnected } = useLiveStreamSync(handleLiveUpdate);

  useEffect(() => {
    fetchTrending();
  }, []);

  useEffect(() => {
    if (activeTab === 'sponsors') {
      fetchLeaderboard();
    }
    if (activeTab === 'conditions') {
      fetchConditionReports();
      fetchConditionsRegions();
    }
    if (activeTab === 'surfspots') {
      fetchSurfSpots();
      fetchLocationHierarchy();
    }
    if (activeTab === 'trending') {
      fetchTrendingHashtags();
    }
    if (activeTab === 'waves') {
      fetchTrendingWaves();
    }
    if (activeTab === 'posts') {
      fetchExplorePosts();
    }
  }, [activeTab]);
  
  // Check for hashtag in URL params
  useEffect(() => {
    const hashtagParam = searchParams.get('hashtag');
    if (hashtagParam) {
      setActiveTab('trending');
      setSelectedHashtag(hashtagParam);
      fetchHashtagPosts(hashtagParam);
    }
  }, [searchParams]);

  // Update arrow visibility on scroll
  const updateArrowVisibility = useCallback(() => {
    const container = tabsContainerRef.current;
    if (!container) return;
    
    const { scrollLeft, scrollWidth, clientWidth } = container;
    setShowLeftArrow(scrollLeft > 10);
    setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
  }, []);

  // Initialize arrow visibility on mount
  useEffect(() => {
    updateArrowVisibility();
    const container = tabsContainerRef.current;
    if (container) {
      container.addEventListener('scroll', updateArrowVisibility);
      window.addEventListener('resize', updateArrowVisibility);
    }
    return () => {
      if (container) {
        container.removeEventListener('scroll', updateArrowVisibility);
      }
      window.removeEventListener('resize', updateArrowVisibility);
    };
  }, [updateArrowVisibility]);

  // Scroll tabs left/right
  const scrollTabs = (direction) => {
    const container = tabsContainerRef.current;
    if (!container) return;
    
    const scrollAmount = 200;
    const newScrollLeft = direction === 'left' 
      ? container.scrollLeft - scrollAmount 
      : container.scrollLeft + scrollAmount;
    
    container.scrollTo({
      left: newScrollLeft,
      behavior: 'smooth'
    });
    
    // Update arrow visibility after scroll animation
    setTimeout(updateArrowVisibility, 350);
  };

  useEffect(() => {
    const debounce = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        performSearch();
      } else {
        setSearchResults({ users: [], spots: [], posts: [] });
      }
    }, 300);

    return () => clearTimeout(debounce);
  }, [searchQuery, activeTab]);

  const fetchTrending = async () => {
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
  };
  
  // Fetch trending hashtags
  const fetchTrendingHashtags = async () => {
    try {
      const response = await apiClient.get(`/hashtags/trending?limit=15&days=7`);
      setTrendingHashtags(response.data.hashtags || []);
    } catch (error) {
      logger.debug('Trending hashtags not available');
      setTrendingHashtags([]);
    }
  };
  
  // Fetch posts for a specific hashtag
  const fetchHashtagPosts = async (tag) => {
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
  };
  
  // Handle hashtag click
  const handleHashtagClick = (tag) => {
    setSelectedHashtag(tag);
    fetchHashtagPosts(tag);
  };
  
  // Fetch Trending Waves for Explore
  const fetchTrendingWaves = async () => {
    setWavesLoading(true);
    try {
      const response = await apiClient.get(`/waves/trending`, {
        params: { limit: 12, days: 7 }
      });
      setTrendingWaves(response.data.trending_waves || []);
    } catch (error) {
      logger.error('Error fetching trending waves:', error);
      setTrendingWaves([]);
    } finally {
      setWavesLoading(false);
    }
  };
  
  // Fetch Waves by hashtag
  const _fetchWavesByHashtag = async (tag) => {
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
  };
  
  // Handle Wave click - navigate to Feed with Waves tab
  const handleWaveClick = (wave) => {
    navigate(`/feed?tab=waves&wave=${wave.id}`);
  };
  
  // Fetch Explore Posts (photos/videos for Posts tab)
  const fetchExplorePosts = async () => {
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
  };
  
  // Handle post click - navigate to post detail
  const handlePostClick = (post) => {
    navigate(`/post/${post.id}`);
  };

  const fetchSpotConditions = async (spotIds) => {
    try {
      const response = await apiClient.get(`/conditions/batch?spot_ids=${spotIds}`);
      // API returns conditions as an object keyed by spot_id
      const conditionsData = response.data.conditions || {};
      const conditionsMap = {};
      // Convert object to map with proper structure for the UI
      Object.entries(conditionsData).forEach(([spotId, data]) => {
        conditionsMap[spotId] = {
          spot_id: spotId,
          wave_height_ft: data.wave_height_ft,
          conditions_label: data.label,
          ...data
        };
      });
      setSpotConditions(conditionsMap);
    } catch (error) {
      logger.error('Error fetching conditions:', error);
    }
  };

  const performSearch = async () => {
    setIsSearching(true);
    try {
      const response = await apiClient.get(`/explore/search`, {
        params: { q: searchQuery, type: activeTab }
      });
      setSearchResults(response.data);
    } catch (error) {
      logger.error('Error searching:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults({ users: [], spots: [], posts: [] });
  };

  const fetchLeaderboard = async () => {
    setLeaderboardLoading(true);
    try {
      const response = await apiClient.get(`/leaderboard/top-sponsors?limit=50`);
      setLeaderboard(response.data.leaderboard || []);
    } catch (error) {
      logger.error('Error fetching leaderboard:', error);
    } finally {
      setLeaderboardLoading(false);
    }
  };

  const fetchSponsorDetails = async (photographerId) => {
    try {
      const response = await apiClient.get(`/leaderboard/photographer/${photographerId}/details`);
      setSponsorDetails(response.data);
    } catch (error) {
      logger.error('Error fetching sponsor details:', error);
    }
  };

  const openSponsorCard = (sponsor) => {
    setSelectedSponsor(sponsor);
    fetchSponsorDetails(sponsor.photographer_id);
  };

  const closeSponsorCard = () => {
    setSelectedSponsor(null);
    setSponsorDetails(null);
  };

  // Fetch condition reports for Conditions tab
  const fetchConditionReports = async (region = selectedRegion, locationOverride = null) => {
    setConditionsLoading(true);
    try {
      const params = new URLSearchParams();
      if (region && region !== 'All') {
        params.append('region', region);
      }
      params.append('limit', '30');
      
      // Add user location for nearby sorting if available
      const location = locationOverride || userLocation;
      if (location) {
        params.append('user_lat', location.lat);
        params.append('user_lng', location.lng);
      }
      
      const response = await apiClient.get(`/condition-reports/feed?${params}`);
      setConditionReports(response.data.reports || []);
    } catch (error) {
      logger.error('Error fetching condition reports:', error);
      setConditionReports([]);
    } finally {
      setConditionsLoading(false);
    }
  };

  // Fetch available regions for filter
  const fetchConditionsRegions = async () => {
    try {
      const response = await apiClient.get(`/condition-reports/regions`);
      setConditionsRegions(['All', ...(response.data.regions || [])]);
    } catch (error) {
      logger.error('Error fetching regions:', error);
      setConditionsRegions(['All', 'North Shore', 'East Coast', 'West Coast', 'Gold Coast', 'SoCal']);
    }
  };

  // Handle region filter change
  const handleRegionChange = (region) => {
    setSelectedRegion(region);
    setShowRegionDropdown(false);
    fetchConditionReports(region);
  };
  
  // Get user location for nearby reports
  const getReportsNearby = () => {
    if (navigator.geolocation) {
      setConditionsLoading(true);
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setUserLocation(newLocation);
          fetchConditionReports(selectedRegion, newLocation);
          toast.success('Location updated! Showing nearby reports first.');
        },
        (error) => {
          logger.error('Geolocation error:', error);
          setConditionsLoading(false);
          toast.error('Could not get your location');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      toast.error('Geolocation is not supported by your browser');
    }
  };
  
  // Fetch surf spots with forecasts and conditions
  const fetchSurfSpots = async (region = selectedSpotsRegion, locationOverride = null) => {
    setSurfSpotsLoading(true);
    try {
      const params = new URLSearchParams();
      if (region && region !== 'All') {
        params.append('region', region);
      }
      params.append('limit', '20');
      params.append('subscription_tier', user?.subscription_tier || 'free');
      
      // Add user location if available (use override if provided, otherwise use state)
      const location = locationOverride || userLocation;
      if (location) {
        params.append('user_lat', location.lat);
        params.append('user_lng', location.lng);
      }
      
      const response = await apiClient.get(`/explore/surf-spots?${params}`);
      setSurfSpots(response.data.spots || []);
      setSurfSpotsRegions(['All', ...(response.data.regions || [])]);
    } catch (error) {
      logger.error('Error fetching surf spots:', error);
      setSurfSpots([]);
    } finally {
      setSurfSpotsLoading(false);
    }
  };
  
  // Handle spots region filter change
  const handleSpotsRegionChange = (region) => {
    setSelectedSpotsRegion(region);
    setShowSpotsRegionDropdown(false);
    fetchSurfSpots(region);
  };
  
  // Get user location for nearby spots
  const getUserLocation = () => {
    if (navigator.geolocation) {
      // Show loading state immediately
      setSurfSpotsLoading(true);
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setUserLocation(newLocation);
          // Pass location directly to avoid race condition with state update
          fetchSurfSpots(selectedSpotsRegion, newLocation);
          toast.success('Location updated! Showing nearby spots first.');
        },
        (error) => {
          logger.error('Geolocation error:', error);
          setSurfSpotsLoading(false);
          toast.error('Could not get your location');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      toast.error('Geolocation is not supported by your browser');
    }
  };
  
  // ============ LOCATION DISCOVERY ============
  
  // Fetch the hierarchical location tree
  const fetchLocationHierarchy = async () => {
    if (locationHierarchy) return; // Already loaded
    setLocationHierarchyLoading(true);
    try {
      const response = await apiClient.get('/surf-spots/locations');
      setLocationHierarchy(response.data);
    } catch (error) {
      logger.error('Error fetching location hierarchy:', error);
    } finally {
      setLocationHierarchyLoading(false);
    }
  };
  
  // Fetch nearby spots using GPS
  const fetchNearbySpots = (lat, lng, radius = nearbyRadius) => {
    setNearbyLoading(true);
    apiClient.get('/explore/surf-spots', {
      params: {
        user_lat: lat,
        user_lng: lng,
        limit: 30,
        subscription_tier: user?.subscription_tier || 'free'
      }
    }).then(response => {
      setNearbySpots(response.data.spots || []);
    }).catch(error => {
      logger.error('Error fetching nearby spots:', error);
      setNearbySpots([]);
    }).finally(() => {
      setNearbyLoading(false);
    });
  };
  
  // Activate GPS nearby mode
  const activateNearbyMode = () => {
    setDiscoveryMode('nearby');
    if (userLocation) {
      fetchNearbySpots(userLocation.lat, userLocation.lng);
      return;
    }
    if (navigator.geolocation) {
      setNearbyLoading(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const loc = { lat: position.coords.latitude, lng: position.coords.longitude };
          setUserLocation(loc);
          fetchNearbySpots(loc.lat, loc.lng);
          toast.success('Found your location!');
        },
        (error) => {
          logger.error('Geolocation error:', error);
          setNearbyLoading(false);
          toast.error('Could not get your location. Please enable location services.');
          setDiscoveryMode('browse');
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      toast.error('Geolocation is not supported by your browser');
      setDiscoveryMode('browse');
    }
  };
  
  // Navigate location hierarchy — push a level
  const pushLocation = (type, name, data) => {
    setLocationPath(prev => [...prev, { type, name, data }]);
    // When we reach the city/region level, fetch spots for that region
    if (type === 'city') {
      setSelectedSpotsRegion(name);
      fetchSurfSpots(name);
    }
  };
  
  // Navigate back to a specific breadcrumb level
  const popLocationTo = (index) => {
    if (index < 0) {
      setLocationPath([]);
      return;
    }
    setLocationPath(prev => prev.slice(0, index + 1));
  };
  
  // Get current browse level items
  const getCurrentBrowseItems = () => {
    if (!locationHierarchy) return [];
    const countries = locationHierarchy.countries || [];
    
    if (locationPath.length === 0) {
      // Top level — show countries
      return { level: 'country', items: countries };
    }
    if (locationPath.length === 1) {
      // Country selected — show states
      const country = locationPath[0];
      const countryData = countries.find(c => c.name === country.name);
      const states = countryData?.states || [];
      return { level: 'state', items: states, parent: country.name };
    }
    if (locationPath.length === 2) {
      // State selected — show cities
      const country = locationPath[0];
      const state = locationPath[1];
      const countryData = countries.find(c => c.name === country.name);
      const stateData = countryData?.states?.find(s => s.name === state.name);
      const cities = stateData?.cities || [];
      return { level: 'city', items: cities, parent: state.name };
    }
    return { level: 'spots', items: [] };
  };
  
  // Filter browse items by search query
  const getFilteredBrowseItems = () => {
    const browseData = getCurrentBrowseItems();
    if (!spotSearchQuery.trim() || locationPath.length === 3) return browseData;
    
    const q = spotSearchQuery.toLowerCase().trim();
    const filtered = browseData.items.filter(item =>
      item.name?.toLowerCase().includes(q)
    );
    return { ...browseData, items: filtered };
  };
  
  // Country flag emoji helper
  const getCountryFlag = (countryName) => {
    const flags = {
      'United States': '🇺🇸', 'USA': '🇺🇸', 'Australia': '🇦🇺', 'Indonesia': '🇮🇩',
      'Brazil': '🇧🇷', 'Portugal': '🇵🇹', 'South Africa': '🇿🇦', 'France': '🇫🇷',
      'Spain': '🇪🇸', 'Mexico': '🇲🇽', 'Costa Rica': '🇨🇷', 'Japan': '🇯🇵',
      'New Zealand': '🇳🇿', 'Peru': '🇵🇪', 'Morocco': '🇲🇦', 'United Kingdom': '🇬🇧',
      'UK': '🇬🇧', 'Canada': '🇨🇦', 'Chile': '🇨🇱', 'Hawaii': '🏝️',
      'Fiji': '🇫🇯', 'Tahiti': '🇵🇫', 'Maldives': '🇲🇻', 'Philippines': '🇵🇭',
      'Sri Lanka': '🇱🇰', 'Nicaragua': '🇳🇮', 'Panama': '🇵🇦', 'El Salvador': '🇸🇻',
      'Ecuador': '🇪🇨', 'Ireland': '🇮🇪', 'Italy': '🇮🇹', 'Thailand': '🇹🇭'
    };
    return flags[countryName] || '🌊';
  };
  
  // Popular quick-access locations
  const popularLocations = [
    { label: '🇺🇸 Florida', country: 'United States', state: 'Florida' },
    { label: '🇺🇸 California', country: 'United States', state: 'California' },
    { label: '🇺🇸 Hawaii', country: 'United States', state: 'Hawaii' },
    { label: '🇦🇺 Australia', country: 'Australia' },
    { label: '🇮🇩 Indonesia', country: 'Indonesia' },
    { label: '🇧🇷 Brazil', country: 'Brazil' },
    { label: '🇵🇹 Portugal', country: 'Portugal' },
    { label: '🇨🇷 Costa Rica', country: 'Costa Rica' },
    { label: '🇲🇽 Mexico', country: 'Mexico' },
    { label: '🇿🇦 South Africa', country: 'South Africa' },
  ];
  
  // Quick jump to a popular location
  const jumpToLocation = (loc) => {
    setDiscoveryMode('browse');
    if (loc.state) {
      setLocationPath([
        { type: 'country', name: loc.country },
        { type: 'state', name: loc.state }
      ]);
    } else {
      setLocationPath([{ type: 'country', name: loc.country }]);
    }
  };

  const tabs = [
    { id: 'all', label: 'All', icon: Search },
    { id: 'waves', label: 'Waves', icon: Play },
    { id: 'posts', label: 'Posts', icon: Image },
    { id: 'trending', label: 'Trending', icon: Hash },
    { id: 'surfspots', label: 'Surf Spots', icon: Navigation },
    { id: 'users', label: 'People', icon: Users },
    { id: 'spots', label: 'Search', icon: MapPin },
    { id: 'conditions', label: 'Reports', icon: Waves },
    { id: 'sponsors', label: 'Sponsors', icon: Heart },
  ];

  const hasResults = searchResults.users.length > 0 || searchResults.spots.length > 0 || searchResults.posts.length > 0;
  const showResults = searchQuery.trim().length >= 2;

  return (
    <div className="max-w-2xl mx-auto p-4" data-testid="explore-page">
      {/* Search Bar */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search surfers, photographers, spots..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-12 pr-10 h-12 bg-card border-zinc-700 text-foreground placeholder-gray-500 focus:border-yellow-400"
          data-testid="explore-search-input"
        />
        {searchQuery && (
          <button
            onClick={clearSearch}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Search Tabs - Horizontally scrollable with arrow navigation */}
      <div className="flex items-center gap-2 mb-6">
        {/* Left Arrow - inline, fades when not needed */}
        <button
          onClick={() => scrollTabs('left')}
          className={`flex-shrink-0 w-8 h-8 rounded-full bg-zinc-800 border border-zinc-600 shadow-lg flex items-center justify-center text-white hover:bg-zinc-700 transition-all ${
            showLeftArrow ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          data-testid="tabs-scroll-left"
          aria-label="Scroll tabs left"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        
        {/* Tabs Container */}
        <div 
          ref={tabsContainerRef}
          className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide scroll-smooth flex-1"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-yellow-400 text-black'
                    : 'bg-muted text-gray-300 hover:bg-zinc-700'
                }`}
                data-testid={`tab-${tab.id}`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
        
        {/* Right Arrow - inline, fades when not needed */}
        <button
          onClick={() => scrollTabs('right')}
          className={`flex-shrink-0 w-8 h-8 rounded-full bg-zinc-800 border border-zinc-600 shadow-lg flex items-center justify-center text-white hover:bg-zinc-700 transition-all ${
            showRightArrow ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          data-testid="tabs-scroll-right"
          aria-label="Scroll tabs right"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Search Results */}
      {showResults && (
        <div className="space-y-6">
          {isSearching ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
            </div>
          ) : !hasResults ? (
            <div className="text-center py-10 text-muted-foreground">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No results found for "{searchQuery}"</p>
            </div>
          ) : (
            <>
              {/* Users Results */}
              {(activeTab === 'all' || activeTab === 'users') && searchResults.users.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">People</h3>
                  <div className="space-y-2">
                    {searchResults.users.map((user) => (
                      <div
                        key={user.id}
                        onClick={() => navigate(`/profile/${user.id}`)}
                        className="flex items-center gap-3 p-3 bg-card rounded-xl hover:bg-muted cursor-pointer transition-colors"
                        data-testid={`user-result-${user.id}`}
                      >
                        <div className="w-12 h-12 rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden">
                          {user.avatar_url ? (
                            <img src={getFullUrl(user.avatar_url)} alt={user.full_name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-lg font-medium text-muted-foreground">
                              {user.full_name?.charAt(0) || '?'}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground truncate">{user.full_name}</span>
                            {user.role && <UserRoleBadge role={user.role} />}
                            {user.is_verified && (
                              <Badge className="bg-blue-500 text-[10px] px-1.5">✓</Badge>
                            )}
                            {user.is_live && (
                              <Badge className="bg-red-500 text-[10px] px-1.5 animate-pulse">LIVE</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">{user.role}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Spots Results */}
              {(activeTab === 'all' || activeTab === 'spots') && searchResults.spots.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Surf Spots</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {searchResults.spots.map((spot) => (
                      <div
                        key={spot.id}
                        onClick={() => navigate(`/spot-hub/${spot.id}`)}
                        className="relative aspect-[4/3] rounded-xl overflow-hidden cursor-pointer group"
                        data-testid={`spot-result-${spot.id}`}
                      >
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent z-10" />
                        {spot.image_url ? (
                          <img src={getFullUrl(spot.image_url)} alt={spot.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                        ) : (
                          <div className="w-full h-full bg-muted flex items-center justify-center">
                            <MapPin className="w-8 h-8 text-zinc-600" />
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 p-3 z-20">
                          <h4 className="font-medium text-foreground truncate">{spot.name}</h4>
                          <p className="text-xs text-gray-300">{spot.region}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Posts Results */}
              {(activeTab === 'all' || activeTab === 'posts') && searchResults.posts.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Posts</h3>
                  <div className="grid grid-cols-3 gap-1">
                    {searchResults.posts.map((post) => (
                      <div
                        key={post.id}
                        className="aspect-square bg-muted overflow-hidden cursor-pointer group relative"
                        onClick={() => navigate(`/post/${post.id}`)}
                        data-testid={`post-result-${post.id}`}
                      >
                        <PostMediaPreview post={post} isHoverScale={false} />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* Trending Section (when not searching) - Only show on 'all' tab or when no specific tab section exists */}
      {!showResults && !loading && activeTab === 'all' && (
        <div className="space-y-8">
          {/* Social Live Now - Users broadcasting to followers (Instagram Live style) */}
          {trending.live_photographers?.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Radio className="w-5 h-5 text-red-500 animate-pulse" />
                <h3 className="font-semibold text-foreground">Broadcasting Now</h3>
              </div>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {trending.live_photographers.map((user) => (
                  <div
                    key={user.id}
                    onClick={() => navigate(`/profile/${user.id}`)}
                    className="flex flex-col items-center cursor-pointer flex-shrink-0"
                    data-testid={`live-user-${user.id}`}
                  >
                    <div className="w-16 h-16 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 to-orange-500 p-0.5">
                      <div className="w-full h-full rounded-full bg-card p-0.5">
                        <div className="w-full h-full rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden">
                          {user.avatar_url ? (
                            <img src={getFullUrl(user.avatar_url)} alt={user.full_name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-lg font-medium text-muted-foreground">
                              {user.full_name?.charAt(0) || '?'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs text-gray-300 mt-2 truncate max-w-[70px]">{user.full_name?.split(' ')[0]}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Trending Spots */}
          {trending.popular_spots?.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-yellow-400" />
                <h3 className="font-semibold text-foreground">Popular Spots</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {trending.popular_spots.slice(0, 4).map((spot) => {
                  const conditions = spotConditions[spot.id];
                  const thumbnail = spot.thumbnail;
                  const hasTaggedContent = thumbnail && thumbnail.media_url;
                  
                  // Determine the display image/content
                  const displayImage = hasTaggedContent 
                    ? (thumbnail.media_type === 'video' ? thumbnail.thumbnail_url || thumbnail.media_url : thumbnail.media_url)
                    : spot.image_url;
                  
                  return (
                    <div
                      key={spot.id}
                      onClick={() => navigate(`/spot-hub/${spot.id}`)}
                      className="relative aspect-[4/3] rounded-xl overflow-hidden cursor-pointer group"
                      data-testid={`trending-spot-${spot.id}`}
                    >
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent z-10" />
                      
                      {/* Content: Tagged media, spot image, or map fallback */}
                      {displayImage ? (
                        <img 
                          src={displayImage} 
                          alt={spot.name} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform" 
                        />
                      ) : spot.latitude && spot.longitude ? (
                        // Map fallback with location pin
                        <div className="w-full h-full bg-muted relative">
                          <img 
                            src={`https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${spot.longitude},${spot.latitude}&z=12&l=sat&size=400,300`}
                            alt={`Map of ${spot.name}`}
                            className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity"
                          />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <MapPin className="w-8 h-8 text-cyan-400 drop-shadow-lg" />
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-full bg-muted flex items-center justify-center">
                          <MapPin className="w-8 h-8 text-zinc-600" />
                        </div>
                      )}
                      
                      {/* Wave Height Badge */}
                      {conditions?.wave_height_ft !== undefined && (
                        <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-blue-500/80 backdrop-blur-sm rounded-full px-2 py-1">
                          <Waves className="w-3 h-3 text-foreground" />
                          <span className="text-xs font-bold text-foreground">{conditions.wave_height_ft}ft</span>
                        </div>
                      )}
                      
                      {/* Video indicator */}
                      {hasTaggedContent && thumbnail.media_type === 'video' && (
                        <div className="absolute top-2 left-2 z-20 bg-black/60 backdrop-blur-sm rounded-full p-1.5">
                          <Play className="w-3 h-3 text-foreground fill-white" />
                        </div>
                      )}
                      
                      {/* Spot info */}
                      <div className="absolute bottom-0 left-0 right-0 p-3 z-20">
                        <h4 className="font-medium text-foreground truncate">{spot.name}</h4>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-300">{spot.region}</p>
                          {conditions?.conditions_label && (
                            <span className="text-[10px] text-blue-300">{conditions.conditions_label}</span>
                          )}
                        </div>
                        
                        {/* Contributor credit */}
                        {hasTaggedContent && thumbnail.contributor_name && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            {thumbnail.contributor_avatar ? (
                              <img 
                                src={thumbnail.contributor_avatar} 
                                alt={thumbnail.contributor_name} 
                                className="w-4 h-4 rounded-full border border-white/30"
                              />
                            ) : (
                              <div className="w-4 h-4 rounded-full bg-zinc-600 flex items-center justify-center">
                                <span className="text-[8px] text-foreground">{thumbnail.contributor_name.charAt(0)}</span>
                              </div>
                            )}
                            <span className="text-[10px] text-muted-foreground truncate">
                              {['PHOTOGRAPHER', 'APPROVED_PRO', 'HOBBYIST'].includes(thumbnail.contributor_role?.toUpperCase()) 
                                ? '📸' 
                                : '🏄'} {thumbnail.contributor_name}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Trending Posts */}
          {trending.trending_posts.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Image className="w-5 h-5 text-emerald-400" />
                <h3 className="font-semibold text-foreground">Trending Posts</h3>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {trending.trending_posts.map((post) => (
                  <div
                    key={post.id}
                    className="aspect-square bg-muted overflow-hidden cursor-pointer group relative"
                    onClick={() => navigate(`/post/${post.id}`)}
                    data-testid={`trending-post-${post.id}`}
                  >
                    <PostMediaPreview post={post} isHoverScale={false} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Ad Card for ad-supported users */}
          {user?.is_ad_supported && (
            <SocialAdCard position={0} />
          )}

          {/* Empty State */}
          {trending.live_photographers?.length === 0 && trending.popular_spots?.length === 0 && trending.trending_posts?.length === 0 && (
            <div className="text-center py-20 text-muted-foreground">
              <Search className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">Discover the surf community</p>
              <p className="text-sm">Search for surfers, photographers, and surf spots</p>
            </div>
          )}
        </div>
      )}

      {/* Surf Spots Tab - Comprehensive Location Discovery */}
      {activeTab === 'surfspots' && (
        <div className="space-y-4" data-testid="surf-spots-tab">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Navigation className="w-5 h-5 text-cyan-400" />
              <h2 className="font-bold text-foreground">Surf Spots</h2>
              {locationHierarchy && (
                <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">
                  {locationHierarchy.total_countries || 0} countries
                </Badge>
              )}
            </div>
          </div>
          
          {/* Discovery Mode Toggle */}
          <div className="flex gap-2 p-1 bg-zinc-900 rounded-xl border border-zinc-800">
            <button
              onClick={() => { setDiscoveryMode('browse'); setSpotSearchQuery(''); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                discoveryMode === 'browse'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/20'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-zinc-800'
              }`}
              data-testid="browse-mode-btn"
            >
              <Globe className="w-4 h-4" />
              Browse
            </button>
            <button
              onClick={activateNearbyMode}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                discoveryMode === 'nearby'
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-zinc-800'
              }`}
              data-testid="nearby-mode-btn"
            >
              <Compass className="w-4 h-4" />
              Nearby
              {userLocation && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            </button>
          </div>
          
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              placeholder={discoveryMode === 'browse' 
                ? (locationPath.length === 0 ? 'Search countries...' : locationPath.length === 1 ? 'Search states/provinces...' : 'Search cities/regions...')
                : 'Search nearby spots...'}
              value={spotSearchQuery}
              onChange={(e) => setSpotSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-foreground placeholder-gray-500 text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all"
              data-testid="spot-search-input"
            />
            {spotSearchQuery && (
              <button
                onClick={() => setSpotSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          
          {/* ============ BROWSE MODE ============ */}
          {discoveryMode === 'browse' && (
            <>
              {/* Breadcrumb Navigation */}
              {locationPath.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap text-sm">
                  <button
                    onClick={() => popLocationTo(-1)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    All
                  </button>
                  {locationPath.map((crumb, idx) => (
                    <React.Fragment key={idx}>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
                      <button
                        onClick={() => idx < locationPath.length - 1 ? popLocationTo(idx) : null}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                          idx === locationPath.length - 1
                            ? 'text-white font-medium bg-zinc-800'
                            : 'text-cyan-400 hover:bg-cyan-500/10'
                        }`}
                      >
                        {crumb.type === 'country' && <span className="text-base">{getCountryFlag(crumb.name)}</span>}
                        {crumb.type === 'state' && <MapPin className="w-3 h-3" />}
                        {crumb.type === 'city' && <Navigation className="w-3 h-3" />}
                        <span className="truncate max-w-[120px]">{crumb.name}</span>
                      </button>
                    </React.Fragment>
                  ))}
                  
                  {/* Back button */}
                  <button
                    onClick={() => popLocationTo(locationPath.length - 2)}
                    className="ml-auto flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-zinc-800 rounded-md transition-colors"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Back
                  </button>
                </div>
              )}
              
              {/* Popular Quick Chips — show only at top level with no search */}
              {locationPath.length === 0 && !spotSearchQuery && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">Popular Destinations</p>
                  <div className="flex flex-wrap gap-2">
                    {popularLocations.map((loc, i) => (
                      <button
                        key={i}
                        onClick={() => jumpToLocation(loc)}
                        className="px-3 py-1.5 bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700 hover:border-cyan-500/30 rounded-full text-xs text-gray-300 hover:text-white transition-all"
                        data-testid={`quick-loc-${i}`}
                      >
                        {loc.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Location Hierarchy Cards */}
              {locationPath.length < 3 && (
                <>
                  {locationHierarchyLoading ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[1,2,3,4,5,6].map(i => (
                        <div key={i} className="h-20 bg-zinc-800 rounded-xl animate-pulse" />
                      ))}
                    </div>
                  ) : (() => {
                    const browseData = getFilteredBrowseItems();
                    if (!browseData?.items) return null;
                    const items = browseData.items;
                    const level = browseData.level;
                    
                    if (items.length === 0 && spotSearchQuery) {
                      return (
                        <div className="text-center py-10 text-muted-foreground">
                          <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">No {level === 'country' ? 'countries' : level === 'state' ? 'states' : 'cities'} matching "{spotSearchQuery}"</p>
                        </div>
                      );
                    }
                    
                    if (items.length === 0) {
                      return (
                        <div className="text-center py-10 text-muted-foreground">
                          <Navigation className="w-10 h-10 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">No {level === 'state' ? 'states/provinces' : 'cities/regions'} available at this level</p>
                          <p className="text-xs text-gray-600 mt-1">Spots may be listed directly without sub-regions</p>
                        </div>
                      );
                    }
                    
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {items.map((item, idx) => {
                          // Zoom level based on hierarchy depth
                          const mapZoom = level === 'country' ? 4 : level === 'state' ? 6 : 9;
                          const hasCoords = item.latitude && item.longitude;
                          
                          return (
                          <button
                            key={item.name || idx}
                            onClick={() => pushLocation(level, item.name, item)}
                            className="group relative flex flex-col justify-end overflow-hidden rounded-xl border border-zinc-800 hover:border-cyan-500/40 transition-all text-left"
                            style={{ aspectRatio: '4/3', minHeight: '100px' }}
                            data-testid={`loc-${level}-${idx}`}
                          >
                            {/* Map satellite background */}
                            {hasCoords ? (
                              <img 
                                src={`https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${item.longitude},${item.latitude}&z=${mapZoom}&l=sat&size=400,300`}
                                alt={`Map of ${item.name}`}
                                className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity duration-300"
                                loading="lazy"
                              />
                            ) : (
                              <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-900" />
                            )}
                            
                            {/* Gradient overlay */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10 z-10" />
                            
                            {/* Map pin indicator */}
                            {hasCoords && (
                              <div className="absolute top-2 right-2 z-20">
                                <MapPin className={`w-4 h-4 drop-shadow-lg ${
                                  level === 'country' ? 'text-cyan-400' : level === 'state' ? 'text-blue-400' : 'text-emerald-400'
                                }`} />
                              </div>
                            )}
                            
                            {/* Content overlay */}
                            <div className="relative z-20 p-3">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                {level === 'country' && <span className="text-lg leading-none">{getCountryFlag(item.name)}</span>}
                                {level === 'state' && <MapPin className="w-3.5 h-3.5 text-blue-400" />}
                                {level === 'city' && <Navigation className="w-3.5 h-3.5 text-emerald-400" />}
                              </div>
                              
                              <span className="text-sm font-semibold text-white truncate block drop-shadow-md">{item.name}</span>
                              
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className="text-[11px] text-gray-300 drop-shadow">
                                  {item.spot_count} {item.spot_count === 1 ? 'spot' : 'spots'}
                                </span>
                                {level !== 'city' && (item.states?.length > 0 || item.cities?.length > 0) && (
                                  <ChevronRight className="w-3 h-3 text-gray-400 group-hover:text-cyan-400 transition-colors" />
                                )}
                              </div>
                            </div>
                          </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              )}
              
              {/* Spot Cards — show when at city/region level */}
              {locationPath.length === 3 && (
                <>
                  {/* Tiered Forecast Info Banner */}
                  <div className="p-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-lg">
                    <div className="flex items-center gap-2 text-xs text-cyan-400">
                      <Waves className="w-4 h-4" />
                      <span>
                        <strong>Today</strong> = Current Conditions • <strong>Forecast:</strong> 3 days free, 7 paid, 10 premium
                      </span>
                    </div>
                  </div>
                  
                  {surfSpotsLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="bg-card/80 border border-border rounded-xl overflow-hidden animate-pulse">
                          <div className="h-32 bg-muted" />
                          <div className="px-3 py-2 border-b border-border flex items-center gap-3">
                            <div className="h-5 w-12 bg-zinc-700 rounded" />
                            <div className="h-4 w-16 bg-zinc-700 rounded" />
                          </div>
                          <div className="px-3 py-2 flex gap-2">
                            <div className="flex-1 h-9 bg-zinc-700 rounded-lg" />
                            <div className="h-9 w-16 bg-muted rounded-lg" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : surfSpots.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Navigation className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="font-medium mb-1">No spots found in {locationPath[2]?.name}</p>
                      <p className="text-sm text-gray-500">Try selecting a different area</p>
                    </div>
                  ) : (
                    <>
                      <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">{surfSpots.length} spots in {locationPath[2]?.name}</Badge>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {surfSpots
                          .filter(s => !spotSearchQuery || s.name?.toLowerCase().includes(spotSearchQuery.toLowerCase()))
                          .map((spot) => (
                          <ExploreSpotCard 
                            key={spot.id} 
                            spot={spot} 
                            userSubscriptionTier={user?.subscription_tier || 'free'}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
              
              {/* Fallback: Show all spots if at top browse level with no hierarchy */}
              {locationPath.length === 0 && !locationHierarchy && !locationHierarchyLoading && (
                <>
                  <div className="p-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-lg">
                    <div className="flex items-center gap-2 text-xs text-cyan-400">
                      <Waves className="w-4 h-4" />
                      <span>
                        <strong>Today</strong> = Current Conditions • <strong>Forecast:</strong> 3 days free, 7 paid, 10 premium
                      </span>
                    </div>
                  </div>
                  
                  {surfSpotsLoading ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {surfSpots.map((spot) => (
                        <ExploreSpotCard 
                          key={spot.id} 
                          spot={spot} 
                          userSubscriptionTier={user?.subscription_tier || 'free'}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          
          {/* ============ NEARBY MODE ============ */}
          {discoveryMode === 'nearby' && (
            <>
              {/* GPS Status */}
              {userLocation && (
                <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs text-emerald-400">
                    Located: {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
                  </span>
                  <button
                    onClick={() => fetchNearbySpots(userLocation.lat, userLocation.lng)}
                    className="ml-auto text-xs text-emerald-400 hover:text-emerald-300 underline"
                  >
                    Refresh
                  </button>
                </div>
              )}
              
              {/* Tiered Forecast Info Banner */}
              <div className="p-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-lg">
                <div className="flex items-center gap-2 text-xs text-cyan-400">
                  <Waves className="w-4 h-4" />
                  <span>
                    <strong>Today</strong> = Current Conditions • <strong>Forecast:</strong> 3 days free, 7 paid, 10 premium
                  </span>
                </div>
              </div>
              
              {/* Nearby Spots Results */}
              {nearbyLoading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="relative">
                    <Compass className="w-10 h-10 text-emerald-400 animate-spin" />
                    <div className="absolute inset-0 w-10 h-10 rounded-full border-2 border-emerald-400/20 animate-ping" />
                  </div>
                  <p className="text-sm text-gray-400">Finding spots near you...</p>
                </div>
              ) : nearbySpots.length === 0 && userLocation ? (
                <div className="text-center py-16 text-muted-foreground">
                  <MapPin className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p className="font-medium mb-1">No spots found nearby</p>
                  <p className="text-sm text-gray-500 mb-4">Try browsing by location instead</p>
                  <button
                    onClick={() => setDiscoveryMode('browse')}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm text-gray-300 transition-colors"
                  >
                    <Globe className="w-4 h-4 inline mr-2" />
                    Browse All Locations
                  </button>
                </div>
              ) : nearbySpots.length > 0 ? (
                <>
                  <Badge className="bg-emerald-500/20 text-emerald-400 text-xs">
                    {nearbySpots.filter(s => !spotSearchQuery || s.name?.toLowerCase().includes(spotSearchQuery.toLowerCase())).length} spots near you
                  </Badge>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {nearbySpots
                      .filter(s => !spotSearchQuery || s.name?.toLowerCase().includes(spotSearchQuery.toLowerCase()))
                      .map((spot) => (
                      <ExploreSpotCard 
                        key={spot.id} 
                        spot={spot} 
                        userSubscriptionTier={user?.subscription_tier || 'free'}
                      />
                    ))}
                  </div>
                </>
              ) : !userLocation ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Compass className="w-16 h-16 mx-auto mb-4 opacity-30" />
                  <p className="font-medium mb-1">Enable Location Access</p>
                  <p className="text-sm text-gray-500 mb-4">Allow location access to find surf spots near you</p>
                  <button
                    onClick={activateNearbyMode}
                    className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 rounded-xl text-white text-sm font-medium transition-all shadow-lg shadow-emerald-500/20"
                  >
                    <Compass className="w-4 h-4 inline mr-2" />
                    Use My Location
                  </button>
                </div>
              ) : null}
            </>
          )}
          
          {/* Map View CTA — always visible */}
          <div className="mt-6">
            <button
              onClick={() => navigate('/map')}
              className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 rounded-xl text-white font-medium transition-all shadow-lg shadow-cyan-500/10"
              data-testid="view-all-on-map"
            >
              <MapPin className="w-5 h-5" />
              View All Spots on Map
            </button>
          </div>
        </div>
      )}

      {/* Waves Tab - Trending Short-Form Videos */}
      {activeTab === 'waves' && (
        <div className="space-y-4" data-testid="waves-tab">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Play className="w-5 h-5 text-cyan-400" />
              <h2 className="font-bold text-foreground">Trending Waves</h2>
            </div>
            <button
              onClick={() => navigate('/feed?tab=waves')}
              className="text-sm text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
            >
              View All
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          
          {/* Selected Hashtag View for Waves */}
          {selectedWaveHashtag ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setSelectedWaveHashtag(null);
                      setWaveHashtagResults([]);
                    }}
                    className="p-1.5 hover:bg-muted rounded-full transition-colors"
                  >
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                  <span className="text-xl font-bold text-cyan-400">#{selectedWaveHashtag}</span>
                </div>
                <Badge className="bg-cyan-400/20 text-cyan-400">
                  {waveHashtagResults.length} waves
                </Badge>
              </div>
              
              {wavesLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                </div>
              ) : waveHashtagResults.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Play className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No waves with #{selectedWaveHashtag} yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1">
                  {waveHashtagResults.map((wave) => (
                    <div
                      key={wave.id}
                      onClick={() => handleWaveClick(wave)}
                      className="aspect-[9/16] bg-black overflow-hidden cursor-pointer group relative"
                      data-testid={`wave-${wave.id}`}
                    >
                      <PostMediaPreview post={wave} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none" />
                      <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 text-white text-xs z-20 pointer-events-none">
                        <Play className="w-3 h-3" fill="white" />
                        <span>{wave.view_count || 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Waves Grid */}
              {wavesLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                </div>
              ) : trendingWaves.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Play className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">No Waves Yet</h3>
                  <p className="mb-4">Be the first to share a short-form video!</p>
                  <button
                    onClick={() => navigate('/feed?tab=waves')}
                    className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-full text-sm font-medium hover:from-cyan-600 hover:to-blue-600 transition-all"
                  >
                    Create a Wave
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1">
                  {trendingWaves.map((wave, index) => (
                    <div
                      key={wave.id}
                      onClick={() => handleWaveClick(wave)}
                      className="aspect-[9/16] bg-black overflow-hidden cursor-pointer group relative"
                      data-testid={`trending-wave-${wave.id}`}
                    >
                      <PostMediaPreview post={wave} />
                      
                      {/* Rank badge for top 3 */}
                      {index < 3 && (
                        <div className={`absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold z-20 ${
                          index === 0 ? 'bg-yellow-500 text-black' :
                          index === 1 ? 'bg-gray-400 text-black' :
                          'bg-amber-700 text-white'
                        }`}>
                          {index + 1}
                        </div>
                      )}
                      
                      {/* Overlay on hover */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent z-10 pointer-events-none" />
                      
                      {/* Stats */}
                      <div className="absolute bottom-2 left-2 right-2 z-20 pointer-events-none">
                        <div className="flex items-center gap-3 text-white text-xs">
                          <span className="flex items-center gap-1">
                            <Play className="w-3 h-3" fill="white" />
                            {wave.view_count || 0}
                          </span>
                          <span className="flex items-center gap-1">
                            <Heart className="w-3 h-3" />
                            {wave.likes_count || 0}
                          </span>
                        </div>
                        <p className="text-white text-xs mt-1 truncate">
                          @{wave.author_username || wave.author_name?.split(' ')[0]?.toLowerCase()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Browse by Hashtag CTA */}
              {trendingWaves.length > 0 && (
                <div className="mt-6 p-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-xl border border-cyan-500/20">
                  <div className="flex items-center gap-3">
                    <Hash className="w-8 h-8 text-cyan-400" />
                    <div className="flex-1">
                      <p className="font-medium text-foreground">Browse Waves by Hashtag</p>
                      <p className="text-sm text-muted-foreground">Find waves about specific topics</p>
                    </div>
                    <button
                      onClick={() => setActiveTab('trending')}
                      className="px-3 py-1.5 text-sm text-cyan-400 border border-cyan-400/30 rounded-full hover:bg-cyan-400/10 transition-colors"
                    >
                      Browse
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Posts Tab - Browse Photos & Videos */}
      {activeTab === 'posts' && (
        <div className="space-y-4" data-testid="posts-tab">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Image className="w-5 h-5 text-purple-400" />
              <h2 className="font-bold text-foreground">Explore Posts</h2>
            </div>
            <button
              onClick={() => navigate('/feed')}
              className="text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1"
            >
              View Feed
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          
          {/* Posts Grid */}
          {postsLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
            </div>
          ) : explorePosts.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Image className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No Posts Yet</h3>
              <p className="mb-4">Be the first to share a photo or video!</p>
              <button
                onClick={() => navigate('/create')}
                className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full text-sm font-medium hover:from-purple-600 hover:to-pink-600 transition-all"
              >
                Create a Post
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {explorePosts.map((post) => (
                <div
                  key={post.id}
                  onClick={() => handlePostClick(post)}
                  className="aspect-square bg-zinc-800 overflow-hidden cursor-pointer group relative"
                  data-testid={`explore-post-${post.id}`}
                >
                  <PostMediaPreview post={post} />
                  
                  {/* Overlay on hover */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 text-white z-20 pointer-events-none">
                    <span className="flex items-center gap-1 text-sm">
                      <Heart className="w-4 h-4" />
                      {post.likes_count || 0}
                    </span>
                    <span className="flex items-center gap-1 text-sm">
                      <MessageCircle className="w-4 h-4" />
                      {post.comments_count || 0}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Trending Hashtags Tab */}
      {activeTab === 'trending' && (
        <div className="space-y-4" data-testid="trending-hashtags-tab">
          {/* Header */}
          <div className="flex items-center gap-2">
            <Hash className="w-5 h-5 text-yellow-400" />
            <h2 className="font-bold text-foreground">Trending Hashtags</h2>
          </div>
          
          {/* Selected Hashtag View */}
          {selectedHashtag ? (
            <div>
              {/* Hashtag Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setSelectedHashtag(null);
                      setHashtagPosts([]);
                    }}
                    className="p-1.5 hover:bg-muted rounded-full transition-colors"
                  >
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                  <span className="text-xl font-bold text-yellow-400">#{selectedHashtag}</span>
                </div>
                <Badge className="bg-yellow-400/20 text-yellow-400">
                  {hashtagPosts.length} posts
                </Badge>
              </div>
              
              {/* Posts Grid */}
              {hashtagLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
                </div>
              ) : hashtagPosts.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <Hash className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No posts with #{selectedHashtag} yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1">
                  {hashtagPosts.map((post) => (
                    <div
                      key={post.id}
                      onClick={() => navigate(`/post/${post.id}`)}
                      className="aspect-square bg-muted overflow-hidden cursor-pointer group relative"
                      data-testid={`hashtag-post-${post.id}`}
                    >
                      <PostMediaPreview post={post} isHoverScale={false} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Trending Hashtags List */
            <div className="space-y-4">
              {/* Quick Hashtag Pills */}
              {trendingHashtags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {trendingHashtags.slice(0, 10).map((tag, index) => (
                    <button
                      key={tag.tag}
                      onClick={() => handleHashtagClick(tag.tag)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        index < 3 
                          ? 'bg-yellow-400/20 text-yellow-400 hover:bg-yellow-400/30' 
                          : 'bg-muted text-gray-300 hover:bg-zinc-700'
                      }`}
                      data-testid={`trending-hashtag-${tag.tag}`}
                    >
                      #{tag.tag}
                      <span className="ml-1 text-xs opacity-70">{tag.post_count}</span>
                    </button>
                  ))}
                </div>
              )}
              
              {/* Full List */}
              <div className="space-y-2">
                {trendingHashtags.map((tag, index) => (
                  <button
                    key={tag.tag}
                    onClick={() => handleHashtagClick(tag.tag)}
                    className="w-full flex items-center gap-3 p-3 bg-card rounded-xl hover:bg-muted transition-colors"
                    data-testid={`hashtag-item-${tag.tag}`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      index < 3 ? 'bg-yellow-400/20' : 'bg-muted'
                    }`}>
                      <span className={`text-lg font-bold ${
                        index < 3 ? 'text-yellow-400' : 'text-muted-foreground'
                      }`}>
                        {index + 1}
                      </span>
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-foreground">#{tag.tag}</p>
                      <p className="text-xs text-muted-foreground">{tag.post_count} posts</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </button>
                ))}
                
                {trendingHashtags.length === 0 && (
                  <div className="text-center py-10 text-muted-foreground">
                    <Hash className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No trending hashtags yet</p>
                    <p className="text-sm mt-1">Start posting with #hashtags to see trends!</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conditions/Reports Tab - Condition reports posted by photographers when they start shooting */}
      {activeTab === 'conditions' && (
        <div className="space-y-4" data-testid="conditions-explorer-tab">
          {/* Header with Nearby Button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Waves className="w-5 h-5 text-cyan-400" />
              <h2 className="font-bold text-foreground">Today's Reports</h2>
              <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">
                {conditionReports.length} reports
              </Badge>
            </div>
            <button
              onClick={getReportsNearby}
              className="flex items-center gap-1 px-3 py-1.5 bg-muted hover:bg-zinc-700 rounded-full text-xs text-gray-300 transition-colors"
              data-testid="reports-nearby-btn"
            >
              <Compass className="w-3 h-3" />
              Nearby
            </button>
          </div>
          
          {/* Region Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowRegionDropdown(!showRegionDropdown)}
              className="flex items-center justify-between w-full px-4 py-3 bg-muted rounded-lg text-foreground hover:bg-zinc-700 transition-colors"
              data-testid="region-filter-btn"
            >
              <span className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-cyan-400" />
                <span className="font-medium">{selectedRegion === 'All' ? 'All Regions' : selectedRegion}</span>
              </span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showRegionDropdown ? 'rotate-180' : ''}`} />
            </button>
            
            {showRegionDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-muted border border-zinc-700 rounded-lg shadow-xl z-20 max-h-64 overflow-y-auto">
                {conditionsRegions.map((region) => (
                  <button
                    key={region}
                    onClick={() => handleRegionChange(region)}
                    className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                      selectedRegion === region 
                        ? 'bg-cyan-500/20 text-cyan-400' 
                        : 'text-gray-300 hover:bg-zinc-700'
                    }`}
                  >
                    {region === 'All' ? 'All Regions' : region}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Loading State */}
          {conditionsLoading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
            </div>
          ) : conditionReports.length === 0 ? (
            /* Empty State */
            <div className="text-center py-12 text-muted-foreground">
              <Waves className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium mb-1">No conditions reports yet</p>
              <p className="text-sm text-gray-500">Check back when photographers go live!</p>
            </div>
          ) : (
            /* Conditions Reports List */
            <div className="space-y-3">
              {conditionReports.map((report) => (
                <div
                  key={report.id}
                  onClick={() => {
                    if (report.spot_id) {
                      navigate(`/spot-hub/${report.spot_id}`);
                    } else {
                      navigate(`/profile/${report.photographer_id}`);
                    }
                  }}
                  className="flex items-center gap-4 p-4 bg-muted/50 hover:bg-zinc-700/50 rounded-xl cursor-pointer transition-colors group"
                  data-testid={`condition-report-${report.id}`}
                >
                  {/* Thumbnail */}
                  <div className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-700">
                    {report.media_url ? (
                      <img 
                        src={report.thumbnail_url || report.media_url} 
                        alt={report.spot_name || 'Conditions'} 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Waves className="w-8 h-8 text-zinc-600" />
                      </div>
                    )}
                    {/* Wave Height Badge */}
                    {report.wave_height_ft && (
                      <div className="absolute bottom-1 left-1 flex items-center gap-0.5 bg-blue-500/90 backdrop-blur-sm rounded-full px-1.5 py-0.5">
                        <Waves className="w-2.5 h-2.5 text-foreground" />
                        <span className="text-[10px] font-bold text-foreground">{report.wave_height_ft}ft</span>
                      </div>
                    )}
                    {/* Active Indicator */}
                    {report.is_active && (
                      <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-foreground truncate">{report.spot_name || 'Unknown Spot'}</h4>
                      {report.conditions_label && (
                        <Badge className="bg-blue-500/20 text-blue-400 text-xs">
                          {report.conditions_label}
                        </Badge>
                      )}
                    </div>
                    
                    {/* Photographer Info */}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        {report.photographer_avatar ? (
                          <img 
                            src={report.photographer_avatar} 
                            alt={report.photographer_name} 
                            className="w-4 h-4 rounded-full object-cover"
                          />
                        ) : (
                          <Camera className="w-4 h-4 text-yellow-400" />
                        )}
                        <span className="truncate">{report.photographer_name || 'Photographer'}</span>
                      </div>
                      <span className="text-gray-600">•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {report.time_ago}
                      </span>
                    </div>
                    
                    {/* Caption Preview */}
                    {report.caption && (
                      <p className="text-xs text-gray-500 truncate mt-1">{report.caption}</p>
                    )}
                  </div>

                  {/* Arrow */}
                  <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-cyan-400 transition-colors flex-shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top Sponsors Tab - Beach Mode styling */}
      {activeTab === 'sponsors' && (
        <div className="space-y-4" data-testid="top-sponsors-tab">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-foreground font-bold text-lg flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              Top Sponsors This Month
            </h2>
          </div>

          {leaderboardLoading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-400"></div>
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Heart className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No sponsors yet this month</p>
              <p className="text-sm mt-1">Be the first to support a Grom!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {leaderboard.map((sponsor, index) => (
                <div
                  key={sponsor.photographer_id}
                  onClick={() => openSponsorCard(sponsor)}
                  className="bg-black border-2 border-white rounded-lg p-4 cursor-pointer hover:bg-card transition-all"
                  data-testid={`sponsor-card-${index}`}
                >
                  <div className="flex items-center gap-4">
                    {/* Rank */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${
                      sponsor.rank === 1 ? 'bg-amber-500 text-black' :
                      sponsor.rank === 2 ? 'bg-gray-300 text-black' :
                      sponsor.rank === 3 ? 'bg-amber-700 text-foreground' :
                      'bg-muted text-foreground'
                    }`}>
                      {sponsor.rank}
                    </div>

                    {/* Avatar */}
                    <Avatar className="w-12 h-12">
                      <AvatarImage src={getFullUrl(sponsor.avatar_url)} />
                      <AvatarFallback className="bg-zinc-700 text-foreground">
                        {sponsor.full_name?.[0] || '?'}
                      </AvatarFallback>
                    </Avatar>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground font-semibold truncate">{sponsor.full_name}</span>
                        {sponsor.is_grom_guardian && (
                          <Badge className="bg-amber-500/20 text-amber-400 text-xs px-1.5 py-0.5">
                            Grom Guardian
                          </Badge>
                        )}
                      </div>
                      <p className="text-zinc-500 text-sm">{sponsor.role}</p>
                    </div>

                    {/* Stats */}
                    <div className="text-right">
                      <p className="text-amber-400 font-bold text-lg">
                        {sponsor.monthly_total?.toFixed(0) || 0}
                      </p>
                      <p className="text-zinc-600 text-xs">credits given</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sponsor Quick Card (Bottom Sheet) */}
      {selectedSponsor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeSponsorCard}
          />
          
          {/* Sheet */}
          <div className="relative bg-card border-t-2 border-white rounded-t-2xl w-full max-w-lg animate-slide-up">
            {/* Handle */}
            <div className="flex justify-center pt-2 pb-4">
              <div className="w-10 h-1 bg-zinc-700 rounded-full" />
            </div>

            <div className="px-6 pb-8">
              {/* Profile Header */}
              <div className="flex items-center gap-4 mb-6">
                <Avatar className="w-16 h-16">
                  <AvatarImage src={getFullUrl(selectedSponsor.avatar_url)} />
                  <AvatarFallback className="bg-zinc-700 text-foreground text-xl">
                    {selectedSponsor.full_name?.[0] || '?'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-foreground font-bold text-lg">{selectedSponsor.full_name}</h3>
                    {selectedSponsor.is_grom_guardian && (
                      <Badge className="bg-amber-500 text-black text-xs">
                        Grom Guardian
                      </Badge>
                    )}
                  </div>
                  <p className="text-zinc-400 text-sm">{selectedSponsor.role}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-amber-400">#{selectedSponsor.rank}</p>
                </div>
              </div>

              {/* Impact Stats */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-muted border border-zinc-700 rounded-lg p-3 text-center">
                  <p className="text-amber-400 font-bold text-xl">
                    {sponsorDetails?.monthly_total?.toFixed(0) || selectedSponsor.monthly_total?.toFixed(0) || 0}
                  </p>
                  <p className="text-zinc-500 text-xs">This Month</p>
                </div>
                <div className="bg-muted border border-zinc-700 rounded-lg p-3 text-center">
                  <p className="text-cyan-400 font-bold text-xl">
                    {sponsorDetails?.lifetime_total?.toFixed(0) || selectedSponsor.lifetime_total?.toFixed(0) || 0}
                  </p>
                  <p className="text-zinc-500 text-xs">Lifetime</p>
                </div>
                <div className="bg-muted border border-zinc-700 rounded-lg p-3 text-center">
                  <p className="text-green-400 font-bold text-xl">
                    {sponsorDetails?.total_groms_supported || selectedSponsor.groms_supported || 0}
                  </p>
                  <p className="text-zinc-500 text-xs">Groms</p>
                </div>
              </div>

              {/* Athletes Supported */}
              {sponsorDetails?.supported_athletes?.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-foreground font-semibold mb-3">Athletes Supported</h4>
                  <div className="flex flex-wrap gap-2">
                    {sponsorDetails.supported_athletes.map(athlete => (
                      <div 
                        key={athlete.id}
                        className="flex items-center gap-2 bg-muted rounded-full px-3 py-1.5"
                      >
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={getFullUrl(athlete.avatar_url)} />
                          <AvatarFallback className="bg-amber-900 text-amber-400 text-xs">
                            {athlete.full_name?.[0]}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-foreground text-sm">{athlete.full_name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => navigate(`/profile/${selectedSponsor.photographer_id}`)}
                  className="flex-1 bg-white text-black font-semibold py-3 rounded-lg hover:bg-zinc-200 transition-all"
                >
                  View Profile
                </button>
                <button
                  onClick={() => navigate(`/messages?to=${selectedSponsor.photographer_id}`)}
                  className="flex-1 bg-muted text-foreground font-semibold py-3 rounded-lg hover:bg-zinc-700 transition-all flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-5 h-5" />
                  Message
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
