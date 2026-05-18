/**
 * TrendingSection Displays the Explore discovery feed.
 * Extracted from Explore.js to reduce monolith size.
 * 
 * Contains:
 * - Broadcasting Now (live photographers)
 * - Popular Spots with conditions
 * - Trending Posts
 */
import React from 'react';
import { Radio, TrendingUp, Image } from 'lucide-react';
import { getFullUrl } from '../../utils/media';
import SpotConditionCard from './SpotConditionCard';

const TrendingSection = ({
  trending,
  spotConditions,
  navigate,
  isLight
}) => {
  if (!trending) return null;

  return (
    <div className="space-y-8">
      {/* Social Live Now - Users broadcasting to followers */}
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
            {trending.popular_spots.slice(0, 4).map((spot) => (
              <SpotConditionCard
                key={spot.id}
                spot={spot}
                conditions={spotConditions[spot.id]}
                onNavigate={navigate}
              />
            ))}
          </div>
        </section>
      )}

      {/* Trending Posts */}
      {trending.trending_posts?.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Image className="w-5 h-5 text-emerald-400" />
            <h3 className="font-semibold text-foreground">Trending Posts</h3>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {trending.trending_posts.map((post) => (
              <div
                key={post.id}
                onClick={() => navigate(`/post/${post.id}`)}
                className="aspect-square rounded-lg overflow-hidden cursor-pointer group"
                data-testid={`trending-post-${post.id}`}
              >
                {post.media_url ? (
                  <img
                    loading="lazy"
                    decoding="async"
                    src={post.media_url}
                    alt={post.caption || 'Post'}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-cyan-600 to-blue-800" />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {trending.live_photographers?.length === 0 && trending.popular_spots?.length === 0 && trending.trending_posts?.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No trending content yet. Check back soon!</p>
        </div>
      )}
    </div>
  );
};

export default TrendingSection;
