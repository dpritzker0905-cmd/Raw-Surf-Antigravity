import React from 'react';
import { Camera, X } from 'lucide-react';
import { getFullUrl } from '../../utils/media';
import { useTheme } from '../../contexts/ThemeContext';

var FeaturedPhotographersPanel = ({
  featuredPhotographers,
  onClose,
  onPhotographerSelect,
}) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';

  const bgClass = isBeach ? 'bg-amber-50/95 border-amber-200' : isLight ? 'bg-white/95 border-gray-200' : 'bg-zinc-900/95 border-zinc-700';
  const headerBgClass = isBeach ? 'bg-amber-50/95' : isLight ? 'bg-white/95' : 'bg-zinc-900/95';
  const textClass = isLight || isBeach ? 'text-gray-900' : 'text-white';
  const textMuted = isLight || isBeach ? 'text-gray-500' : 'text-gray-400';
  const hoverClass = isLight || isBeach ? 'hover:bg-gray-100' : 'hover:bg-zinc-700/50';
  const cardBgClass = isBeach ? 'bg-amber-100/50' : isLight ? 'bg-gray-50' : 'bg-zinc-800/50';
  const avatarBg = isLight || isBeach ? 'bg-gray-200' : 'bg-zinc-700';
  const borderClass = isLight || isBeach ? 'border-gray-200' : 'border-zinc-700';
  const iconBorder = isLight || isBeach ? 'border-white' : 'border-zinc-900';

  if (!featuredPhotographers || featuredPhotographers.length === 0) return null;

  return (
    <div className="absolute top-44 right-4 z-[1000] w-72 max-h-[60vh] overflow-y-auto">
      <div className={`${bgClass} backdrop-blur-sm rounded-lg border shadow-xl`}>
        <div className={`p-3 border-b ${borderClass} flex items-center justify-between sticky top-0 z-10 ${headerBgClass}`}>
          <h3 className={`text-sm font-bold flex items-center gap-2 ${textClass}`}>
            <Camera className="w-4 h-4 text-yellow-400" />
            Featured Photographers
          </h3>
          <button onClick={onClose} className={`${textMuted} hover:text-cyan-500`} aria-label="Close featured photographers">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-2 space-y-2">
          {featuredPhotographers.map((photographer) => (
            <div
              key={photographer.id}
              className={`p-3 rounded-lg ${cardBgClass} ${hoverClass} transition-colors cursor-pointer`}
              onClick={() => onPhotographerSelect(photographer)}
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className={`w-10 h-10 rounded-full ${avatarBg} overflow-hidden flex items-center justify-center`}>
                    {photographer.avatar_url ? (
                      <img loading="lazy" decoding="async" src={getFullUrl(photographer.avatar_url)} alt={photographer.full_name} className="w-full h-full object-cover" />
                    ) : (
                      <Camera className={`w-5 h-5 ${textMuted}`} />
                    )}
                  </div>
                  {photographer.is_live && (
                    <div className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 ${iconBorder} flex items-center justify-center`}>
                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${textClass}`}>
                    {photographer.full_name}
                    {photographer.is_verified && (
                      <span className="ml-1 text-blue-400">{'\u2713'}</span>
                    )}
                  </p>
                  <p className={`text-xs truncate ${textMuted}`}>
                    {photographer.location || photographer.current_spot || 'No location'}
                  </p>
                </div>
                <div className="text-right">
                  {photographer.is_live ? (
                    <span className="text-xs text-green-400 font-medium">LIVE</span>
                  ) : (
                    <span className="text-xs text-yellow-400">${photographer.session_price}</span>
                  )}
                </div>
              </div>
              <div className={`flex items-center gap-3 mt-2 text-xs ${textMuted}`}>
                <span>{photographer.total_sessions || 0} sessions</span>
                <span>-</span>
                <span>{photographer.gallery_count || 0} photos</span>
                {photographer.total_earnings > 0 && (
                  <>
                    <span>-</span>
                    <span className="text-green-400">${photographer.total_earnings.toFixed(0)} earned</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FeaturedPhotographersPanel;
