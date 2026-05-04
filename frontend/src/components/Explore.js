import React, { useState, useEffect, useCallback, useRef } from 'react';

import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  Search,
  MapPin,
  Users,
  Image,
  TrendingUp,
  Radio,
  X,
  Waves,
  Heart,
  Trophy,
  MessageCircle,
  Camera,
  Clock,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Navigation,
  Compass,
  Loader2,
  Play,
  Hash,
  Globe,
  Archive,
  FolderOpen
} from 'lucide-react';

import { Input } from './ui/input';

import { Badge } from './ui/badge';

import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';

import { getExpandedRoleInfo } from '../contexts/PersonaContext';

import { useConditionsSync, useLiveStreamSync } from '../hooks/useWebSocket';

import { useAuth } from '../contexts/AuthContext';

import { useTheme } from '../contexts/ThemeContext';

import { SocialAdCard } from './SocialAdCard';

import { toast } from 'sonner';

import apiClient, { BACKEND_URL } from '../lib/apiClient';

import ExploreSpotCard from './ExploreSpotCard';

import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';
import ResponsiveImage from './ui/ResponsiveImage';
import PostMediaPreview from './explore/PostMediaPreview';
import BrowseMode from './explore/BrowseMode';
import NearbyMode from './explore/NearbyMode';
import UserRoleBadge from './explore/UserRoleBadge';
import useExploreConditions from '../hooks/useExploreConditions';
import HashtagsTab from './explore/HashtagsTab';

// PostMediaPreview extracted ? ./explore/PostMediaPreview.js

// Role badge component for user results
// UserRoleBadge extracted to ./explore/UserRoleBadge.js

