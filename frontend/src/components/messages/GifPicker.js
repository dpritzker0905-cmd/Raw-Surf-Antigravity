/**
 * GifPicker.js -- GIPHY-compatible GIF picker shared by messages and comments.
 *
 * Fully self-contained: no backend calls, no auth context.
 * Uses GIPHY's Tenor-compatible v2 API with a build-time public API key.
 *
 * Features:
 *  - Infinite scroll with "next" cursor pagination
 *  - Masonry-style 2-column grid for natural GIF aspect ratios
 *  - Search with debounced input
 *  - Click-outside to close (doesn't fire on search focus)
 *
 * Props:
 *   show     {boolean}   Whether the picker is visible
 *   onSelect {function}  Called with (gifUrl: string) when user picks a GIF
 *   onClose  {function}  Called when user closes the picker
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';

// GIPHY's Tenor-compatible API preserves the existing response/pagination shape.
// This value is injected by Netlify at build time, never committed.
const GIPHY_API_KEY = process.env.REACT_APP_GIPHY_API_KEY;
const GIPHY_BASE = 'https://api.giphy.com/v2';
const GIPHY_CLIENT_KEY = 'raw_surf_web';
const GIF_LIMIT = 20;
const MEDIA_FILTERS = 'gif,tinygif';
const CONTENT_FILTER = 'high'; // GIPHY compatibility mode: G-rated content only.

/** Map a Tenor-compatible GIPHY result to the picker display shape. */
export const mapGifResult = (g) => ({
  id: g.id,
  title: g.content_description || 'GIF',
  images: {
    fixed_height: {
      url: g.media_formats?.gif?.url || g.media_formats?.mediumgif?.url || g.media_formats?.tinygif?.url,
    },
    fixed_height_small: {
      url: g.media_formats?.tinygif?.url || g.media_formats?.nanogif?.url,
    },
    original: {
      url: g.media_formats?.gif?.url,
    },
  },
});

export const buildGifUrl = (endpoint, params = {}) => {
  const query = new URLSearchParams({
    key: GIPHY_API_KEY || '',
    client_key: GIPHY_CLIENT_KEY,
    contentfilter: CONTENT_FILTER,
    media_filter: MEDIA_FILTERS,
    limit: String(GIF_LIMIT),
    ...params,
  });
  return `${GIPHY_BASE}/${endpoint}?${query.toString()}`;
};

