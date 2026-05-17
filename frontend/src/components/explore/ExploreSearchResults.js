/**
 * ExploreSearchResults.js
 * Extracted from Explore.js GÇö Search results overlay showing users, spots, posts.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin, ChevronRight } from 'lucide-react';
import { Badge } from '../ui/badge';
import { getFullUrl } from '../../utils/media';
import UserRoleBadge from './UserRoleBadge';
import PostMediaPreview from './PostMediaPreview';

const ExploreSearchResults = ({
  isSearching,
  hasResults,
  searchQuery,
  activeTab,
  searchResults,
}) => {
  const navigate = useNavigate();

  if (isSearching) {
    return (
      <div className="space-y-6">
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
        </div>
      </div>
    );
  }

  if (!hasResults) {
    return (
      <div className="space-y-6">
        <div className="text-center py-10 text-muted-foreground">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No results found for "{searchQuery}"</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
                      <Badge className="bg-blue-500 text-[10px] px-1.5">{'\u2713'}</Badge>
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
                    {[spot.secondary_city, spot.region].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' \u00B7 ')}
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
    </div>
  );
};

export default React.memo(ExploreSearchResults);
