/**
 * PastTab - Completed session history
 * Extracted from Bookings.js for better maintainability
 */

import React from 'react';
import { Calendar, MapPin, History } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';

export const PastTab = ({
  pastBookings,
  theme
}) => {
  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';

  if (pastBookings.length === 0) {
    return (
      <Card className={`${cardBgClass} transition-colors duration-300`}>
        <CardContent className="py-12 text-center">
          <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
            <History className={`w-8 h-8 ${textSecondaryClass}`} />
          </div>
          <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No Past Sessions</h3>
          <p className={textSecondaryClass}>
            Your completed sessions will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {pastBookings.map((booking) => (
        <Card key={booking.id} className={`${cardBgClass} transition-colors duration-300`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-2">
              <h3 className={`font-medium ${textPrimaryClass}`}>Surf Photo Session</h3>
              <Badge variant="secondary">Completed</Badge>
            </div>
            <div className={`flex items-center gap-2 text-sm ${textSecondaryClass}`}>
              <MapPin className="w-4 h-4" />
              <span>{booking.location}</span>
            </div>
            <div className={`flex items-center gap-2 text-sm ${textSecondaryClass} mt-1`}>
              <Calendar className="w-4 h-4" />
              <span>{new Date(booking.session_date).toLocaleDateString()}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default PastTab;