const GifPicker = ({ show, onSelect, onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [gifs, setGifs] = useState([]);
  const [trendingGifs, setTrendingGifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const pickerRef = useRef(null);
  const gridRef = useRef(null);
  const searchInputRef = useRef(null);
  const isScrollingRef = useRef(false);
  
  // Pagination cursors remain opaque in GIPHY's Tenor-compatible API.
  const [trendingNext, setTrendingNext] = useState('');
  const [searchNext, setSearchNext] = useState('');

  // Load trending GIFs once when picker first opens
  useEffect(() => {
    if (show && trendingGifs.length === 0) {
      fetchTrending();
    }
 }, [show]); // intentionally omits fetchTrending from deps -- only run once on first open

  // Click-outside to close (respects scroll vs click distinction)
  useEffect(() => {
    if (!show) return;
    const handleClickOutside = (e) => {
      if (isScrollingRef.current) return;
      if (pickerRef.current && !pickerRef.current.contains(e.target)) onClose();
    };
    // Delay to prevent immediate close when the picker is opened from a button click
    const id = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 150);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [show, onClose]);

 // Debounced search -- 400ms delay with 2-char minimum
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchTerm.trim().length >= 2) {
        searchGifs(searchTerm.trim(), false);
      } else {
        setGifs([]);
        setSearchNext('');
      }
    }, 400);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const fetchTrending = async (loadMore = false) => {
    if (!GIPHY_API_KEY) {
      setError('GIF search is not configured. Please try again later.');
      return;
    }
    if (loadMore) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const url = buildGifUrl('featured', loadMore && trendingNext ? { pos: trendingNext } : {});
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GIF provider returned ${res.status}`);
      const data = await res.json();
      const mapped = (data.results || []).map(mapGifResult);
      
      if (loadMore) {
        setTrendingGifs(prev => [...prev, ...mapped]);
      } else {
        setTrendingGifs(mapped);
      }
      setTrendingNext(data.next || '');
    } catch (err) {
      setError('Unable to load trending GIFs. Please retry.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const searchGifs = async (query, loadMore = false) => {
    if (!GIPHY_API_KEY) {
      setError('GIF search is not configured. Please try again later.');
      return;
    }
    if (loadMore) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const url = buildGifUrl('search', {
        q: query,
        ...(loadMore && searchNext ? { pos: searchNext } : {}),
      });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GIF provider returned ${res.status}`);
      const data = await res.json();
      const mapped = (data.results || []).map(mapGifResult);
      
      if (loadMore) {
        setGifs(prev => [...prev, ...mapped]);
      } else {
        setGifs(mapped);
      }
      setSearchNext(data.next || '');
    } catch (err) {
      setError('Unable to search GIFs. Please retry.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Infinite scroll handler
  const handleGridScroll = useCallback(() => {
    const el = gridRef.current;
    if (!el || loadingMore) return;
    
    // When scrolled within 100px of bottom, load more
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (nearBottom) {
      if (searchTerm.trim().length >= 2 && searchNext) {
        searchGifs(searchTerm.trim(), true);
      } else if (!searchTerm && trendingNext) {
        fetchTrending(true);
      }
    }
  }, [loadingMore, searchTerm, searchNext, trendingNext]);

  const handleGifSelect = (gifUrl, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (gifUrl) onSelect(gifUrl);
  };

  const displayGifs = searchTerm ? gifs : trendingGifs;
  const hasMore = searchTerm ? !!searchNext : !!trendingNext;

  if (!show) return null;

  return (
    <div
      ref={pickerRef}
      className="absolute left-0 w-[320px] max-w-[calc(100vw-32px)] bottom-full mb-2 h-[420px] max-h-[60vh] flex flex-col bg-card rounded-xl shadow-2xl border border-border overflow-hidden z-[100]"
    >
      {/* Header */}
      <div className="p-3 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">GIF Picker</span>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-muted" type="button" aria-label="Close">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input aria-label="Search GIFs..."
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search GIFs..."
            className="w-full bg-muted rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground">
            {searchTerm ? `Results for "${searchTerm}"` : 'Trending GIFs'}
          </span>
          <span className="text-[10px] text-muted-foreground opacity-50">Powered by GIPHY</span>
        </div>
      </div>

 {/* GIF Grid -- 2-column masonry with infinite scroll */}
      <div
        ref={gridRef}
        className="p-2 overflow-y-auto flex-1 overscroll-contain"
        onScroll={handleGridScroll}
        onTouchStart={() => { isScrollingRef.current = false; }}
        onTouchMove={() => { isScrollingRef.current = true; }}
        onTouchEnd={() => { setTimeout(() => { isScrollingRef.current = false; }, 100); }}
      >
        {error ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => searchTerm ? searchGifs(searchTerm.trim(), false) : fetchTrending()}
              className="mt-3 text-cyan-400 hover:text-cyan-300 font-medium"
            >
              Retry
            </button>
          </div>
        ) : loading && displayGifs.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
          </div>
        ) : displayGifs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {searchTerm ? 'No GIFs found' : 'Loading...'}
          </div>
        ) : (
          <>
            <div className="columns-2 gap-2">
              {displayGifs.map((gif) => {
                const gifUrl = gif.images?.fixed_height?.url || gif.images?.original?.url;
                const previewUrl = gif.images?.fixed_height_small?.url || gifUrl;
                if (!gifUrl) return null;
                return (
                  <button
                    type="button"
                    key={gif.id}
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={(e) => handleGifSelect(gifUrl, e)}
                    onTouchEnd={(e) => { if (!isScrollingRef.current) handleGifSelect(gifUrl, e); }}
                    className="relative rounded-lg overflow-hidden hover:ring-2 hover:ring-cyan-500 transition-all cursor-pointer bg-zinc-800 touch-manipulation w-full mb-2 break-inside-avoid block"
                    data-testid="gif-item"
                  >
                    <img loading="lazy" decoding="async"
                      src={previewUrl}
                      alt={gif.title || 'GIF'}
                      className="w-full h-auto object-cover pointer-events-none select-none"
                      draggable={false}
                    />
                  </button>
                );
              })}
            </div>
            
            {/* Load more indicator */}
            {loadingMore && (
              <div className="flex justify-center py-3">
                <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
              </div>
            )}
            
            {/* End of results */}
            {!hasMore && displayGifs.length > 0 && (
              <div className="text-center py-2 text-xs text-muted-foreground">
                No more GIFs
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default GifPicker;
