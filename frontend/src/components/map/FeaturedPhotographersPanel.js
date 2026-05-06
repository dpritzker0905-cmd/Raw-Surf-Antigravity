import React from 'react';
import { Camera, X } from 'lucide-react';
import { getFullUrl } from '../../utils/media';

const FeaturedPhotographersPanel = ({
  featuredPhotographers,
  onClose,
  onPhotographerSelect,
}) => {
  if (!featuredPhotographers || featuredPhotographers.length === 0) return null;

  return (
    <div className="absolute top-44 right-4 z-[1000] w-72 max-h-[60vh] overflow-y-auto">
      <div className="bg-zinc-900/95 backdrop-blur-sm rounded-lg border border-zinc-700 shadow-xl">
        <div className="p-3 border-b border-zinc-700 flex items-center justify-between sticky top-0 bg-zinc-900/95">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Camera className="w-4 h-4 text-yellow-400" />
            Featured Photographers
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-2 space-y-2">
          {featuredPhotographers.map((photographer) => (
            <div
              key={photographer.id}
              className="p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 transition-colors cursor-pointer"
              onClick={() => onPhotographerSelect(photographer)}
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-zinc-700 overflow-hidden flex items-center justify-center">
                    {photographer.avatar_url ? (
                      <img loading="lazy" decoding="async" src={getFullUrl(photographer.avatar_url)} alt={photographer.full_name} className="w-full h-full object-cover" />
                    ) : (
                      <Camera className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                  {photographer.is_live && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 border-zinc-900 flex items-center justify-center">
                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {photographer.full_name}
                    {photographer.is_verified && (
                      <span className="ml-1 text-blue-400">{'\u2713'}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
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
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
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
