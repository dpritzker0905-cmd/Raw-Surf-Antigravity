/**
 * SessionHistoryList — Past session history for photographers.
 * Extracted from PhotographerSessionsManager.js.
 * 
 * Features:
 * - Empty state with icon and helpful text
 * - Session cards with location, duration, surfer count, and earnings
 * - Pending review indicator (pulsing dot)
 * - Click-to-open detail drawer
 */
import React from 'react';
import { Radio, MapPin, Users } from 'lucide-react';
import { Card, CardContent } from '../ui/card';

var SessionHistoryList = ({
  sessionHistory,
  isLight,
  textPrimaryClass,
  textSecondaryClass,
  cardBgClass,
  borderClass,
  onSessionClick,
}) => {
  return (
    <div>
      <h2 className={`text-xl font-bold ${textPrimaryClass} mb-4 font-oswald`}>
        Session History
      </h2>
      
      {sessionHistory.length === 0 ? (
        <Card className={cardBgClass}>
          <CardContent className="py-12 text-center">
            <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
              <Radio className={`w-8 h-8 ${textSecondaryClass}`} />
            </div>
            <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No Past Sessions</h3>
            <p className={textSecondaryClass}>
              Your completed live sessions will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sessionHistory.map((session) => (
            <Card 
              key={session.id} 
              className={`${cardBgClass} cursor-pointer transition-all hover:ring-1 ${isLight ? 'hover:ring-amber-300' : 'hover:ring-amber-500/30'}`}
              onClick={() => onSessionClick(session)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <MapPin className={`w-4 h-4 ${textSecondaryClass} flex-shrink-0`} />
                      <span className={`${textPrimaryClass} truncate`}>{session.location}</span>
                    </div>
                    <p className={`text-sm ${textSecondaryClass} mt-1`}>
                      {new Date(session.started_at).toLocaleDateString()} · {session.duration_mins} mins
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <Users className="w-4 h-4 text-cyan-400" />
                        <span className={textPrimaryClass}>{session.total_surfers}</span>
                      </div>
                      <p className="text-green-400 font-bold">${session.total_earnings?.toFixed(2) || '0.00'}</p>
                    </div>
                    {session.has_pending_reviews && (
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500" />
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default SessionHistoryList;
