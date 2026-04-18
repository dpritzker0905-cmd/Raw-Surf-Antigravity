import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, MapPin, User, FileText, Hash, Loader2, TrendingUp } from 'lucide-react';
import { Input } from './ui/input';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import { getExpandedRoleInfo } from '../contexts/PersonaContext';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';


/**
 * GlobalSearchBar - Unified search component for desktop sidebar and mobile
 * Searches: Users, Spots, Posts, Hashtags
 */
export const GlobalSearchBar = ({ 
  variant = 'desktop', // 'desktop' | 'mobile-icon' | 'mobile-expanded'
  onClose,
  onSearchStateChange,
  className = ''
}) => {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ users: [], spots: [], posts: [], hashtags: [] });
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [recentSearches, setRecentSearches] = useState([]);
  const [trendingHashtags, setTrendingHashtags] = useState([]);
  
  // Click outside handler to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Load recent searches from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('rawsurf_recent_searches');
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved).slice(0, 5));
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    // Fetch trending hashtags
    fetchTrendingHashtags();
  }, []);
  
  // Auto-focus on mount for mobile expanded
  useEffect(() => {
    if (variant === 'mobile-expanded' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [variant]);
  
  const fetchTrendingHashtags = async () => {
    try {
      const response = await apiClient.get(`/hashtags/trending?limit=5`);
      setTrendingHashtags(response.data.hashtags || []);
    } catch (error) {
      // Silently fail - trending is optional
      logger.debug('Trending hashtags not available');
    }
  };
  
  const performSearch = useCallback(async (searchQuery) => {
    if (!searchQuery || searchQuery.length < 2) {
      setResults({ users: [], spots: [], posts: [], hashtags: [] });
      return;
    }
    
    setIsSearching(true);
    try {
      const response = await apiClient.get(`/search/global`, {
        params: { q: searchQuery, limit: 5 }
      });
      setResults(response.data);
    } catch (error) {
      logger.error('Search error:', error);
      // Fallback to explore search
      try {
        const fallbackResponse = await apiClient.get(`/explore/search`, {
          params: { q: searchQuery, type: 'all', limit: 5 }
        });
        setResults({
          ...fallbackResponse.data,
          hashtags: []
        });
      } catch (e) {
        setResults({ users: [], spots: [], posts: [], hashtags: [] });
      }
    } finally {
      setIsSearching(false);
    }
  }, []);
  
  // Debounced search
  useEffect(() => {
    const debounce = setTimeout(() => {
      if (query.trim().length >= 2) {
        performSearch(query.trim());
        setShowDropdown(true);
      } else if (query.trim().length === 0) {
        setShowDropdown(false);
      }
    }, 300);
    
    return () => clearTimeout(debounce);
  }, [query, performSearch]);
  
  // Notify parent of search state changes
  useEffect(() => {
    if (onSearchStateChange) {
      onSearchStateChange(showDropdown || query.length > 0);
    }
  }, [showDropdown, query, onSearchStateChange]);
  
  const saveRecentSearch = (item) => {
    const newRecent = [item, ...recentSearches.filter(r => r.id !== item.id)].slice(0, 5);
    setRecentSearches(newRecent);
    localStorage.setItem('rawsurf_recent_searches', JSON.stringify(newRecent));
  };
  
  const handleSelect = (type, item) => {
    saveRecentSearch({ ...item, type });
    setQuery('');
    setShowDropdown(false);
    
    switch (type) {
      case 'user':
        navigate(`/profile/${item.id}`);
        break;
      case 'spot':
        navigate(`/spot-hub/${item.id}`);
        break;
      case 'post':
        // Navigate to feed with post highlighted or to post detail
        navigate(`/feed?post=${item.id}`);
        break;
      case 'hashtag':
        navigate(`/explore?hashtag=${item.tag}`);
        break;
      default:
        navigate('/explore');
    }
    
    if (onClose) onClose();
  };
  
  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/explore?q=${encodeURIComponent(query.trim())}`);
      setShowDropdown(false);
      if (onClose) onClose();
    }
  };
  
  const clearSearch = () => {
    setQuery('');
    setResults({ users: [], spots: [], posts: [], hashtags: [] });
    setShowDropdown(false);
    inputRef.current?.focus();
  };
  
  const hasResults = results.users.length > 0 || results.spots.length > 0 || 
                     results.posts.length > 0 || results.hashtags.length > 0;
  
  // Mobile icon variant - just shows the search icon
  if (variant === 'mobile-icon') {
    return (
      <button
        onClick={() => navigate('/search')}
        className={`text-muted-foreground hover:text-foreground transition-colors p-1 ${className}`}
        data-testid="global-search-icon"
        aria-label="Search"
      >
        <Search className="w-5 h-5" />
      </button>
    );
  }
  
  return (
    <div ref={containerRef} className={`relative ${className}`} data-testid="global-search-bar">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="text"
            placeholder={variant === 'desktop' ? 'Search' : 'Search people, spots, posts...'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query.length >= 2 && setShowDropdown(true)}
            className="pl-9 pr-8 h-9 bg-background border-border text-foreground placeholder:text-muted-foreground text-sm focus:ring-1 focus:ring-ring"
            data-testid="global-search-input"
          />
          {query && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <X className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </form>
      
      {/* Search Results Dropdown */}
      {showDropdown && (
        <div 
          className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-xl z-50 max-h-[400px] overflow-y-auto"
          data-testid="search-results-dropdown"
        >
          {isSearching ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
            </div>
          ) : !hasResults && query.length >= 2 ? (
            <div className="py-6 text-center text-muted-foreground">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No results for "{query}"</p>
            </div>
          ) : (
            <div className="py-2">
              {/* Trending Hashtags - Show when no query */}
              {!query && trendingHashtags.length > 0 && (
                <div className="px-3 pb-2 mb-2 border-b border-border">
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingUp className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-xs font-medium text-muted-foreground">Trending</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {trendingHashtags.map((tag) => (
                      <button
                        key={tag.tag}
                        onClick={() => handleSelect('hashtag', tag)}
                        className="px-2 py-1 bg-yellow-400/10 text-yellow-400 text-xs rounded-full hover:bg-yellow-400/20 transition-colors"
                      >
                        #{tag.tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Users */}
              {results.users.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase">People</span>
                  </div>
                  {results.users.map((user) => {
                    const roleInfo = getExpandedRoleInfo(user.role);
                    return (
                      <button
                        key={user.id}
                        onClick={() => handleSelect('user', user)}
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted transition-colors"
                        data-testid={`search-result-user-${user.id}`}
                      >
                        <Avatar className="w-8 h-8">
                          <AvatarImage src={user.avatar_url} />
                          <AvatarFallback className="bg-zinc-700 text-xs">
                            {user.full_name?.charAt(0) || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 text-left min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-foreground truncate">{user.full_name}</span>
                            {roleInfo && <span className="text-sm">{roleInfo.icon}</span>}
                          </div>
                          <span className="text-xs text-muted-foreground">{user.role}</span>
                        </div>
                        <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
              
              {/* Spots */}
              {results.spots.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase">Spots</span>
                  </div>
                  {results.spots.map((spot) => (
                    <button
                      key={spot.id}
                      onClick={() => handleSelect('spot', spot)}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted transition-colors"
                      data-testid={`search-result-spot-${spot.id}`}
                    >
                      <div className="w-8 h-8 rounded bg-cyan-500/20 flex items-center justify-center">
                        <MapPin className="w-4 h-4 text-cyan-400" />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <span className="text-sm font-medium text-foreground truncate block">{spot.name}</span>
                        <span className="text-xs text-muted-foreground">{spot.region}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              
              {/* Hashtags */}
              {results.hashtags?.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase">Hashtags</span>
                  </div>
                  {results.hashtags.map((tag) => (
                    <button
                      key={tag.tag}
                      onClick={() => handleSelect('hashtag', tag)}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted transition-colors"
                      data-testid={`search-result-hashtag-${tag.tag}`}
                    >
                      <div className="w-8 h-8 rounded bg-yellow-400/20 flex items-center justify-center">
                        <Hash className="w-4 h-4 text-yellow-400" />
                      </div>
                      <div className="flex-1 text-left min-w-0">
                        <span className="text-sm font-medium text-foreground">#{tag.tag}</span>
                        <span className="text-xs text-muted-foreground ml-2">{tag.post_count || 0} posts</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              
              {/* Posts */}
              {results.posts.length > 0 && (
                <div className="mb-2">
                  <div className="px-3 py-1.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase">Posts</span>
                  </div>
                  {results.posts.slice(0, 3).map((post) => (
                    <button
                      key={post.id}
                      onClick={() => handleSelect('post', post)}
                      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted transition-colors"
                      data-testid={`search-result-post-${post.id}`}
                    >
                      {post.image_url ? (
                        <img 
                          src={post.image_url} 
                          alt="" 
                          className="w-8 h-8 rounded object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 text-left min-w-0">
                        <span className="text-sm text-foreground truncate block">
                          {post.caption?.substring(0, 40) || 'Post'}
                          {post.caption?.length > 40 ? '...' : ''}
                        </span>
                        <span className="text-xs text-muted-foreground">by {post.author_name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              
              {/* View All Results */}
              {hasResults && (
                <div className="px-3 pt-2 border-t border-border">
                  <button
                    onClick={handleSubmit}
                    className="w-full py-2 text-sm text-cyan-400 hover:text-cyan-300 font-medium"
                  >
                    View all results for "{query}"
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      
    </div>
  );
};

export default GlobalSearchBar;
