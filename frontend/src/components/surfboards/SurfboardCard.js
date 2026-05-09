import React from 'react';
import { Waves } from 'lucide-react';
import { Badge } from '../ui/badge';
import { CONDITIONS } from './constants';

export const SurfboardCard = ({ board, onClick, isLight }) => {
  const primaryPhoto = board.photo_urls?.[board.primary_photo_index || 0];
  const conditionInfo = CONDITIONS.find(c => c.value === board.condition);
  
  return (
    <div data-testid="surfboards-tab" 
      onClick={onClick}
      className={`relative aspect-[3/4] rounded-xl overflow-hidden cursor-pointer group transition-all hover:scale-[1.02] ${
        isLight ? 'bg-gray-100' : 'bg-zinc-800'
      }`}
    >
      {primaryPhoto ? (
        <img loading="lazy" decoding="async" 
          src={primaryPhoto} 
          alt={board.name || 'Surfboard'} 
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Waves className={`w-12 h-12 ${isLight ? 'text-gray-300' : 'text-zinc-600'}`} />
        </div>
      )}
      
      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      
      {/* Info overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform">
        <p className="text-white font-medium text-sm truncate">
          {board.brand || 'Unknown'} {board.model || ''}
        </p>
        {board.dimensions_display && (
          <p className="text-gray-300 text-xs">{board.dimensions_display}</p>
        )}
        {conditionInfo && (
          <Badge className={`mt-1 ${conditionInfo.color} bg-black/50 text-xs`}>
            {conditionInfo.label}
          </Badge>
        )}
      </div>
      
      {/* Photo count badge */}
      {board.photo_urls?.length > 1 && (
        <div className="absolute top-2 right-2 bg-black/60 px-2 py-0.5 rounded-full">
          <span className="text-white text-xs">{board.photo_urls.length}</span>
        </div>
      )}
    </div>
  );
};
