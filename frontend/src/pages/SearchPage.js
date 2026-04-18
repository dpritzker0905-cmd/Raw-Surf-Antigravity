import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, Clock, Hash, User, MapPin } from 'lucide-react';
import { GlobalSearchBar } from '../components/GlobalSearchBar';
import { Avatar, AvatarImage, AvatarFallback } from '../components/ui/avatar';
import apiClient from '../lib/apiClient';
import { getFullUrl } from '../utils/media';


/**
 * SearchPage - Mobile search experience
 * Shows trending hashtags and recent searches when not actively searching
 * Respects bottom navigation - doesn't cover it
 */
const SearchPage = () => {
  const navigate = useNavigate();
  const [trendingHashtags, setTrendingHashtags] = useState([]);
  const [recentSearches, setRecentSearches] = useState([]);
  const [isSearchActive, setIsSearchActive] = useState(false);
  
  useEffect(() => {
    // Load recent searches from localStorage
    const saved = localStorage.getItem('rawsurf_recent_searches');
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved).slice(0, 5));
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    // Fetch trending hashtags
    const fetchTrending = async () => {
      try {
        const response = await apiClient.get(`/hashtags/trending?limit=8`);
        setTrendingHashtags(response.data.hashtags || []);
      } catch (error) {
        // Silently fail
      }
    };
    fetchTrending();
  }, []);
  
  const handleHashtagClick = (tag) => {
    navigate(`/explore?hashtag=${tag}`);
  };
  
  const handleRecentClick = (item) => {
    if (item.type === 'user') {
      navigate(`/profile/${item.id}`);
    } else if (item.type === 'spot') {
      navigate(`/spot-hub/${item.id}`);
    } else if (item.type === 'hashtag') {
      navigate(`/explore?hashtag=${item.tag}`);
    } else if (item.type === 'post') {
      navigate(`/feed?post=${item.id}`);
    }
  };
  
  const clearRecentSearches = () => {
    setRecentSearches([]);
    localStorage.removeItem('rawsurf_recent_searches');
  };
  
  const getRecentIcon = (type) => {
    switch (type) {
      case 'user': return <User className="w-4 h-4" />;
      case 'spot': return <MapPin className="w-4 h-4" />;
      case 'hashtag': return <Hash className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };
  
  return (
    <div className="flex flex-col bg-background" data-testid="search-page">
      {/* Header - Fixed at top */}
      <div 
        className="sticky top-0 z-50 bg-background border-b border-border px-3 py-3 flex items-center gap-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 -ml-1 text-muted-foreground hover:text-foreground transition-colors"
          data-testid="search-back-button"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        
        <div className="flex-1">
          <GlobalSearchBar 
            variant="mobile-expanded" 
            onClose={() => navigate(-1)}
            onSearchStateChange={setIsSearchActive}
            className="w-full"
          />
        </div>
      </div>
      
      {/* Content area - shows when not actively searching */}
      {!isSearchActive && (
        <div className="px-4 py-4 space-y-6">
          {/* Trending Hashtags */}
          {trendingHashtags.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-yellow-500" />
                <span className="text-sm font-semibold text-foreground">Trending</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {trendingHashtags.map((tag) => (
                  <button
                    key={tag.tag}
                    onClick={() => handleHashtagClick(tag.tag)}
                    className="px-3 py-1.5 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-sm rounded-full hover:bg-yellow-500/20 transition-colors"
                    data-testid={`trending-tag-${tag.tag}`}
                  >
                    #{tag.tag}
                    {tag.post_count > 0 && (
                      <span className="ml-1 text-xs opacity-70">{tag.post_count}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Recent Searches */}
          {recentSearches.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">Recent</span>
                </div>
                <button
                  onClick={clearRecentSearches}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear all
                </button>
              </div>
              <div className="space-y-1">
                {recentSearches.map((item, index) => (
                  <button
                    key={`${item.type}-${item.id || index}`}
                    onClick={() => handleRecentClick(item)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted transition-colors"
                    data-testid={`recent-search-${index}`}
                  >
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                      {item.type === 'user' && item.avatar_url ? (
                        <Avatar className="w-8 h-8">
                          <AvatarImage src={getFullUrl(item.avatar_url)} />
                          <AvatarFallback className="bg-muted text-xs">
                            {item.full_name?.charAt(0) || '?'}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        getRecentIcon(item.type)
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <span className="text-sm text-foreground">
                        {item.type === 'hashtag' ? `#${item.tag}` : item.full_name || item.name || 'Unknown'}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2 capitalize">{item.type}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Empty state when no trending or recent */}
          {trendingHashtags.length === 0 && recentSearches.length === 0 && (
            <div className="text-center py-12">
              <Hash className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-muted-foreground text-sm">
                Search for people, spots, or hashtags
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchPage;
