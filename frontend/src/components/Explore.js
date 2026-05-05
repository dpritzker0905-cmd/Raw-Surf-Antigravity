import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

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
import ExploreWavesTab from './explore/ExploreWavesTab';
import UserRoleBadge from './explore/UserRoleBadge';
import useExploreConditions from '../hooks/useExploreConditions';
import HashtagsTab from './explore/HashtagsTab';
import ExploreConditionsTab from './explore/ExploreConditionsTab';
import ExploreTrending from './explore/ExploreTrending';
import ExploreSearchResults from './explore/ExploreSearchResults';

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
  // Theme-conditional classes for dropdowns and inputs (memoized)
  const themeClasses = useMemo(() => ({
    dropdownBg: isLight ? 'bg-white' : isBeach ? 'bg-zinc-900' : 'bg-zinc-900',
    dropdownBorder: isLight ? 'border-gray-300' : isBeach ? 'border-zinc-600' : 'border-zinc-700',
    dropdownText: isLight ? 'text-gray-900' : 'text-gray-100',
    dropdownFocus: isLight ? 'focus:border-cyan-500 focus:ring-cyan-200/30' : 'focus:border-cyan-500/50 focus:ring-cyan-500/20',
    labelClass: isLight ? 'text-gray-600' : isBeach ? 'text-gray-400' : 'text-gray-500',
    chipBg: isLight ? 'bg-gray-100 hover:bg-gray-200 border-gray-200 hover:border-cyan-400/50 text-gray-700 hover:text-gray-900' : 'bg-zinc-800/80 hover:bg-zinc-700 border-zinc-700 hover:border-cyan-500/30 text-gray-300 hover:text-white',
    breadcrumbText: isLight ? 'text-gray-900' : 'text-white',
  }), [isLight, isBeach]);
  const { dropdownBg, dropdownBorder, dropdownText, dropdownFocus, labelClass, chipBg, breadcrumbText } = themeClasses;
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
    document.title = 'Explore \u00B7 Raw Surf';
    setMeta('og:title', 'Explore \u00B7 Raw Surf');
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
  
  // Country flag emoji helper - uses Unicode escape sequences per project rules
  const getCountryFlag = (countryName) => {
    const flags = {
      'USA': '\u{1F1FA}\u{1F1F8}',
      'United States': '\u{1F1FA}\u{1F1F8}',
      'Australia': '\u{1F1E6}\u{1F1FA}',
      'Indonesia': '\u{1F1EE}\u{1F1E9}',
      'Brazil': '\u{1F1E7}\u{1F1F7}',
      'Portugal': '\u{1F1F5}\u{1F1F9}',
      'South Africa': '\u{1F1FF}\u{1F1E6}',
      'France': '\u{1F1EB}\u{1F1F7}',
      'Spain': '\u{1F1EA}\u{1F1F8}',
      'Mexico': '\u{1F1F2}\u{1F1FD}',
      'Costa Rica': '\u{1F1E8}\u{1F1F7}',
      'Japan': '\u{1F1EF}\u{1F1F5}',
      'New Zealand': '\u{1F1F3}\u{1F1FF}',
      'Peru': '\u{1F1F5}\u{1F1EA}',
      'Morocco': '\u{1F1F2}\u{1F1E6}',
      'United Kingdom': '\u{1F1EC}\u{1F1E7}',
      'UK': '\u{1F1EC}\u{1F1E7}',
      'Canada': '\u{1F1E8}\u{1F1E6}',
      'Chile': '\u{1F1E8}\u{1F1F1}',
      'Hawaii': '\u{1F3CA}',
      'Fiji': '\u{1F1EB}\u{1F1EF}',
      'French Polynesia': '\u{1F1F5}\u{1F1EB}',
      'Tahiti': '\u{1F1F5}\u{1F1EB}',
      'Maldives': '\u{1F1F2}\u{1F1FB}',
      'Philippines': '\u{1F1F5}\u{1F1ED}',
      'Sri Lanka': '\u{1F1F1}\u{1F1F0}',
      'Nicaragua': '\u{1F1F3}\u{1F1EE}',
      'Panama': '\u{1F1F5}\u{1F1E6}',
      'El Salvador': '\u{1F1F8}\u{1F1FB}',
      'Ecuador': '\u{1F1EA}\u{1F1E8}',
      'Ireland': '\u{1F1EE}\u{1F1EA}',
      'Italy': '\u{1F1EE}\u{1F1F9}',
      'Thailand': '\u{1F1F9}\u{1F1ED}',
      'Colombia': '\u{1F1E8}\u{1F1F4}',
      'Dominican Republic': '\u{1F1E9}\u{1F1F4}',
      'Puerto Rico': '\u{1F1F5}\u{1F1F7}',
      'Cuba': '\u{1F1E8}\u{1F1FA}',
      'Jamaica': '\u{1F1EF}\u{1F1F2}',
      'Barbados': '\u{1F1E7}\u{1F1E7}',
      'Bahamas': '\u{1F1E7}\u{1F1F8}',
      'Bermuda': '\u{1F1E7}\u{1F1F2}',
      'Taiwan': '\u{1F1F9}\u{1F1FC}',
      'China': '\u{1F1E8}\u{1F1F3}',
      'India': '\u{1F1EE}\u{1F1F3}',
      'Vietnam': '\u{1F1FB}\u{1F1F3}',
      'Samoa': '\u{1F1FC}\u{1F1F8}',
      'Tonga': '\u{1F1F9}\u{1F1F4}',
      'Angola': '\u{1F1E6}\u{1F1F4}',
      'Senegal': '\u{1F1F8}\u{1F1F3}',
      'Ghana': '\u{1F1EC}\u{1F1ED}',
      'Madagascar': '\u{1F1F2}\u{1F1EC}',
      'Mozambique': '\u{1F1F2}\u{1F1FF}',
      'Namibia': '\u{1F1F3}\u{1F1E6}',
      'Guatemala': '\u{1F1EC}\u{1F1F9}',
      'Honduras': '\u{1F1ED}\u{1F1F3}',
      'Argentina': '\u{1F1E6}\u{1F1F7}',
      'Uruguay': '\u{1F1FA}\u{1F1FE}',
      'Israel': '\u{1F1EE}\u{1F1F1}',
      'Malaysia': '\u{1F1F2}\u{1F1FE}',
      'Vanuatu': '\u{1F1FB}\u{1F1FA}',
      'Papua New Guinea': '\u{1F1F5}\u{1F1EC}',
      'Solomon Islands': '\u{1F1F8}\u{1F1E7}',
      'Saudi Arabia': '\u{1F1F8}\u{1F1E6}',
      'United Arab Emirates': '\u{1F1E6}\u{1F1EA}',
      'Oman': '\u{1F1F4}\u{1F1F2}',
      'Qatar': '\u{1F1F6}\u{1F1E6}',
      'Norway': '\u{1F1F3}\u{1F1F4}',
      'Iceland': '\u{1F1EE}\u{1F1F8}',
      'Aruba': '\u{1F1E6}\u{1F1FC}',
      'Curacao': '\u{1F1E8}\u{1F1FC}',
      'Trinidad & Tobago': '\u{1F1F9}\u{1F1F9}',
      'Mauritius': '\u{1F1F2}\u{1F1FA}',
      'Cape Verde': '\u{1F1E8}\u{1F1FB}',
      'Cook Islands': '\u{1F1E8}\u{1F1F0}'
    };
    return flags[countryName] || '\u{1F30A}';
  };
  
  // Popular quick-access locations - uses 'USA' to match DB country name
  const popularLocations = [
    { label: `${getCountryFlag('USA')} Florida`, country: 'USA', state: 'Florida' },
    { label: `${getCountryFlag('USA')} California`, country: 'USA', state: 'California' },
    { label: `${getCountryFlag('USA')} Hawaii`, country: 'USA', state: 'Hawaii' },
    { label: `${getCountryFlag('USA')} North Carolina`, country: 'USA', state: 'North Carolina' },
    { label: `${getCountryFlag('Australia')} Australia`, country: 'Australia' },
    { label: `${getCountryFlag('Indonesia')} Indonesia`, country: 'Indonesia' },
    { label: `${getCountryFlag('Brazil')} Brazil`, country: 'Brazil' },
    { label: `${getCountryFlag('Portugal')} Portugal`, country: 'Portugal' },
    { label: `${getCountryFlag('Costa Rica')} Costa Rica`, country: 'Costa Rica' },
    { label: `${getCountryFlag('Mexico')} Mexico`, country: 'Mexico' },
    { label: `${getCountryFlag('South Africa')} South Africa`, country: 'South Africa' },
    { label: `${getCountryFlag('Japan')} Japan`, country: 'Japan' },
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

  const tabs = useMemo(() => [
    { id: 'all', label: 'All', icon: Search },
    { id: 'waves', label: 'Waves', icon: Play },
    { id: 'posts', label: 'Posts', icon: Image },
    { id: 'trending', label: 'Trending', icon: Hash },
    { id: 'users', label: 'People', icon: Users },
    { id: 'conditions', label: 'Reports', icon: Waves },
    { id: 'sponsors', label: 'Sponsors', icon: Heart },
    { id: 'surfspots', label: 'Surf Spots', icon: Navigation },
  ], []);

  const hasResults = useMemo(() =>
    searchResults.users.length > 0 || searchResults.spots.length > 0 || searchResults.posts.length > 0,
    [searchResults]
  );
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
          <button aria-label="Close"
            onClick={clearSearch}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          ><X className="w-5 h-5" />
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
        
        {/* Tabs Container -â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™-â€šÂ¬Ã‚Â -â‚¬Å¡Ã‚Â¬-â‚¬Å¾Ã‚Â¢-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â¯-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™Ãƒâ€šÃ‚Â¢-â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬-â‚¬Â¦Ãƒâ€šÃ‚Â¡-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â¿-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™Ãƒâ€šÃ‚Â¢-â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬-â‚¬Â¦Ãƒâ€šÃ‚Â¡-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â½ Yellow pill buttons */}
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

      {/* Search Results (extracted to explore/ExploreSearchResults.js) */}
      {showResults && (
        <ExploreSearchResults
          isSearching={isSearching}
          hasResults={hasResults}
          searchQuery={searchQuery}
          activeTab={activeTab}
          searchResults={searchResults}
        />
      )}

      {/* Tab content -â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™-â€šÂ¬Ã‚Â -â‚¬Å¡Ã‚Â¬-â‚¬Å¾Ã‚Â¢-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â¯-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™Ãƒâ€šÃ‚Â¢-â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬-â‚¬Â¦Ãƒâ€šÃ‚Â¡-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â¿-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™Ãƒâ€šÃ‚Â¢-â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬-â‚¬Â¦Ãƒâ€šÃ‚Â¡-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â½ swipeable on mobile */}
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

      {/* Trending Section (extracted to explore/ExploreTrending.js) */}
      {!showResults && !loading && activeTab === 'all' && (
        <ExploreTrending
          trending={trending}
          spotConditions={spotConditions}
          user={user}
        />
      )}

      {/* People Tab -â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™-â€šÂ¬Ã‚Â -â‚¬Å¡Ã‚Â¬-â‚¬Å¾Ã‚Â¢-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â¯-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™Ãƒâ€šÃ‚Â¢-â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬-â‚¬Â¦Ãƒâ€šÃ‚Â¡-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â¿-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™Ãƒâ€šÃ‚Â¢-â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬-â‚¬Â¦Ãƒâ€šÃ‚Â¡-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â½ pre-search discovery state */}
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
                { label: 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ Photographers', query: 'photographer' },
                { label: 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¾ Surfers', query: 'surfer' },
                { label: 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â½ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ Videographers', query: 'videographer' },
                { label: 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¦ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Locals', query: 'local' },
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

          {/* Featured Community -â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™-â€šÂ¬Ã‚Â -â‚¬Å¡Ã‚Â¬-â‚¬Å¾Ã‚Â¢-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â¯-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™Ãƒâ€šÃ‚Â¢-â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬-â‚¬Â¦Ãƒâ€šÃ‚Â¡-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â¿-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™Ãƒâ€šÃ‚Â¢-â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬-â‚¬Â¦Ãƒâ€šÃ‚Â¡-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â½ reuse live photographers from trending */}
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

      {/* Search (Spots) Tab -â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™-â€šÂ¬Ã‚Â -â‚¬Å¡Ã‚Â¬-â‚¬Å¾Ã‚Â¢-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â¯-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™Ãƒâ€šÃ‚Â¢-â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬-â‚¬Â¦Ãƒâ€šÃ‚Â¡-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â¿-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™Ãƒâ€šÃ‚Â¢-â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬-â‚¬Â¦Ãƒâ€šÃ‚Â¡-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â½ pre-search discovery state */}
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
          
          {/* Map View CTA -â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™-â€šÂ¬Ã‚Â -â‚¬Å¡Ã‚Â¬-â‚¬Å¾Ã‚Â¢-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â¯-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™Ãƒâ€šÃ‚Â¢-â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬-â‚¬Â¦Ãƒâ€šÃ‚Â¡-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â¿-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Â -â€šÂ¬Ã¢â€žÂ¢-â€™Ãƒâ€šÃ‚Â¢-â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬-â‚¬Â¦Ãƒâ€šÃ‚Â¡-â€™Ãƒâ€ Ã¢â‚¬â„¢-â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡-â€™-â€šÂ¬Ã…Â¡-â‚¬Å¡Ãƒâ€šÃ‚Â½ always visible */}
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

      {/* Waves Tab - Reels-Style Vertical Scroll Feed (extracted) */}
      {activeTab === 'waves' && (
        <ExploreWavesTab
          trendingWaves={trendingWaves}
          recentWaves={recentWaves}
          wavesLoading={wavesLoading}
          navigate={navigate}
          handleWaveClick={handleWaveClick}
        />
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

      {/* Conditions/Reports Tab (extracted to explore/ExploreConditionsTab.js) */}
      {activeTab === 'conditions' && (
        <ExploreConditionsTab
          conditionsSubTab={conditionsSubTab}
          handleConditionsSubTabChange={handleConditionsSubTabChange}
          conditionReports={conditionReports}
          conditionsLoading={conditionsLoading}
          conditionsLocMode={conditionsLocMode}
          setConditionsLocMode={setConditionsLocMode}
          userLocation={userLocation}
          setUserLocation={setUserLocation}
          conditionsCountry={conditionsCountry}
          conditionsState={conditionsState}
          conditionsCity={conditionsCity}
          conditionsCountryOptions={conditionsCountryOptions}
          conditionsStateOptions={conditionsStateOptions}
          conditionsCityOptions={conditionsCityOptions}
          handleConditionsCountryChange={handleConditionsCountryChange}
          handleConditionsStateChange={handleConditionsStateChange}
          handleConditionsCityChange={handleConditionsCityChange}
          clearConditionsLocation={clearConditionsLocation}
          jumpToConditionsLocation={jumpToConditionsLocation}
          getReportsNearby={getReportsNearby}
          archiveDates={archiveDates}
          archiveDate={archiveDate}
          archiveGalleries={archiveGalleries}
          archiveGalleriesLoading={archiveGalleriesLoading}
          handleArchiveDateSelect={handleArchiveDateSelect}
          popularLocations={popularLocations}
          getCountryFlag={getCountryFlag}
          isLight={isLight}
          dropdownBg={dropdownBg}
          dropdownBorder={dropdownBorder}
          dropdownText={dropdownText}
          dropdownFocus={dropdownFocus}
          labelClass={labelClass}
          chipBg={chipBg}
          breadcrumbText={breadcrumbText}
        />
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