export const Explore = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  // Theme-conditional classes for dropdowns and inputs
  const dropdownBg = isLight ? 'bg-white' : isBeach ? 'bg-zinc-900' : 'bg-zinc-900';
  const dropdownBorder = isLight ? 'border-gray-300' : isBeach ? 'border-zinc-600' : 'border-zinc-700';
  const dropdownText = isLight ? 'text-gray-900' : 'text-gray-100';
  const dropdownFocus = isLight ? 'focus:border-cyan-500 focus:ring-cyan-200/30' : 'focus:border-cyan-500/50 focus:ring-cyan-500/20';
  const labelClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-400' : 'text-gray-500';
  const chipBg = isLight ? 'bg-gray-100 hover:bg-gray-200 border-gray-200 hover:border-cyan-400/50 text-gray-700 hover:text-gray-900' : 'bg-zinc-800/80 hover:bg-zinc-700 border-zinc-700 hover:border-cyan-500/30 text-gray-300 hover:text-white';
  const breadcrumbText = isLight ? 'text-gray-900' : 'text-white';
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ users: [], spots: [], posts: [] });
  const [trending, setTrending] = useState({ live_photographers: [], popular_spots: [], trending_posts: [] });
  const [spotConditions, setSpotConditions] = useState({});
  const [activeTab, setActiveTab] = useState('all');
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rs-recent-searches') || '[]'); } catch { return []; }
  });
  
  // Tabs carousel refs and state
  const tabsContainerRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  // Swipe-to-navigate state for mobile tab switching
  const swipeStartXRef = useRef(0);
  const swipeStartYRef = useRef(0);
  const swipeActiveRef = useRef(false);
  const swipeDragRef = useRef(0);
  const swipeLockedRef = useRef(false);
  const exploreContentRef = useRef(null);
  const [isAnimating, setIsAnimating] = useState(false);
  
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
  // Archive sub-tabs: 'today' | 'yesterday' | 'archives'
  const [conditionsSubTab, setConditionsSubTab] = useState('today');
  const [archiveDate, setArchiveDate] = useState(null);
  const [archiveDates, setArchiveDates] = useState([]);
  const [archiveGalleries, setArchiveGalleries] = useState([]);
  const [archiveGalleriesLoading, setArchiveGalleriesLoading] = useState(false);
  // Conditions location hierarchy state (shared across all sub-tabs)
  const [conditionsCountry, setConditionsCountry] = useState('');
  const [conditionsState, setConditionsState] = useState('');
  const [conditionsCity, setConditionsCity] = useState('');
  const [conditionsLocMode, setConditionsLocMode] = useState('browse'); // 'browse' | 'nearby'
  
  // Trending Waves state
  const [trendingWaves, setTrendingWaves] = useState([]);
  const [recentWaves, setRecentWaves] = useState([]);
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
  
  // Dropdown-based location selection
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');

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

  // Static Open Graph meta tags for Explore page social sharing
  useEffect(() => {
    const ogTags = [];
    const setMeta = (property, content) => {
      if (!content) return;
      let tag = document.querySelector(`meta[property="${property}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('property', property);
        document.head.appendChild(tag);
        ogTags.push(tag);
      }
      tag.setAttribute('content', content);
    };
    document.title = 'Explore � Raw Surf';
    setMeta('og:title', 'Explore � Raw Surf');
    setMeta('og:description', 'Discover surf spots, live photographers, trending posts, and real-time conditions on Raw Surf.');
    setMeta('og:url', `${window.location.origin}/explore`);
    setMeta('og:type', 'website');
    setMeta('og:site_name', 'Raw Surf');
    return () => {
      document.title = 'Raw Surf';
      ogTags.forEach(tag => tag.remove());
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'sponsors') {
      fetchLeaderboard();
    }
    if (activeTab === 'conditions') {
      fetchConditionReports();
      fetchConditionsRegions();
      fetchLocationHierarchy(); // Load hierarchy for conditions location picker
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

  // Auto-scroll the active pill button into view whenever activeTab changes (e.g. after swipe)
  useEffect(() => {
    const container = tabsContainerRef.current;
    if (!container) return;
    // Find the active button by data-testid
    const activeBtn = container.querySelector(`[data-testid="tab-${activeTab}"]`);
    if (activeBtn) {
      activeBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
    // Update arrows after scroll settles
    setTimeout(updateArrowVisibility, 350);
  }, [activeTab, updateArrowVisibility]);

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
  
  // Fetch Trending + Recent Waves for Explore
  const fetchTrendingWaves = async () => {
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
      const conditionsData = response.data.conditions || {};
      const conditionsMap = {};
      Object.entries(conditionsData).forEach(([spotId, data]) => {
        conditionsMap[spotId] = { spot_id: spotId, wave_height_ft: data.wave_height_ft, conditions_label: data.label, ...data };
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

  // Fetch condition reports for Conditions tab (supports date_filter + location hierarchy)
  // ============ CONDITIONS/LOCATION HANDLERS ============
  // Extracted to hooks/useExploreConditions.js (431 lines)
  const {
    fetchConditionReports, fetchArchiveDates, fetchArchiveGalleries,
    handleConditionsSubTabChange, handleArchiveDateSelect,
    fetchConditionsRegions, handleRegionChange,
    handleConditionsCountryChange, handleConditionsStateChange, handleConditionsCityChange,
    fetchSurfSpots, handleSpotsRegionChange,
    fetchLocationHierarchy, fetchNearbySpots,
    handleCountryChange, handleStateChange, handleCityChange,
    activateNearbyMode, clearConditionsLocation, jumpToConditionsLocation,
    getReportsNearby, conditionsCityOptions, conditionsStateOptions,
    conditionsCountryOptions, cityOptions, stateOptions, countryOptions,
  } = useExploreConditions({
    user, locationHierarchy, userLocation, nearbyRadius,
    conditionsSubTab, selectedRegion,
    conditionsCountry, conditionsState, conditionsCity,
    selectedSpotsRegion, selectedCountry, selectedState, selectedCity,
    discoveryMode, archiveDate,
    setConditionReports, setConditionsLoading,
    setArchiveDates, setArchiveDate,
    setArchiveGalleries, setArchiveGalleriesLoading,
    setConditionsSubTab, setConditionsLocMode,
    setConditionsRegions, setShowRegionDropdown,
    setConditionsCountry, setConditionsState, setConditionsCity,
    setSurfSpots, setSurfSpotsLoading, setSurfSpotsRegions,
    setSelectedSpotsRegion, setShowSpotsRegionDropdown,
    setLocationHierarchy, setLocationHierarchyLoading,
    setNearbySpots, setNearbyLoading, setUserLocation,
    setSelectedRegion, setSelectedCountry, setSelectedState, setSelectedCity,
    setDiscoveryMode,
  });
  
  // Country flag emoji helper
  const getCountryFlag = (countryName) => {
    const flags = {
      'USA': '🇺🇸',
      'United States': '🇺🇸',
      'Australia': '🇦🇺',
      'Indonesia': '🇮🇩',
      'Brazil': '🇧🇷',
      'Portugal': '🇵🇹',
      'South Africa': '🇿🇦',
      'France': '🇫🇷',
      'Spain': '🇪🇸',
      'Mexico': '🇲🇽',
      'Costa Rica': '🇨🇷',
      'Japan': '🇯🇵',
      'New Zealand': '🇳🇿',
      'Peru': '🇵🇪',
      'Morocco': '🇲🇦',
      'United Kingdom': '🇬🇧',
      'UK': '🇬🇧',
      'Canada': '🇨🇦',
      'Chile': '🇨🇱',
      'Hawaii': '🏝️',
      'Fiji': '🇫🇯',
      'French Polynesia': '🇵🇫',
      'Tahiti': '🇵🇫',
      'Maldives': '🇲🇻',
      'Philippines': '🇵🇭',
      'Sri Lanka': '🇱🇰',
      'Nicaragua': '🇳🇮',
      'Panama': '🇵🇦',
      'El Salvador': '🇸🇻',
      'Ecuador': '🇪🇨',
      'Ireland': '🇮🇪',
      'Italy': '🇮🇹',
      'Thailand': '🇹🇭',
      'Colombia': '🇨🇴',
      'Dominican Republic': '🇩🇴',
      'Puerto Rico': '🇵🇷',
      'Cuba': '🇨🇺',
      'Jamaica': '🇯🇲',
      'Barbados': '🇧🇧',
      'Bahamas': '🇧🇸',
      'Bermuda': '🇧🇲',
      'Taiwan': '🇹🇼',
      'China': '🇨🇳',
      'India': '🇮🇳',
      'Vietnam': '🇻🇳',
      'Samoa': '🇼🇸',
      'Tonga': '🇹🇴',
      'Angola': '🇦🇴',
      'Senegal': '🇸🇳',
      'Ghana': '🇬🇭',
      'Madagascar': '🇲🇬',
      'Mozambique': '🇲🇿',
      'Namibia': '🇳🇦',
      'Guatemala': '🇬🇹',
      'Honduras': '🇭🇳',
      'Argentina': '🇦🇷',
      'Uruguay': '🇺🇾',
      'Israel': '🇮🇱',
      'Malaysia': '🇲🇾',
      'Vanuatu': '🇻🇺',
      'Papua New Guinea': '🇵🇬',
      'Solomon Islands': '🇸🇧',
      'Saudi Arabia': '🇸🇦',
      'United Arab Emirates': '🇦🇪',
      'Oman': '🇴🇲',
      'Qatar': '🇶🇦',
      'Norway': '🇳🇴',
      'Iceland': '🇮🇸',
      'Aruba': '🇦🇼',
      'Curacao': '🇨🇼',
      'Trinidad & Tobago': '🇹🇹',
      'Mauritius': '🇲🇺',
      'Cape Verde': '🇨🇻',
      'Cook Islands': '🇨🇰'
    };
    return flags[countryName] || '🌍';
  };
  
  // Popular quick-access locations � uses 'USA' to match DB country name
  const popularLocations = [
    { label: '🇺🇸 Florida', country: 'USA', state: 'Florida' },
    { label: '🇺🇸 California', country: 'USA', state: 'California' },
    { label: '🇺🇸 Hawaii', country: 'USA', state: 'Hawaii' },
    { label: '🇺🇸 North Carolina', country: 'USA', state: 'North Carolina' },
    { label: '🇦🇺 Australia', country: 'Australia' },
    { label: '🇮🇩 Indonesia', country: 'Indonesia' },
    { label: '🇧🇷 Brazil', country: 'Brazil' },
    { label: '🇵🇹 Portugal', country: 'Portugal' },
    { label: '🇨🇷 Costa Rica', country: 'Costa Rica' },
    { label: '🇲🇽 Mexico', country: 'Mexico' },
    { label: '🇿🇦 South Africa', country: 'South Africa' },
    { label: '🇯🇵 Japan', country: 'Japan' },
  ];
  
  // Quick jump to a popular location
  const jumpToLocation = (loc) => {
    setDiscoveryMode('browse');
    setSelectedCountry(loc.country);
    setSelectedState(loc.state || '');
    setSelectedCity('');
    setSurfSpots([]);
    if (loc.state) {
      const country = locationHierarchy?.countries?.find(c => c.name === loc.country);
      const state = country?.states?.find(s => s.name === loc.state);
      const cities = state?.cities || [];
      if (cities.length === 0) {
        fetchSurfSpots(null, null, { country: loc.country, state_province: loc.state });
      }
    } else {
      const country = locationHierarchy?.countries?.find(c => c.name === loc.country);
      const realStates = country?.states?.filter(s => !s.is_virtual) || [];
      if (realStates.length === 0) {
        fetchSurfSpots(null, null, { country: loc.country });
      }
    }
  };

  const tabs = [
    { id: 'all', label: 'All', icon: Search },
    { id: 'waves', label: 'Waves', icon: Play },
    { id: 'posts', label: 'Posts', icon: Image },
    { id: 'trending', label: 'Trending', icon: Hash },
    { id: 'users', label: 'People', icon: Users },
    { id: 'conditions', label: 'Reports', icon: Waves },
    { id: 'sponsors', label: 'Sponsors', icon: Heart },
    { id: 'surfspots', label: 'Surf Spots', icon: Navigation },
  ];

  const hasResults = searchResults.users.length > 0 || searchResults.spots.length > 0 || searchResults.posts.length > 0;
  const showResults = searchQuery.trim().length >= 2;

  return (
    <div className="max-w-2xl mx-auto p-4" data-testid="explore-page">
      {/* JSON-LD ItemList for live photographers and popular spots */}
      {trending.live_photographers?.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'Live Surf Photographers on Raw Surf',
          itemListOrder: 'https://schema.org/ItemListOrderDescending',
          numberOfItems: trending.live_photographers.length,
          itemListElement: trending.live_photographers.slice(0, 10).map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            item: {
              '@type': 'Person',
              name: p.full_name || p.username,
              url: `${window.location.origin}/gallery/${p.username}`,
              ...(p.avatar_url && { image: p.avatar_url }),
              jobTitle: 'Surf Photographer',
            },
          })),
        }) }} />
      )}
      {/* Search Bar */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input aria-label="Search surfers, photographers, spots..."
          type="text"
          placeholder="Search surfers, photographers, spots..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
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

      {/* Recent Searches Dropdown */}
      {isSearchFocused && !searchQuery && recentSearches.length > 0 && (
        <div className={`mb-4 p-3 rounded-xl border ${isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-700'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-medium ${isLight ? 'text-gray-500' : 'text-zinc-400'}`}>Recent searches</span>
            <button
              onClick={() => { setRecentSearches([]); localStorage.removeItem('rs-recent-searches'); }}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
              aria-label="Clear recent searches"
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recentSearches.map((term, i) => (
              <button
                key={i}
                onClick={() => setSearchQuery(term)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  isLight
                    ? 'bg-gray-100 text-gray-700 hover:bg-cyan-50 hover:text-cyan-700'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-cyan-500/20 hover:text-cyan-400'
                }`}
              >
                {term}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search Tabs - Horizontally scrollable with arrow navigation */}
      <div className="flex items-center gap-2 mb-6">
        {/* Left Arrow - inline, fades when not needed */}
        <button aria-label="Previous"
          onClick={() => scrollTabs('left')}
          className={`flex-shrink-0 w-8 h-8 rounded-full bg-zinc-800 border border-zinc-600 shadow-lg flex items-center justify-center text-white hover:bg-zinc-700 transition-all ${
            showLeftArrow ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          data-testid="tabs-scroll-left"
          aria-label="Scroll tabs left"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        
        {/* Tabs Container � Yellow pill buttons */}
        <div 
          ref={tabsContainerRef} role="tablist" aria-label="Explore sections"
          className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide scroll-smooth flex-1 scrollbar-none"
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button aria-label="Icon"
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
        <button aria-label="Next"
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
                            <img loading="lazy" decoding="async" src={getFullUrl(user.avatar_url)} alt={user.full_name} className="w-full h-full object-cover" />
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
                              <Badge className="bg-blue-500 text-[10px] px-1.5">?</Badge>
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
                  <div className="space-y-2">
                    {searchResults.spots.map((spot) => (
                      <div
                        key={spot.id}
                        onClick={() => navigate(`/spot-hub/${spot.id}`)}
                        className="flex items-center gap-3 p-3 bg-card rounded-xl hover:bg-muted cursor-pointer transition-colors group"
                        data-testid={`spot-result-${spot.id}`}
                      >
                        {/* Thumbnail */}
                        <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                          {spot.image_url ? (
                            <img loading="lazy" decoding="async" 
                              src={getFullUrl(spot.image_url)} 
                              alt={spot.name} 
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                e.target.parentElement.classList.add('bg-gradient-to-br', 'from-cyan-600', 'to-blue-800');
                                e.target.parentElement.innerHTML = '<div class="w-full h-full flex items-center justify-center"><svg class="w-5 h-5 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg></div>';
                              }}
                            />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-cyan-600 to-blue-800 flex items-center justify-center">
                              <MapPin className="w-5 h-5 text-white/50" />
                            </div>
                          )}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-foreground truncate">{spot.name}</h4>
                          <p className="text-xs text-muted-foreground truncate">
                            {[spot.secondary_city, spot.region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' � ')}
                          </p>
                          {spot.difficulty && (
                            <span className={`inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              spot.difficulty === 'Beginner' ? 'bg-green-500/20 text-green-400' :
                              spot.difficulty === 'Intermediate' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-red-500/20 text-red-400'
                            }`}>
                              {spot.difficulty}
                            </span>
                          )}
                        </div>
                        {/* Arrow */}
                        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
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

      {/* Tab content � swipeable on mobile */}
      <div
        className="relative overflow-hidden"
        onTouchStart={(e) => {
          if (isAnimating) return;
          swipeStartXRef.current = e.touches[0].clientX;
          swipeStartYRef.current = e.touches[0].clientY;
          swipeActiveRef.current = true;
          swipeLockedRef.current = false;
          swipeDragRef.current = 0;
          if (exploreContentRef.current) {
            exploreContentRef.current.style.transition = 'none';
          }
        }}
        onTouchMove={(e) => {
          if (!swipeActiveRef.current || isAnimating) return;
          const dx = e.touches[0].clientX - swipeStartXRef.current;
          const dy = e.touches[0].clientY - swipeStartYRef.current;
          if (!swipeLockedRef.current) {
            if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
              swipeActiveRef.current = false;
              if (exploreContentRef.current) {
                exploreContentRef.current.style.transform = '';
                exploreContentRef.current.style.transition = '';
              }
              return;
            }
            if (Math.abs(dx) > 10) {
              swipeLockedRef.current = true;
            } else {
              return;
            }
          }
          e.preventDefault();
          const tabIds = tabs.map(t => t.id);
          const currentIdx = tabIds.indexOf(activeTab);
          const atEdge = (dx > 0 && currentIdx === 0) || (dx < 0 && currentIdx === tabIds.length - 1);
          const dampened = atEdge ? dx * 0.2 : dx;
          swipeDragRef.current = dampened;
          if (exploreContentRef.current) {
            exploreContentRef.current.style.transform = `translateX(${dampened}px)`;
            const progress = Math.min(Math.abs(dampened) / 200, 1);
            exploreContentRef.current.style.opacity = `${1 - progress * 0.15}`;
          }
        }}
        onTouchEnd={() => {
          if (!swipeActiveRef.current || isAnimating) {
            swipeActiveRef.current = false;
            return;
          }
          swipeActiveRef.current = false;
          const dragX = swipeDragRef.current;
          const MIN_SWIPE = 50;
          const tabIds = tabs.map(t => t.id);
          const currentIdx = tabIds.indexOf(activeTab);
          if (Math.abs(dragX) >= MIN_SWIPE && swipeLockedRef.current) {
            const goingLeft = dragX < 0;
            const nextIdx = goingLeft ? currentIdx + 1 : currentIdx - 1;
            if (nextIdx >= 0 && nextIdx < tabIds.length) {
              setIsAnimating(true);
              if (exploreContentRef.current) {
                exploreContentRef.current.style.transition = 'transform 0.22s ease-out, opacity 0.22s ease-out';
                exploreContentRef.current.style.transform = `translateX(${goingLeft ? '-100%' : '100%'})`;
                exploreContentRef.current.style.opacity = '0';
              }
              setTimeout(() => {
                setActiveTab(tabIds[nextIdx]);
                if (exploreContentRef.current) {
                  exploreContentRef.current.style.transition = 'none';
                  exploreContentRef.current.style.transform = `translateX(${goingLeft ? '60%' : '-60%'})`;
                  exploreContentRef.current.style.opacity = '0.5';
                }
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    if (exploreContentRef.current) {
                      exploreContentRef.current.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out';
                      exploreContentRef.current.style.transform = 'translateX(0)';
                      exploreContentRef.current.style.opacity = '1';
                    }
                    setTimeout(() => {
                      setIsAnimating(false);
                      if (exploreContentRef.current) {
                        exploreContentRef.current.style.transition = '';
                        exploreContentRef.current.style.transform = '';
                        exploreContentRef.current.style.opacity = '';
                      }
                    }, 260);
                  });
                });
              }, 200);
              return;
            }
          }
          // Snap back
          if (exploreContentRef.current) {
            exploreContentRef.current.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
            exploreContentRef.current.style.transform = 'translateX(0)';
            exploreContentRef.current.style.opacity = '1';
            setTimeout(() => {
              if (exploreContentRef.current) {
                exploreContentRef.current.style.transition = '';
                exploreContentRef.current.style.transform = '';
                exploreContentRef.current.style.opacity = '';
              }
            }, 220);
          }
        }}
      >
      <div ref={exploreContentRef} className="will-change-transform">

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
                            <img loading="lazy" decoding="async" src={getFullUrl(user.avatar_url)} alt={user.full_name} className="w-full h-full object-cover" />
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
                        <img loading="lazy" decoding="async" 
                          src={displayImage} 
                          alt={spot.name} 
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform" 
                          onError={(e) => {
                            // If primary image fails, try map fallback
                            if (spot.latitude && spot.longitude) {
                              e.target.onerror = () => {
                                // Map also failed � show gradient
                                e.target.style.display = 'none';
                                e.target.parentElement.classList.add('bg-gradient-to-br', 'from-cyan-600', 'to-blue-800');
                              };
                              e.target.src = `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${spot.longitude},${spot.latitude}&z=12&l=sat&size=400,300`;
                              e.target.className = 'w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity';
                            } else {
                              e.target.style.display = 'none';
                              e.target.parentElement.classList.add('bg-gradient-to-br', 'from-cyan-600', 'to-blue-800');
                            }
                          }}
                        />
                      ) : spot.latitude && spot.longitude ? (
                        // Map fallback with location pin
                        <div className="w-full h-full bg-muted relative">
                          <img loading="lazy" decoding="async" 
                            src={`https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${spot.longitude},${spot.latitude}&z=12&l=sat&size=400,300`}
                            alt={`Map of ${spot.name}`}
                            className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity"
                            onError={(e) => {
                              e.target.style.display = 'none';
                              e.target.parentElement.classList.add('bg-gradient-to-br', 'from-cyan-600', 'to-blue-800');
                            }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <MapPin className="w-8 h-8 text-cyan-400 drop-shadow-lg" />
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-cyan-600 to-blue-800 flex items-center justify-center">
                          <MapPin className="w-8 h-8 text-white/30" />
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
                              <img loading="lazy" decoding="async" 
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

      {/* People Tab � pre-search discovery state */}
      {activeTab === 'users' && (
        <div className="space-y-6" data-testid="people-tab">
          {/* Search Prompt */}
          <div className={`text-center py-8 rounded-2xl ${isLight ? 'bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200/60' : 'bg-gradient-to-br from-zinc-800/80 to-zinc-900/60 border border-zinc-700/50'}`}>
            <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${isLight ? 'bg-amber-100' : 'bg-zinc-700'}`}>
              <Users className={`w-8 h-8 ${isLight ? 'text-amber-600' : 'text-yellow-400'}`} />
            </div>
            <h3 className={`text-lg font-bold mb-1 ${isLight ? 'text-gray-900' : 'text-foreground'}`}>Find People</h3>
            <p className={`text-sm mb-5 ${isLight ? 'text-gray-500' : 'text-muted-foreground'}`}>
              Search for surfers, photographers, and creators
            </p>
            <button aria-label="Search"
              onClick={() => {
                const input = document.querySelector('[data-testid="explore-search-input"]');
                if (input) input.focus();
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 text-black font-semibold text-sm hover:from-yellow-500 hover:to-amber-600 transition-all shadow-lg shadow-yellow-500/20"
            >
              <Search className="w-4 h-4" />
              Search People
            </button>
          </div>

          {/* Quick Categories */}
          <div>
            <h4 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${isLight ? 'text-gray-500' : 'text-muted-foreground'}`}>Browse by Role</h4>
            <div className="flex flex-wrap gap-2">
              {[
                { label: '📸 Photographers', query: 'photographer' },
                { label: '🏄 Surfers', query: 'surfer' },
                { label: '🎬 Videographers', query: 'videographer' },
                { label: '📍 Locals', query: 'local' },
              ].map(cat => (
                <button
                  key={cat.query}
                  onClick={() => {
                    setSearchQuery(cat.query);
                    const input = document.querySelector('[data-testid="explore-search-input"]');
                    if (input) { input.value = cat.query; input.focus(); }
                  }}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${isLight ? 'bg-white border border-gray-200 text-gray-700 hover:border-amber-400 hover:bg-amber-50' : 'bg-zinc-800 border border-zinc-700 text-gray-300 hover:border-yellow-500/50 hover:bg-zinc-700'}`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Featured Community � reuse live photographers from trending */}
          {trending.live_photographers?.length > 0 && (
            <div>
              <h4 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${isLight ? 'text-gray-500' : 'text-muted-foreground'}`}>
                <span className="inline-flex items-center gap-1.5"><Radio className="w-3.5 h-3.5 text-red-500 animate-pulse" /> Live Now</span>
              </h4>
              <div className="space-y-2">
                {trending.live_photographers.slice(0, 5).map(person => (
                  <div
                    key={person.id}
                    onClick={() => navigate(`/profile/${person.id}`)}
                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${isLight ? 'bg-white border border-gray-100 hover:bg-amber-50' : 'bg-card hover:bg-muted'}`}
                  >
                    <div className="w-12 h-12 rounded-full bg-gradient-to-r from-red-500 to-orange-500 p-0.5 flex-shrink-0">
                      <div className={`w-full h-full rounded-full p-0.5 ${isLight ? 'bg-white' : 'bg-card'}`}>
                        <div className="w-full h-full rounded-full bg-zinc-700 flex items-center justify-center overflow-hidden">
                          {person.avatar_url ? (
                            <img loading="lazy" decoding="async" src={getFullUrl(person.avatar_url)} alt={person.full_name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-lg font-medium text-muted-foreground">{person.full_name?.[0] || '?'}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`font-medium truncate block ${isLight ? 'text-gray-900' : 'text-foreground'}`}>{person.full_name}</span>
                      <span className="text-sm text-muted-foreground">{person.role || 'Community Member'}</span>
                    </div>
                    <Badge className="bg-red-500 text-[10px] px-1.5 animate-pulse">LIVE</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Popular Spots as people discovery hint */}
          {trending.popular_spots?.length > 0 && (
            <div>
              <h4 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${isLight ? 'text-gray-500' : 'text-muted-foreground'}`}>
                People Near Popular Spots
              </h4>
              <div className="flex flex-wrap gap-2">
                {trending.popular_spots.slice(0, 6).map(spot => (
                  <button aria-label="Location"
                    key={spot.id}
                    onClick={() => navigate(`/spot-hub/${spot.id}`)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${isLight ? 'bg-cyan-50 border border-cyan-200 text-cyan-700 hover:bg-cyan-100' : 'bg-cyan-900/20 border border-cyan-800/40 text-cyan-400 hover:bg-cyan-900/40'}`}
                  >
                    <MapPin className="w-3 h-3" />
                    {spot.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search (Spots) Tab � pre-search discovery state */}
      {/* "Search" tab removed - redundant with Surf Spots tab */}

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
            <button aria-label="Globe"
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
            <button aria-label="Explore"
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
          
          {/* ============ BROWSE MODE (extracted ? explore/BrowseMode.js) ============ */}
          {discoveryMode === 'browse' && (
            <BrowseMode
              selectedCountry={selectedCountry}
              selectedState={selectedState}
              selectedCity={selectedCity}
              countryOptions={countryOptions}
              stateOptions={stateOptions}
              cityOptions={cityOptions}
              handleCountryChange={handleCountryChange}
              handleStateChange={handleStateChange}
              handleCityChange={handleCityChange}
              jumpToLocation={jumpToLocation}
              spotSearchQuery={spotSearchQuery}
              setSpotSearchQuery={setSpotSearchQuery}
              surfSpots={surfSpots}
              surfSpotsLoading={surfSpotsLoading}
              popularLocations={popularLocations}
              user={user}
              isLight={isLight}
              getCountryFlag={getCountryFlag}
              dropdownBg={dropdownBg}
              dropdownBorder={dropdownBorder}
              dropdownText={dropdownText}
              dropdownFocus={dropdownFocus}
              labelClass={labelClass}
              chipBg={chipBg}
              breadcrumbText={breadcrumbText}
              setSurfSpots={setSurfSpots}
              setSelectedCountry={setSelectedCountry}
              setSelectedState={setSelectedState}
              setSelectedCity={setSelectedCity}
            />
          )}
          
          {/* ============ NEARBY MODE (extracted ? explore/NearbyMode.js) ============ */}
          {discoveryMode === 'nearby' && (
            <NearbyMode
              userLocation={userLocation}
              nearbySpots={nearbySpots}
              nearbyLoading={nearbyLoading}
              spotSearchQuery={spotSearchQuery}
              user={user}
              fetchNearbySpots={fetchNearbySpots}
              setDiscoveryMode={setDiscoveryMode}
              activateNearbyMode={activateNearbyMode}
            />
          )}
          
          {/* Map View CTA � always visible */}
          <div className="mt-6">
            <button aria-label="Location"
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

      {/* Waves Tab - Reels-Style Vertical Scroll Feed */}
      {activeTab === 'waves' && (
        <div className="space-y-0" data-testid="waves-tab">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Play className="w-5 h-5 text-cyan-400" />
              <h2 className="font-bold text-foreground">Waves</h2>
            </div>
            <button aria-label="Next"
              onClick={() => navigate('/feed?tab=waves')}
              className="text-sm text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
            >
              View All
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          
          {/* Loading / Empty / Feed */}
          {wavesLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            </div>
          ) : trendingWaves.length === 0 && recentWaves.length === 0 ? (
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
            /* Reels-style vertical snap-scroll feed */
            <div
              className="explore-waves-feed"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                maxWidth: '420px',
                margin: '0 auto',
              }}
            >
              {/* Merge trending + recent, deduplicated */}
              {[...trendingWaves, ...recentWaves].map((wave) => (
                <div
                  key={wave.id}
                  onClick={() => handleWaveClick(wave)}
                  className="group cursor-pointer"
                  data-testid={`wave-card-${wave.id}`}
                  style={{
                    position: 'relative',
                    aspectRatio: '9 / 16',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    background: '#000',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
                  }}
                >
                  {/* Video/Thumbnail */}
                  <PostMediaPreview post={wave} isHoverScale={false} />
                  
                  {/* Play button overlay (center) */}
                  <div
                    className="absolute inset-0 flex items-center justify-center z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                    style={{ pointerEvents: 'none' }}
                  >
                    <div style={{
                      width: '56px',
                      height: '56px',
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.5)',
                      backdropFilter: 'blur(8px)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <Play className="w-6 h-6 text-white" fill="white" />
                    </div>
                  </div>
                  
                  {/* Bottom gradient overlay */}
                  <div
                    className="absolute inset-0 z-10"
                    style={{
                      background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.3) 25%, transparent 50%)',
                      pointerEvents: 'none',
                    }}
                  />
                  
                  {/* Right-side action buttons (Reels-style) */}
                  <div
                    className="absolute right-3 z-20"
                    style={{
                      bottom: '80px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '16px',
                      pointerEvents: 'none',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <div style={{
                        width: '40px', height: '40px', borderRadius: '50%',
                        background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Heart className="w-5 h-5 text-white" />
                      </div>
                      <span style={{ color: 'white', fontSize: '11px', fontWeight: '600' }}>
                        {wave.likes_count || 0}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <div style={{
                        width: '40px', height: '40px', borderRadius: '50%',
                        background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Play className="w-5 h-5 text-white" />
                      </div>
                      <span style={{ color: 'white', fontSize: '11px', fontWeight: '600' }}>
                        {wave.view_count || 0}
                      </span>
                    </div>
                  </div>
                  
                  {/* Bottom info bar (author + caption) */}
                  <div
                    className="absolute bottom-0 left-0 right-0 z-20 p-4"
                    style={{ pointerEvents: 'none' }}
                  >
                    {/* Author row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      {wave.author_avatar ? (
                        <img loading="lazy" decoding="async"
                          src={wave.author_avatar}
                          alt={wave.author_name}
                          style={{
                            width: '32px', height: '32px', borderRadius: '50%',
                            border: '2px solid rgba(255,255,255,0.6)',
                            objectFit: 'cover',
                          }}
                        />
                      ) : (
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '50%',
                          background: 'rgba(255,255,255,0.2)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '14px', fontWeight: '600', color: 'white',
                        }}>
                          {(wave.author_name || '?')[0]}
                        </div>
                      )}
                      <span style={{
                        color: 'white', fontWeight: '600', fontSize: '14px',
                        textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                      }}>
                        @{wave.author_username || wave.author_name?.split(' ')[0]?.toLowerCase()}
                      </span>
                    </div>
                    
                    {/* Caption */}
                    {wave.caption && (
                      <p style={{
                        color: 'rgba(255,255,255,0.9)', fontSize: '13px',
                        lineHeight: '1.4', maxHeight: '40px', overflow: 'hidden',
                        textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                      }}>
                        {wave.caption.length > 80 ? wave.caption.slice(0, 80) + '...' : wave.caption}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              
              {/* Load more / View all CTA */}
              <button
                onClick={() => navigate('/feed?tab=waves')}
                style={{
                  width: '100%',
                  padding: '14px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(6,182,212,0.15), rgba(59,130,246,0.15))',
                  border: '1px solid rgba(6,182,212,0.25)',
                  color: 'rgb(6,182,212)',
                  fontWeight: '600',
                  fontSize: '14px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'all 0.2s',
                  marginTop: '8px',
                }}
                className="hover:bg-cyan-500/20"
              >
                <Play className="w-4 h-4" />
                View All Waves
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
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
            <button aria-label="Next"
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

      {/* Trending Hashtags Tab (extracted ? explore/HashtagsTab.js) */}
      {activeTab === 'trending' && (
        <HashtagsTab
          trendingHashtags={trendingHashtags}
          selectedHashtag={selectedHashtag}
          hashtagPosts={hashtagPosts}
          hashtagLoading={hashtagLoading}
          handleHashtagClick={handleHashtagClick}
          setSelectedHashtag={setSelectedHashtag}
          setHashtagPosts={setHashtagPosts}
          navigate={navigate}
        />
      )}

      {/* Conditions/Reports Tab - 3-tab layout: Today / Yesterday / Archives */}
      {activeTab === 'conditions' && (
        <div className="space-y-4" data-testid="conditions-explorer-tab">
          {/* Sub-tab navigation pills */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-1">
            {[
              { id: 'today', label: 'Today', icon: Radio },
              { id: 'yesterday', label: 'Yesterday', icon: Clock },
              { id: 'archives', label: 'Archives', icon: Archive },
            ].map(({ id, label, icon: Icon }) => (
              <button aria-label="Icon"
                key={id}
                onClick={() => handleConditionsSubTabChange(id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${
                  conditionsSubTab === id
                    ? 'bg-cyan-500/20 text-cyan-400 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-zinc-700/50'
                }`}
                data-testid={`conditions-subtab-${id}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                {id === 'today' && conditionsSubTab === 'today' && conditionReports.some(r => r.is_photographer_live) && (
                  <span className="ml-0.5 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                )}
              </button>
            ))}
          </div>

          {/* ============ SHARED LOCATION PICKER (all sub-tabs) ============ */}
          
          {/* Header row with title + report count */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Waves className="w-5 h-5 text-cyan-400" />
              <h2 className="font-bold text-foreground">
                {conditionsSubTab === 'today' ? "Today's Reports" 
                  : conditionsSubTab === 'yesterday' ? "Yesterday's Reports" 
                  : "Session Archives"}
              </h2>
              {conditionsSubTab !== 'archives' && (
                <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">
                  {conditionReports.length} reports
                </Badge>
              )}
            </div>
          </div>
          
          {/* Browse / Nearby Toggle */}
          <div className="flex gap-2 p-1 bg-zinc-900 rounded-xl border border-zinc-800">
            <button aria-label="Globe"
              onClick={() => { setConditionsLocMode('browse'); setUserLocation(null); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
                conditionsLocMode === 'browse'
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/20'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-zinc-800'
              }`}
              data-testid="conditions-browse-btn"
            >
              <Globe className="w-4 h-4" />
              Browse
            </button>
            <button aria-label="Explore"
              onClick={getReportsNearby}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
                conditionsLocMode === 'nearby'
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-zinc-800'
              }`}
              data-testid="conditions-nearby-btn"
            >
              <Compass className="w-4 h-4" />
              Nearby
              {userLocation && conditionsLocMode === 'nearby' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            </button>
          </div>
          
          {/* Hierarchical Location Dropdowns (Browse mode) */}
          {conditionsLocMode === 'browse' && (
            <div className="space-y-3">
              {/* Country Dropdown */}
              <div>
                <label className={`block text-xs uppercase tracking-wider font-medium mb-1.5 ${labelClass}`}>Country</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400 pointer-events-none z-10" />
                  <select
                    value={conditionsCountry}
                    onChange={(e) => handleConditionsCountryChange(e.target.value)}
                    className={`w-full pl-10 pr-10 py-3 ${dropdownBg} border ${dropdownBorder} rounded-xl ${dropdownText} text-sm focus:outline-none ${dropdownFocus} focus:ring-1 transition-all appearance-none cursor-pointer`}
                    data-testid="conditions-country-dropdown"
                  >
                    <option value="">All Countries</option>
                    {conditionsCountryOptions.map(name => (
                      <option key={name} value={name}>{getCountryFlag(name)} {name}</option>
                    ))}
                  </select>
                  <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-500'} pointer-events-none`} />
                </div>
              </div>
              
              {/* State/Province Dropdown */}
              {conditionsCountry && conditionsStateOptions.length > 0 && (
                <div>
                  <label className={`block text-xs uppercase tracking-wider font-medium mb-1.5 ${labelClass}`}>State / Province</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 pointer-events-none z-10" />
                    <select
                      value={conditionsState}
                      onChange={(e) => handleConditionsStateChange(e.target.value)}
                      className={`w-full pl-10 pr-10 py-3 ${dropdownBg} border ${dropdownBorder} rounded-xl ${dropdownText} text-sm focus:outline-none ${isLight ? 'focus:border-blue-500 focus:ring-blue-200/30' : 'focus:border-blue-500/50 focus:ring-blue-500/20'} focus:ring-1 transition-all appearance-none cursor-pointer`}
                      data-testid="conditions-state-dropdown"
                    >
                      <option value="">All States</option>
                      {conditionsStateOptions.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-500'} pointer-events-none`} />
                  </div>
                </div>
              )}
              
              {/* City/Area Dropdown */}
              {conditionsState && conditionsCityOptions.length > 0 && (
                <div>
                  <label className={`block text-xs uppercase tracking-wider font-medium mb-1.5 ${labelClass}`}>City / Area</label>
                  <div className="relative">
                    <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400 pointer-events-none z-10" />
                    <select
                      value={conditionsCity}
                      onChange={(e) => handleConditionsCityChange(e.target.value)}
                      className={`w-full pl-10 pr-10 py-3 ${dropdownBg} border ${dropdownBorder} rounded-xl ${dropdownText} text-sm focus:outline-none ${isLight ? 'focus:border-emerald-500 focus:ring-emerald-200/30' : 'focus:border-emerald-500/50 focus:ring-emerald-500/20'} focus:ring-1 transition-all appearance-none cursor-pointer`}
                      data-testid="conditions-city-dropdown"
                    >
                      <option value="">All Cities</option>
                      {conditionsCityOptions.map(name => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-500'} pointer-events-none`} />
                  </div>
                </div>
              )}
              
              {/* Popular Destinations � show when no country selected */}
              {!conditionsCountry && (
                <div>
                  <p className={`text-xs uppercase tracking-wider font-medium mb-2 ${labelClass}`}>Popular Destinations</p>
                  <div className="flex flex-wrap gap-2">
                    {popularLocations.map((loc, i) => (
                      <button
                        key={i}
                        onClick={() => jumpToConditionsLocation(loc)}
                        className={`px-3 py-1.5 border rounded-full text-xs transition-all ${chipBg}`}
                        data-testid={`conditions-quick-loc-${i}`}
                      >
                        {loc.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Selection breadcrumb + Clear */}
              {conditionsCountry && (
                <div className="flex items-center gap-1.5 text-sm flex-wrap">
                  <span className="text-lg">{getCountryFlag(conditionsCountry)}</span>
                  <span className={`${breadcrumbText} font-medium`}>{conditionsCountry}</span>
                  {conditionsState && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
                      <span className={isLight ? 'text-blue-600' : 'text-blue-400'}>{conditionsState}</span>
                    </>
                  )}
                  {conditionsCity && (
                    <>
                      <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
                      <span className={isLight ? 'text-emerald-600' : 'text-emerald-400'}>{conditionsCity}</span>
                    </>
                  )}
                  <button
                    onClick={clearConditionsLocation}
                    className={`ml-auto text-xs flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${isLight ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-500 hover:text-gray-300 hover:bg-zinc-800'}`}
                  >
                    <X className="w-3 h-3" /> Clear
                  </button>
                </div>
              )}
            </div>
          )}
          
          {/* Nearby Mode Indicator */}
          {conditionsLocMode === 'nearby' && userLocation && (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <Compass className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-300">Showing reports sorted by distance from you</span>
              <button
                onClick={clearConditionsLocation}
                className="ml-auto text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            </div>
          )}

          {/* Archives: Date Carousel + Gallery Cards */}
          {conditionsSubTab === 'archives' && (
            <div className="space-y-4">
              
              {/* Scrollable date chips */}
              {archiveDates.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {archiveDates.map((d) => {
                    const dateObj = new Date(d.date + 'T12:00:00Z');
                    const isSelected = archiveDate === d.date;
                    return (
                      <button
                        key={d.date}
                        onClick={() => handleArchiveDateSelect(d.date)}
                        className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                          isSelected
                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                            : 'bg-muted text-gray-400 hover:bg-zinc-700 border border-transparent'
                        }`}
                      >
                        <span className="text-[10px] uppercase opacity-70">
                          {dateObj.toLocaleDateString('en-US', { weekday: 'short' })}
                        </span>
                        <span className="text-sm font-bold">
                          {dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                        <span className="text-[10px] mt-0.5 opacity-60">
                          {d.report_count} {d.report_count === 1 ? 'report' : 'reports'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <Archive className="w-10 h-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No archived reports found</p>
                </div>
              )}

              {/* Archive Gallery Cards */}
              {archiveDate && (
                <>
                  {archiveGalleriesLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
                    </div>
                  ) : archiveGalleries.length > 0 ? (
                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold text-gray-400 flex items-center gap-1.5">
                        <FolderOpen className="w-4 h-4" />
                        Session Galleries
                      </h3>
                      {archiveGalleries.map((gallery) => (
                        <div
                          key={gallery.id}
                          onClick={() => navigate(`/photographer/${gallery.photographer_id}/gallery?gallery=${gallery.id}`)}
                          className="flex items-center gap-3 p-3 bg-muted/50 hover:bg-zinc-700/50 rounded-xl cursor-pointer transition-all group"
                          data-testid={`archive-gallery-${gallery.id}`}
                        >
                          {/* Cover thumbnail */}
                          <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-700">
                            {gallery.cover_image_url ? (
                              <img loading="lazy" decoding="async" 
                                src={gallery.cover_image_url} 
                                alt={gallery.title} 
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Camera className="w-6 h-6 text-zinc-600" />
                              </div>
                            )}
                            <div className="absolute bottom-0.5 right-0.5 bg-black/70 rounded px-1 py-0.5">
                              <span className="text-[9px] font-bold text-white">{gallery.item_count} ??</span>
                            </div>
                          </div>
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <h4 className="font-medium text-foreground text-sm truncate">{gallery.title}</h4>
                              {gallery.session_type && (
                                <span className={`flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                                  gallery.session_type === 'live' ? 'bg-green-500/20 text-green-400' :
                                  gallery.session_type === 'on_demand' ? 'bg-yellow-500/20 text-yellow-400' :
                                  gallery.session_type === 'booking' ? 'bg-purple-500/20 text-purple-400' :
                                  'bg-zinc-500/20 text-zinc-400'
                                }`}>
                                  {gallery.session_type === 'live' ? 'LIVE' :
                                   gallery.session_type === 'on_demand' ? 'ON-DEMAND' :
                                   gallery.session_type === 'booking' ? 'BOOKING' : 'MANUAL'}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                              {gallery.photographer_avatar ? (
                                <img loading="lazy" decoding="async" src={gallery.photographer_avatar} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
                              ) : (
                                <Camera className="w-3.5 h-3.5 text-yellow-400" />
                              )}
                              <span className="truncate">{gallery.photographer_name || 'Photographer'}</span>
                            </div>
                            {gallery.conditions && (
                              <div className="flex items-center gap-1.5 mt-1">
                                {gallery.conditions.wave_height_ft && (
                                  <Badge className="bg-blue-500/20 text-blue-400 text-[10px] py-0 px-1.5">
                                    {gallery.conditions.wave_height_ft}ft
                                  </Badge>
                                )}
                                {gallery.conditions.conditions_label && (
                                  <Badge className="bg-teal-500/20 text-teal-400 text-[10px] py-0 px-1.5">
                                    {gallery.conditions.conditions_label}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-cyan-400 transition-colors flex-shrink-0" />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}

          {/* Report List (shared between today/yesterday/archive-date) */}
          {conditionsLoading ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
            </div>
          ) : conditionReports.length === 0 && conditionsSubTab !== 'archives' ? (
            /* Empty State */
            <div className="text-center py-12 text-muted-foreground">
              <Waves className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium mb-1">
                {conditionsSubTab === 'yesterday' ? "No reports from yesterday" : "No reports from today yet"}
              </p>
              <p className="text-sm text-gray-500">
                {conditionsSubTab === 'yesterday' ? "Check the Archives for older reports" : "Check back when photographers go live!"}
              </p>
            </div>
          ) : conditionReports.length === 0 && conditionsSubTab === 'archives' && archiveDate ? (
            <div className="text-center py-8 text-muted-foreground">
              <Waves className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No reports for this date</p>
            </div>
          ) : conditionReports.length > 0 ? (
            /* Conditions Reports List */
            <div className="space-y-3">
              {conditionsSubTab === 'archives' && archiveDate && (
                <h3 className="text-sm font-semibold text-gray-400 flex items-center gap-1.5">
                  <Waves className="w-4 h-4" />
                  Condition Reports
                </h3>
              )}
              {conditionReports.map((report) => {
                const hasGallery = report.gallery_id && report.gallery_item_count > 0;
                return (
                <div
                  key={report.id}
                  className={`bg-muted/50 rounded-xl overflow-hidden transition-colors ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-700/50'}`}
                  data-testid={`condition-report-${report.id}`}
                >
                  {/* Main card body � clicks to SpotHub */}
                  <div
                    onClick={() => {
                      if (report.spot_id) {
                        navigate(`/spot-hub/${report.spot_id}`);
                      } else {
                        navigate(`/profile/${report.photographer_id}`);
                      }
                    }}
                    className="flex items-center gap-4 p-4 cursor-pointer group"
                  >
                    {/* Thumbnail */}
                    <div className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-700">
                      {(report.thumbnail_url || report.media_url) ? (
                        <img loading="lazy" decoding="async" 
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
                      {/* Live Shooting Indicator */}
                      {report.is_photographer_live && (
                        <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
                      )}
                      {/* Gallery link badge */}
                      {hasGallery && (
                        <div className="absolute top-1 left-1 bg-black/70 backdrop-blur-sm rounded px-1 py-0.5">
                          <span className="text-[9px] font-bold text-cyan-400">?? {report.gallery_item_count}</span>
                        </div>
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
                            <img loading="lazy" decoding="async" 
                              src={report.photographer_avatar} 
                              alt={report.photographer_name} 
                              className="w-4 h-4 rounded-full object-cover"
                            />
                          ) : (
                            <Camera className="w-4 h-4 text-yellow-400" />
                          )}
                          <span className="truncate">{report.photographer_name || 'Photographer'}</span>
                        </div>
                        <span className="text-gray-600">�</span>
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

                  {/* Action buttons row � View Spot always, View Gallery when gallery linked */}
                  <div className={`flex gap-2 px-4 pb-3 pt-0`}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (report.spot_id) {
                          navigate(`/spot-hub/${report.spot_id}`);
                        } else {
                          navigate(`/profile/${report.photographer_id}`);
                        }
                      }}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                        isLight
                          ? 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200'
                          : 'bg-zinc-800 hover:bg-zinc-700 text-gray-300 border border-zinc-700'
                      }`}
                    >
                      <Waves className="w-3.5 h-3.5" />
                      View Spot
                    </button>
                    {hasGallery && (
                      <button aria-label="Camera"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/photographer/${report.photographer_id}/gallery?gallery=${report.gallery_id}`);
                        }}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all bg-gradient-to-r from-cyan-500/20 to-blue-500/20 hover:from-cyan-500/30 hover:to-blue-500/30 text-cyan-400 border border-cyan-500/30 hover:border-cyan-500/50"
                        data-testid={`view-gallery-${report.id}`}
                      >
                        <Camera className="w-3.5 h-3.5" />
                        View Gallery
                        <span className="bg-cyan-500/30 rounded-full px-1.5 py-0 text-[10px] font-bold">{report.gallery_item_count}</span>
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          ) : null}
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

      </div>{/* end exploreContentRef */}
      </div>{/* end swipe container */}


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
                <button aria-label="Message"
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