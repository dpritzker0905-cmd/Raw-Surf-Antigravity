/**
 * SurfboardAvatar — Crew member avatar with surfboard-shaped visualization.
 * Extracted from OnDemandRequestDrawer.js.
 * 
 * Used in the crew formation step to show a beach-themed crew lineup.
 */
import React from 'react';
import { X, Crown } from 'lucide-react';
import { getFullUrl } from '../../utils/media';

// Surfboard color palette for crew visualization
const SURFBOARD_COLORS = [
  'from-cyan-400 to-blue-500',
  'from-pink-400 to-rose-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
  'from-violet-400 to-purple-500',
  'from-lime-400 to-green-500',
];

const SurfboardAvatar = ({ member, index, isCaptain, onRemove, isLight }) => {
  const colorGradient = SURFBOARD_COLORS[index % SURFBOARD_COLORS.length];

  return (
    <div className="relative group flex flex-col items-center w-16">
      {/* Surfboard shape */}
      <div className={`relative w-10 h-20 rounded-full bg-gradient-to-b ${colorGradient} shadow-lg transform transition-transform group-hover:scale-110`}>
        {/* Stringer line */}
        <div className="absolute inset-x-0 top-0 bottom-0 mx-auto w-0.5 bg-white/20" />
        {/* Avatar */}
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full border-2 border-white overflow-hidden shadow-md">
          {member.avatar_url ? (
            <img loading="lazy" decoding="async"
              src={getFullUrl(member.avatar_url)}
              alt={member.full_name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${colorGradient}`}>
              <span className="text-white text-xs font-bold">
                {member.full_name?.charAt(0) || '?'}
              </span>
            </div>
          )}
        </div>
        {/* Captain crown */}
        {isCaptain && (
          <div className="absolute -top-6 left-1/2 -translate-x-1/2">
            <Crown className="w-4 h-4 text-yellow-400 fill-yellow-400" />
          </div>
        )}
        {/* Remove button */}
        {!isCaptain && onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(member.id); }}
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-10"
            aria-label={`Remove ${member.full_name} from crew`}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {/* Name */}
      <span className={`mt-2 text-[10px] font-medium truncate max-w-full text-center ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>
        {member.full_name?.split(' ')[0] || 'You'}
      </span>
      {isCaptain && (
        <span className="text-[9px] text-yellow-500 font-medium">Captain</span>
      )}
    </div>
  );
};

const EmptySeat = ({ onClick, isLight }) => {
  return (
    <div className="flex flex-col items-center w-16 cursor-pointer group" onClick={onClick}>
      <div className={`w-10 h-20 rounded-full border-2 border-dashed ${
        isLight ? 'border-gray-300 group-hover:border-cyan-400' : 'border-zinc-600 group-hover:border-cyan-400'
      } flex items-center justify-center transition-colors`}>
        <span className={`text-2xl ${isLight ? 'text-gray-300 group-hover:text-cyan-400' : 'text-zinc-600 group-hover:text-cyan-400'} transition-colors`}>+</span>
      </div>
      <span className={`mt-2 text-[10px] ${isLight ? 'text-gray-400' : 'text-zinc-500'}`}>Add</span>
    </div>
  );
};

export { SurfboardAvatar, EmptySeat, SURFBOARD_COLORS };
export default SurfboardAvatar;
