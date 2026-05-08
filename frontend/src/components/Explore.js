import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import useSwipeNavigation from '../hooks/useSwipeNavigation';

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
import { getPopularLocations } from '../utils/countryFlags';
import ResponsiveImage from './ui/ResponsiveImage';
import PostMediaPreview from './explore/PostMediaPreview';
import BrowseMode from './explore/BrowseMode';
import NearbyMode from './explore/NearbyMode';
import ExploreWavesTab from './explore/ExploreWavesTab';
import UserRoleBadge from './explore/UserRoleBadge';
import useExploreConditions from '../hooks/useExploreConditions';
import useExploreData from '../hooks/useExploreData';
import HashtagsTab from './explore/HashtagsTab';
import ExploreConditionsTab from './explore/ExploreConditionsTab';
import ExploreTrending from './explore/ExploreTrending';
import ExploreSearchResults from './explore/ExploreSearchResults';
import ExploreSponsorsTab from './explore/ExploreSponsorsTab';
import ExplorePostsTab from './explore/ExplorePostsTab';
import ExplorePeopleTab from './explore/ExplorePeopleTab';
import ExploreSurfSpotsTab from './explore/ExploreSurfSpotsTab';

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

  // Data fetching handlers extracted to hooks/useExploreData.js
  const {
    fetchTrending, fetchTrendingHashtags, fetchHashtagPosts, handleHashtagClick,
    fetchTrendingWaves, handleWaveClick, fetchExplorePosts, handlePostClick,
    fetchSpotConditions, performSearch, clearSearch,
    fetchLeaderboard, fetchSponsorDetails, openSponsorCard, closeSponsorCard,
  } = useExploreData({
    searchQuery, activeTab, recentSearches,
    setTrending, setLoading, setSpotConditions,
    setTrendingHashtags, setHashtagPosts, setHashtagLoading, setSelectedHashtag,
    setTrendingWaves, setRecentWaves, setWavesLoading,
    setSelectedWaveHashtag, setWaveHashtagResults,
    setExplorePosts, setPostsLoading,
    setSearchResults, setIsSearching, setRecentSearches,
    setLeaderboard, setLeaderboardLoading,
    setSponsorDetails, setSelectedSponsor,
  });


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
  
  // Country flags and popular locations extracted to utils/countryFlags.js
  const popularLocations = useMemo(() => getPopularLocations(), []);

  
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

  // Swipe-to-navigate — shared hook for mobile tab switching
  const { contentRef: exploreContentRef, swipeHandlers, isAnimating, setIsAnimating } = useSwipeNavigation({
    tabs,
    activeTab,
    setActiveTab,
  });

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
        
        {/* Tabs Container - Yellow pill buttons */}
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

      {/* Tab content */}
      <div
        className="relative overflow-hidden"
        {...swipeHandlers}
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

      {/* People Tab */}
      {activeTab === 'users' && (
        <ExplorePeopleTab
          trending={trending}
          isLight={isLight}
          setSearchQuery={setSearchQuery}
        />
      )}

      {/* Search (Spots) Tab */}
      {/* "Search" tab removed - redundant with Surf Spots tab */}

      {/* Surf Spots Tab - Comprehensive Location Discovery */}
      {activeTab === 'surfspots' && (
        <ExploreSurfSpotsTab
          locationHierarchy={locationHierarchy}
          discoveryMode={discoveryMode}
          setDiscoveryMode={setDiscoveryMode}
          activateNearbyMode={activateNearbyMode}
          userLocation={userLocation}
          spotSearchQuery={spotSearchQuery}
          setSpotSearchQuery={setSpotSearchQuery}
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
          popularLocations={popularLocations}
          surfSpots={surfSpots}
          surfSpotsLoading={surfSpotsLoading}
          fetchSurfSpots={fetchSurfSpots}
          user={user}
          isLight={isLight}
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
          nearbySpots={nearbySpots}
          nearbyLoading={nearbyLoading}
          fetchNearbySpots={fetchNearbySpots}
        />
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

      {/* Posts Tab (extracted to explore/ExplorePostsTab.js) */}
      {activeTab === 'posts' && (
        <ExplorePostsTab
          explorePosts={explorePosts}
          postsLoading={postsLoading}
          handlePostClick={handlePostClick}
        />
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

      {/* Top Sponsors Tab (extracted to explore/ExploreSponsorsTab.js) */}
      {activeTab === 'sponsors' && (
        <ExploreSponsorsTab
          leaderboard={leaderboard}
          leaderboardLoading={leaderboardLoading}
          openSponsorCard={openSponsorCard}
          selectedSponsor={selectedSponsor}
          sponsorDetails={sponsorDetails}
          closeSponsorCard={closeSponsorCard}
        />
      )}

      </div>{/* end exploreContentRef */}
      </div>{/* end swipe container */}
    </div>
  );
};
