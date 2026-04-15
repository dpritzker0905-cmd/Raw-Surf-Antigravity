import React, { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Hash, TrendingUp, Loader2 } from 'lucide-react';
import axios from 'axios';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * HashtagAutocomplete - Dropdown for suggesting hashtags when typing #
 * Features:
 * - Shows existing hashtags matching the query
 * - Shows trending hashtags when query is empty
 * - Keyboard navigation (up/down/enter/escape)
 * - Click to select
 */
const HashtagAutocomplete = forwardRef(({ 
  query, 
  onSelect, 
  hashIndex,
  endIndex,
  position = { top: 0, left: 0 },
  onClose 
}, ref) => {
  const [suggestions, setSuggestions] = useState([]);
  const [trendingHashtags, setTrendingHashtags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Fetch trending hashtags on mount
  useEffect(() => {
    const fetchTrending = async () => {
      try {
        const response = await axios.get(`${API}/hashtags/trending?limit=8`);
        setTrendingHashtags(response.data.hashtags || []);
      } catch (error) {
        logger.debug('Could not fetch trending hashtags');
      }
    };
    fetchTrending();
  }, []);

  // Search for hashtags matching query
  const searchHashtags = useCallback(async (searchQuery) => {
    if (!searchQuery || searchQuery.length < 1) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    try {
      const response = await axios.get(`${API}/hashtags/suggest`, {
        params: { q: searchQuery, limit: 8 }
      });
      setSuggestions(response.data.suggestions || []);
    } catch (error) {
      // Fallback: filter trending hashtags locally
      const filtered = trendingHashtags.filter(t => 
        t.tag.toLowerCase().startsWith(searchQuery.toLowerCase())
      );
      setSuggestions(filtered);
    } finally {
      setLoading(false);
    }
  }, [trendingHashtags]);

  // Debounced search
  useEffect(() => {
    const debounce = setTimeout(() => {
      if (query !== undefined) {
        searchHashtags(query);
        setSelectedIndex(0);
      }
    }, 150);

    return () => clearTimeout(debounce);
  }, [query, searchHashtags]);

  // Get display list (suggestions or trending)
  const displayList = query && query.length > 0 ? suggestions : trendingHashtags;
  const showTrending = !query || query.length === 0;

  // Handle selection
  const handleSelect = useCallback((hashtag) => {
    onSelect(hashtag, hashIndex, endIndex);
  }, [onSelect, hashIndex, endIndex]);

  // Expose keyboard handler to parent
  useImperativeHandle(ref, () => ({
    handleKeyDown: (e) => {
      if (displayList.length === 0) return false;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => 
            prev < displayList.length - 1 ? prev + 1 : 0
          );
          return true;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => 
            prev > 0 ? prev - 1 : displayList.length - 1
          );
          return true;

        case 'Enter':
        case 'Tab':
          e.preventDefault();
          if (displayList[selectedIndex]) {
            handleSelect(displayList[selectedIndex]);
          }
          return true;

        case 'Escape':
          e.preventDefault();
          onClose?.();
          return true;

        default:
          return false;
      }
    }
  }), [displayList, selectedIndex, handleSelect, onClose]);

  if (displayList.length === 0 && !loading && !showTrending) {
    return null;
  }

  return (
    <div 
      className="absolute z-50 w-64 max-h-64 bg-card border border-border rounded-lg shadow-xl overflow-hidden"
      style={{ 
        top: position.top,
        left: position.left,
        minWidth: '200px'
      }}
      data-testid="hashtag-autocomplete"
    >
      {/* Header */}
      <div className="px-3 py-2 bg-muted/50 border-b border-border flex items-center gap-2">
        {showTrending ? (
          <>
            <TrendingUp className="w-3.5 h-3.5 text-yellow-400" />
            <span className="text-xs font-medium text-muted-foreground">Trending Hashtags</span>
          </>
        ) : (
          <>
            <Hash className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-medium text-muted-foreground">
              {loading ? 'Searching...' : `Hashtags matching "${query}"`}
            </span>
          </>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
        </div>
      )}

      {/* Suggestions list */}
      {!loading && displayList.length > 0 && (
        <div className="py-1 max-h-48 overflow-y-auto">
          {displayList.map((hashtag, index) => (
            <button
              key={hashtag.tag}
              onClick={() => handleSelect(hashtag)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors ${
                index === selectedIndex
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : 'hover:bg-muted text-foreground'
              }`}
              data-testid={`hashtag-suggestion-${hashtag.tag}`}
            >
              <div className="flex items-center gap-2">
                <Hash className={`w-4 h-4 ${
                  index === selectedIndex ? 'text-cyan-400' : 'text-muted-foreground'
                }`} />
                <span className="font-medium">#{hashtag.tag}</span>
              </div>
              {hashtag.post_count > 0 && (
                <span className="text-xs text-muted-foreground">
                  {hashtag.post_count} posts
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && displayList.length === 0 && query && (
        <div className="px-3 py-4 text-center">
          <p className="text-sm text-muted-foreground">No matching hashtags</p>
          <p className="text-xs text-muted-foreground mt-1">
            Press Enter to use <span className="text-cyan-400">#{query}</span>
          </p>
        </div>
      )}

      {/* Hint */}
      <div className="px-3 py-1.5 bg-muted/30 border-t border-border">
        <p className="text-[10px] text-muted-foreground">
          ↑↓ Navigate • Enter Select • Esc Close
        </p>
      </div>
    </div>
  );
});

HashtagAutocomplete.displayName = 'HashtagAutocomplete';

export default HashtagAutocomplete;
