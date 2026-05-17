/**
 * GallerySessionPanel - Session context panel with participant roster & distribution
 * Extracted from PhotographerGalleryManager.js for modularization (v74)
 */
import React from 'react';
import {
  CheckCircle, AlertCircle, Link2, RefreshCw, Send, Loader2, Users,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { getFullUrl } from '../../utils/media';

const GallerySessionPanel = ({
  sessionInfo, sessionParticipants, totalGalleryItems,
  loadingParticipants, distributing,
  fetchSessionParticipants, handleDistributeAll,
  handleDistributeToSurfer, setShowLinkSessionModal,
  fetchRecentSessions,
  cardBgClass, textPrimaryClass, textSecondaryClass, isLight,
}) => (
  <Card className={`mb-6 ${cardBgClass} overflow-hidden`}>
    <CardContent className="p-0">
      {/* Session Header Banner */}
      {sessionInfo?.is_linked ? (
        <div className="bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border-b border-emerald-500/30 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              <span className={`font-medium ${textPrimaryClass}`}>
                {sessionInfo.session_type === 'live' ? 'Live Session' : 
                 sessionInfo.session_type === 'booking' ? 'Booked Session' : 
                 sessionInfo.session_type === 'on_demand' ? 'On-Demand' : 'Session'} Linked
              </span>
              <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 text-[10px]">
                {sessionInfo.session_type}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-emerald-400 hover:text-emerald-300 h-7 px-2"
                onClick={fetchSessionParticipants}
                disabled={loadingParticipants}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingParticipants ? 'animate-spin' : ''}`} />
              </Button>
              {sessionParticipants.length > 0 && totalGalleryItems > 0 && (
                <Button aria-label="Loader2"
                  size="sm"
                  onClick={handleDistributeAll}
                  disabled={distributing === 'all'}
                  className="bg-gradient-to-r from-emerald-400 to-cyan-500 text-black h-7 px-3 text-xs font-medium"
                >
                  {distributing === 'all' ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5 mr-1" />
                  )}
                  Distribute All
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-r from-amber-500/15 to-orange-500/15 border-b border-amber-500/30 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-400" />
              <span className={`font-medium ${textPrimaryClass}`}>No Session Linked</span>
              <span className={`text-xs ${textSecondaryClass}`}>Distribution unavailable</span>
            </div>
            <Button aria-label="Link2"
              size="sm"
              onClick={() => { setShowLinkSessionModal(true); fetchRecentSessions(); }}
              className="bg-gradient-to-r from-amber-400 to-orange-500 text-black h-7 px-3 text-xs font-medium"
            >
              <Link2 className="w-3.5 h-3.5 mr-1" /> Link Session
            </Button>
          </div>
        </div>
      )}

      {/* Participant Roster */}
      {loadingParticipants ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
          <span className={`ml-2 text-sm ${textSecondaryClass}`}>Loading participants...</span>
        </div>
      ) : sessionParticipants.length > 0 ? (
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <p className={`text-xs font-medium uppercase tracking-wider ${textSecondaryClass}`}>
              Participants ({sessionParticipants.length})
            </p>
            <p className={`text-xs ${textSecondaryClass}`}>
              {totalGalleryItems} items in gallery
            </p>
          </div>
          <div className="space-y-2">
            {sessionParticipants.map((participant) => {
              const progress = totalGalleryItems > 0 
                ? Math.round((participant.items_distributed / totalGalleryItems) * 100) 
                : 0;
              const isFullyDistributed = participant.items_distributed >= totalGalleryItems && totalGalleryItems > 0;
              
              return (
                <div
                  key={participant.surfer_id}
                  className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                    isLight ? 'bg-gray-50 hover:bg-gray-100' : 'bg-zinc-800/50 hover:bg-zinc-800'
                  }`}
                >
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0 ring-2 ring-offset-1 ring-offset-transparent ring-cyan-500/30">
                    {participant.avatar_url ? (
                      <img loading="lazy" decoding="async"
                        src={getFullUrl(participant.avatar_url)}
                        alt={participant.full_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Users className="w-4 h-4 m-auto mt-2.5 text-zinc-500" />
                    )}
                  </div>

                  {/* Name + Status */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${textPrimaryClass}`}>
                      {participant.full_name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {/* Distribution progress bar */}
                      <div className={`flex-1 h-1.5 rounded-full ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} max-w-[100px]`}>
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isFullyDistributed ? 'bg-emerald-400' : progress > 0 ? 'bg-cyan-400' : 'bg-zinc-600'
                          }`}
                          style={{ width: `${Math.min(progress, 100)}%` }}
                        />
                      </div>
                      <span className={`text-[10px] ${textSecondaryClass}`}>
                        {participant.items_distributed}/{totalGalleryItems}
                      </span>
                      {isFullyDistributed && (
                        <CheckCircle className="w-3 h-3 text-emerald-400" />
                      )}
                    </div>
                  </div>

                  {/* Action Button */}
                  {!isFullyDistributed ? (
                    <Button aria-label="Loader2"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDistributeToSurfer(participant.surfer_id, participant.full_name)}
                      disabled={distributing === participant.surfer_id || totalGalleryItems === 0}
                      className="h-7 px-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                    >
                      {distributing === participant.surfer_id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5 mr-1" />
                          <span className="text-xs">Push</span>
                        </>
                      )}
                    </Button>
                  ) : (
                    <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 text-[10px] h-7">
                      G£à Delivered
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : sessionInfo?.is_linked ? (
        <div className={`text-center py-6 ${textSecondaryClass}`}>
          <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No participants found for this session</p>
        </div>
      ) : null}
    </CardContent>
  </Card>
);

export default GallerySessionPanel;
