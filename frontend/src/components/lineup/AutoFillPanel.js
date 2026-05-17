import React, { useState } from 'react';
import { Sparkles, Loader2, ChevronDown, ChevronUp, Zap, Users, Send } from 'lucide-react';
import { getFullUrl } from '../../utils/media';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

var AutoFillPanel = ({ 
  suggestions, 
  spotsLeft, 
  onInvite, 
  onInviteAll,
  inviting, 
  isLight 
}) => {
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const _textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const [expanded, setExpanded] = useState(true);
  
  const allSuggestions = [
    ...suggestions.mutual_friends.map(f => ({ ...f, type: 'friend' })),
    ...suggestions.nearby_public.map(u => ({ ...u, type: 'nearby' }))
  ].slice(0, 6);
  
  if (allSuggestions.length === 0) return null;
  
  return (
    <div className={`rounded-xl overflow-hidden ${
      isLight 
        ? 'bg-gradient-to-br from-purple-50 to-cyan-50 border border-purple-200' 
        : 'bg-gradient-to-br from-purple-500/10 to-cyan-500/10 border border-purple-500/30'
    }`}>
      {/* Header - Collapsible */}
      <button aria-label="Sparkles"
        aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          <span className={`font-medium ${textPrimary}`}>Quick Fill {spotsLeft} Seat{spotsLeft > 1 ? 's' : ''}</span>
          <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">
            <Zap className="w-3 h-3 mr-1" />
            Auto-Suggest
          </Badge>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      
      {expanded && (
        <div className="p-3 pt-0 space-y-3">
          {/* Invite All Button */}
          {allSuggestions.length >= 2 && spotsLeft >= 2 && (
            <Button aria-label="Users"
              onClick={() => onInviteAll(allSuggestions.slice(0, spotsLeft))}
              disabled={inviting}
              size="sm"
              className="w-full bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white"
            >
              <Users className="w-4 h-4 mr-2" />
              Invite All ({Math.min(allSuggestions.length, spotsLeft)}) to Fill Lineup
            </Button>
          )}
          
          {/* Individual suggestions */}
          <div className="grid grid-cols-2 gap-2">
            {allSuggestions.slice(0, 4).map((person) => (
              <button aria-label="div"
                key={person.user_id}
                onClick={() => onInvite(person)}
                disabled={inviting === person.user_id}
                className={`flex items-center gap-2 p-2 rounded-lg ${
                  isLight ? 'bg-white hover:bg-gray-50' : 'bg-zinc-800/80 hover:bg-zinc-700'
                } border ${isLight ? 'border-gray-200' : 'border-zinc-600'} transition-all disabled:opacity-50`}
              >
                <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
                  {person.avatar_url ? (
                    <img loading="lazy" decoding="async" src={getFullUrl(person.avatar_url)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br from-cyan-400 to-blue-500 text-white text-sm font-bold`}>
                      {person.full_name?.[0] || '?'}
                    </div>
                  )}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className={`text-sm font-medium ${textPrimary} truncate`}>{person.full_name?.split(' ')[0]}</p>
                  <p className={`text-xs ${person.type === 'friend' ? 'text-green-400' : 'text-blue-400'}`}>
                    {person.type === 'friend' ? 'Friend' : 'Nearby'}
                  </p>
                </div>
                {inviting === person.user_id ? (
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                ) : (
                  <Send className="w-4 h-4 text-cyan-400" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Main Component

export default AutoFillPanel;
