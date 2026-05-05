/**
 * SpotConditionCard â€” Displays a surf spot with real-time conditions overlay.
 * Extracted from Explore.js to reduce file size and improve reusability.
 * 
 * Features:
 * - Tagged content (photo/video) from community members
 * - Wave height badge with conditions label
 * - Map fallback when no image is available
 * - Contributor credit with role-based emoji
 */
import React from 'react';
import { MapPin, Waves, Play } from 'lucide-react';

const SpotConditionCard = ({ spot, conditions, onNavigate }) => {
  const thumbnail = spot.thumbnail;
  const hasTaggedContent = thumbnail && thumbnail.media_url;
  
  // Determine the display image/content
  const displayImage = hasTaggedContent 
    ? (thumbnail.media_type === 'video' ? thumbnail.thumbnail_url || thumbnail.media_url : thumbnail.media_url)
    : spot.image_url;
  
  return (
    <div
      onClick={() => onNavigate(`/spot-hub/${spot.id}`)}
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
            if (spot.latitude && spot.longitude) {
              e.target.onerror = () => {
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
                ? 'ðŸ“¸' 
                : 'ðŸ„'} {thumbnail.contributor_name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(SpotConditionCard);
