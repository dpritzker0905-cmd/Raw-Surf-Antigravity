/**
 * ExploreTrending.js
 * Extracted from Explore.js — Trending section shown on the 'all' tab.
 * Includes: Broadcasting Now, Popular Spots, Trending Posts, Ad Card, Empty State
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, MapPin, Image, TrendingUp, Radio, Waves, Play
} from 'lucide-react';
import { getFullUrl } from '../../utils/media';
import { SocialAdCard } from '../SocialAdCard';
import PostMediaPreview from './PostMediaPreview';

const ExploreTrending = ({
  trending,
  spotConditions,
  user,
}) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-8">
      {/* Social Live Now - Users broadcasting to followers (Instagram Live style) */}
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
            {trending.popular_spots.slice(0, 4).map((spot) => {
              const conditions = spotConditions[spot.id];
              const thumbnail = spot.thumbnail;
              const hasTaggedContent = thumbnail && thumbnail.media_url;
              
              // Determine the display image/content
              const displayImage = hasTaggedContent 
                ? (thumbnail.media_type === 'video' ? thumbnail.thumbnail_url || thumbnail.media_url : thumbnail.media_url)
                : spot.image_url;
              
              return (
                <div
                  key={spot.id}
                  onClick={() => navigate(`/spot-hub/${spot.id}`)}
                  className="relative aspect-[4/3] rounded-xl overflow-hidden cursor-pointer group"
                  data-testid={`trending-spot-${spot.id}`}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent z-10" />
                  
                  {/* Content: Tagged media, spot image, or map fallback */}
                  {displayImage ? (
                    <img loading="lazy" decoding="async" 
                      src={displayImage} 
                      alt={spot.name} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform" 
                      onError={(e) => {
                        // If primary image fails, try map fallback
                        if (spot.latitude && spot.longitude) {
                          e.target.onerror = () => {
                            // Map also failed - show gradient
                            e.target.style.display = 'none';
                            e.target.parentElement.classList.add('bg-gradient-to-br', 'from-cyan-600', 'to-blue-800');
                          };
                          e.target.src = `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${spot.longitude},${spot.latitude}&z=12&l=sat&size=400,300`;
                          e.target.className = 'w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity';
                        } else {
                          e.target.style.display = 'none';
                          e.target.parentElement.classList.add('bg-gradient-to-br', 'from-cyan-600', 'to-blue-800');
                        }
                      }}
                    />
                  ) : spot.latitude && spot.longitude ? (
                    // Map fallback with location pin
                    <div className="w-full h-full bg-muted relative">
                      <img loading="lazy" decoding="async" 
                        src={`https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${spot.longitude},${spot.latitude}&z=12&l=sat&size=400,300`}
                        alt={`Map of ${spot.name}`}
                        className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.parentElement.classList.add('bg-gradient-to-br', 'from-cyan-600', 'to-blue-800');
                        }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <MapPin className="w-8 h-8 text-cyan-400 drop-shadow-lg" />
                      </div>
                    </div>
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-cyan-600 to-blue-800 flex items-center justify-center">
                      <MapPin className="w-8 h-8 text-white/30" />
                    </div>
                  )}
                  
                  {/* Wave Height Badge */}
                  {conditions?.wave_height_ft !== undefined && (
                    <div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-blue-500/80 backdrop-blur-sm rounded-full px-2 py-1">
                      <Waves className="w-3 h-3 text-foreground" />
                      <span className="text-xs font-bold text-foreground">{conditions.wave_height_ft}ft</span>
                    </div>
                  )}
                  
                  {/* Video indicator */}
                  {hasTaggedContent && thumbnail.media_type === 'video' && (
                    <div className="absolute top-2 left-2 z-20 bg-black/60 backdrop-blur-sm rounded-full p-1.5">
                      <Play className="w-3 h-3 text-foreground fill-white" />
                    </div>
                  )}
                  
                  {/* Spot info */}
                  <div className="absolute bottom-0 left-0 right-0 p-3 z-20">
                    <h4 className="font-medium text-foreground truncate">{spot.name}</h4>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-300">{spot.region}</p>
                      {conditions?.conditions_label && (
                        <span className="text-[10px] text-blue-300">{conditions.conditions_label}</span>
                      )}
                    </div>
                    
                    {/* Contributor credit */}
                    {hasTaggedContent && thumbnail.contributor_name && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {thumbnail.contributor_avatar ? (
                          <img loading="lazy" decoding="async" 
                            src={thumbnail.contributor_avatar} 
                            alt={thumbnail.contributor_name} 
                            className="w-4 h-4 rounded-full border border-white/30"
                          />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-zinc-600 flex items-center justify-center">
                            <span className="text-[8px] text-foreground">{thumbnail.contributor_name.charAt(0)}</span>
                          </div>
                        )}
                        <span className="text-[10px] text-muted-foreground truncate">
                          {['PHOTOGRAPHER', 'APPROVED_PRO', 'HOBBYIST'].includes(thumbnail.contributor_role?.toUpperCase()) 
                            ? '\u{1F4F8}' 
                            : '\u{1F3C4}'} {thumbnail.contributor_name}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Trending Posts */}
      {trending.trending_posts.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Image className="w-5 h-5 text-emerald-400" />
            <h3 className="font-semibold text-foreground">Trending Posts</h3>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {trending.trending_posts.map((post) => (
              <div
                key={post.id}
                className="aspect-square bg-muted overflow-hidden cursor-pointer group relative"
                onClick={() => navigate(`/post/${post.id}`)}
                data-testid={`trending-post-${post.id}`}
              >
                <PostMediaPreview post={post} isHoverScale={false} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Ad Card for ad-supported users */}
      {user?.is_ad_supported && (
        <SocialAdCard position={0} />
      )}

      {/* Empty State */}
      {trending.live_photographers?.length === 0 && trending.popular_spots?.length === 0 && trending.trending_posts?.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <Search className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium mb-2">Discover the surf community</p>
          <p className="text-sm">Search for surfers, photographers, and surf spots</p>
        </div>
      )}
    </div>
  );
};

export default React.memo(ExploreTrending);
