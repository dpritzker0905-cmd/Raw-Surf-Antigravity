/**
 * GifPicker.js — Tenor API-powered GIF picker for MessagesPage.
 *
 * Fully self-contained: no backend calls, no auth context.
 * Uses Tenor v2 API (Google) with free public key.
 *
 * Props:
 *   show     {boolean}   Whether the picker is visible
 *   onSelect {function}  Called with (gifUrl: string) when user picks a GIF
 *   onClose  {function}  Called when user closes the picker
 */
import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

// Tenor API key - Google free tier (replace with env var if needed)
const TENOR_API_KEY = process.env.REACT_APP_TENOR_API_KEY || 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ';
const TENOR_BASE = 'https://tenor.googleapis.com/v2';
const GIF_LIMIT = 20;
const MEDIA_FILTERS = 'gif,tinygif';

/** Map a Tenor v2 result to a consistent GIF shape */
const mapTenorResult = (g) => ({
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

const GifPicker = ({ show, onSelect, onClose }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [gifs, setGifs] = useState([]);
  const [trendingGifs, setTrendingGifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const pickerRef = useRef(null);
  const isScrollingRef = useRef(false);

  // Load trending GIFs once when picker first opens
  useEffect(() => {
    if (show && trendingGifs.length === 0) {
      fetchTrending();
    }
  }, [show]); // intentionally omits fetchTrending from deps — only run once on first open


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

  // Debounced search
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchTerm.trim()) {
        searchGifs(searchTerm.trim());
      } else {
        setGifs([]);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [searchTerm]);

  const fetchTrending = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${TENOR_BASE}/featured?key=${TENOR_API_KEY}&limit=${GIF_LIMIT}&media_filter=${MEDIA_FILTERS}`);
      const data = await res.json();
      setTrendingGifs((data.results || []).map(mapTenorResult));
    } catch (err) {
      // Silent — picker just shows empty state
    } finally {
      setLoading(false);
    }
  };

  const searchGifs = async (query) => {
    setLoading(true);
    try {
      const res = await fetch(`${TENOR_BASE}/search?key=${TENOR_API_KEY}&q=${encodeURIComponent(query)}&limit=${GIF_LIMIT}&media_filter=${MEDIA_FILTERS}`);
      const data = await res.json();
      setGifs((data.results || []).map(mapTenorResult));
    } catch (err) {
      // Silent
    } finally {
      setLoading(false);
    }
  };

  const handleGifSelect = (gifUrl, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (gifUrl) onSelect(gifUrl);
  };

  const displayGifs = searchTerm ? gifs : trendingGifs;

  if (!show) return null;

  return (
    <div
      ref={pickerRef}
      className="absolute left-0 w-[320px] max-w-[calc(100vw-32px)] bottom-full mb-2 h-[420px] max-h-[60vh] flex flex-col bg-card rounded-xl shadow-2xl border border-border overflow-hidden z-[100]"
    >
      {/* Header */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">GIF Picker</span>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-muted" type="button">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search GIFs..."
            className="w-full bg-muted rounded-full pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground">
            {searchTerm ? `Results for "${searchTerm}"` : 'Trending GIFs'}
          </span>
          <span className="text-[10px] text-muted-foreground opacity-50">Powered by Tenor</span>
        </div>
      </div>

      {/* GIF Grid */}
      <div
        className="p-2 overflow-y-auto flex-1 grid grid-cols-3 gap-2 overscroll-contain"
        onTouchStart={() => { isScrollingRef.current = false; }}
        onTouchMove={() => { isScrollingRef.current = true; }}
        onTouchEnd={() => { setTimeout(() => { isScrollingRef.current = false; }, 100); }}
      >
        {loading ? (
          <div className="col-span-3 flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : displayGifs.length === 0 ? (
          <div className="col-span-3 text-center py-8 text-muted-foreground text-sm">
            {searchTerm ? 'No GIFs found' : 'Loading...'}
          </div>
        ) : (
          displayGifs.map((gif) => {
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
                className="relative rounded-lg overflow-hidden hover:ring-2 hover:ring-cyan-500 transition-all aspect-square cursor-pointer bg-zinc-800 touch-manipulation"
                data-testid="gif-item"
              >
                <img
                  src={previewUrl}
                  alt={gif.title || 'GIF'}
                  className="w-full h-full object-cover pointer-events-none select-none"
                  loading="lazy"
                  draggable={false}
                />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

export default GifPicker;
