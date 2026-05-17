/**
 * ExplorePeopleTab GÇö Extracted from Explore.js
 * Renders the "People" tab with search prompts, role browsing, and live photographers.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin, Users, Radio } from 'lucide-react';
import { Badge } from '../ui/badge';
import { getFullUrl } from '../../utils/media';

const ExplorePeopleTab = ({
  trending,
  isLight,
  setSearchQuery,
}) => {
  const navigate = useNavigate();

  return (
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
            { label: '\u{1F4F8} Photographers', query: 'photographer' },
            { label: '\u{1F3C4} Surfers', query: 'surfer' },
            { label: '\u{1F451} Creators', query: 'creator' },
            { label: '\u{1F3AF} All', query: '' },
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

      {/* Featured Community */}
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
  );
};

export default ExplorePeopleTab;
