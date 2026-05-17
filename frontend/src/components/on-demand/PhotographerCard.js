/**
 * PhotographerCard.js - Photographer info card for dispatch/booking flows.
 * Extracted from DispatchLobby.js.
 */
import React from 'react';
import { Camera } from 'lucide-react';
import { getFullUrl } from '../../utils/media';

var PhotographerCard = ({ photographer, eta, status, isLight, wasDeclined }) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  const accepted = ['accepted', 'en_route', 'arrived'].includes(status);
  // Only show declined/searching state if the photographer actually declined (status transitioned)
  const reSearching = wasDeclined && (status === 'declined' || status === 'searching_for_pro');

  const proName = photographer?.full_name || photographer?.name || 'Photographer';

  const borderClass = accepted
    ? 'border-green-400/50 bg-green-500/10'
    : reSearching
    ? 'border-red-400/40 bg-red-500/10'
    : 'border-amber-400/30 bg-amber-500/5';

  const ringClass = accepted
    ? 'ring-2 ring-green-400'
    : reSearching
    ? 'ring-2 ring-red-400/50'
    : 'ring-2 ring-amber-400/40';

  const statusText = accepted
    ? 'En route to you'
    : reSearching
    ? 'Searching for another photographer...'
    : `Waiting for ${proName} to confirm...`;

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-2xl border transition-all duration-500 ${borderClass}`}
    >
      <div
        className={`w-12 h-12 rounded-full overflow-hidden flex-shrink-0 ${ringClass}`}
      >
        {photographer?.avatar_url || photographer?.avatar ? (
          <img loading="lazy" decoding="async"
            src={getFullUrl(photographer.avatar_url || photographer.avatar)}
            alt={photographer.full_name || photographer.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className={`w-full h-full flex items-center justify-center ${
            reSearching
              ? 'bg-gradient-to-br from-red-400 to-red-600'
              : 'bg-gradient-to-br from-amber-400 to-orange-500'
          }`}>
            <Camera className="w-6 h-6 text-black" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-sm ${textPrimary} truncate`}>
          {proName}
        </p>
        <p className={`text-xs ${reSearching ? 'text-red-400' : textSecondary}`}>
          {statusText}
        </p>
      </div>

      {accepted && eta && (
        <div className="text-right flex-shrink-0">
          <p className="text-green-400 font-bold text-lg">~{eta}</p>
          <p className="text-xs text-green-400/70">min ETA</p>
        </div>
      )}
      {reSearching && (
        <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
          <RefreshCw className="w-4 h-4 text-red-400 animate-spin animate-duration-3s" />
        </div>
      )}
      {!accepted && !reSearching && (
        <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center animate-pulse flex-shrink-0">
          <Radio className="w-4 h-4 text-amber-400" />
        </div>
      )}
    </div>
  );
};

export default PhotographerCard;
