/**
 * FindBuddiesTab - Find nearby sessions to split costs and meet surfers
 * Extracted from Bookings.js for better maintainability
 */

import React from 'react';
import { Calendar, MapPin, Clock, Users, Award, Target, UserPlus } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

export const FindBuddiesTab = ({
  nearbyBookings,
  selectedSkillFilter,
  onSkillFilterChange,
  onJoinNearbyBooking,
  theme
}) => {
  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';

  return (
    <>
      {/* Skill Level Filter */}
      <Card className={`${cardBgClass} mb-4`}>
        <CardContent className="p-4">
          <h4 className={`text-sm font-medium ${textPrimaryClass} mb-3`}>Filter by Skill Level</h4>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedSkillFilter === null ? 'default' : 'outline'}
              size="sm"
              onClick={() => onSkillFilterChange(null)}
              className={selectedSkillFilter === null ? 'bg-cyan-500 text-black' : ''}
            >
              All Levels
            </Button>
            {['Beginner', 'Intermediate', 'Advanced', 'Expert'].map((level) => (
              <Button
                key={level}
                variant={selectedSkillFilter === level ? 'default' : 'outline'}
                size="sm"
                onClick={() => onSkillFilterChange(level)}
                className={selectedSkillFilter === level ? 'bg-cyan-500 text-black' : ''}
              >
                <Award className="w-3 h-3 mr-1" />
                {level}
              </Button>
            ))}
          </div>
          <p className={`text-xs ${textSecondaryClass} mt-2`}>
            {selectedSkillFilter 
              ? `Showing sessions with ${selectedSkillFilter} surfers - surf with people at your level!`
              : 'Find sessions nearby to split costs and make new surf buddies!'
            }
          </p>
        </CardContent>
      </Card>
      
      {nearbyBookings.length === 0 ? (
        <Card className={`${cardBgClass} transition-colors duration-300`}>
          <CardContent className="py-12 text-center">
            <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
              <Target className={`w-8 h-8 ${textSecondaryClass}`} />
            </div>
            <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No Nearby Sessions</h3>
            <p className={textSecondaryClass}>
              {selectedSkillFilter 
                ? `No ${selectedSkillFilter} level sessions found nearby. Try a different skill level!`
                : 'No splittable sessions found nearby. Check back later or create your own!'
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        nearbyBookings.map((booking) => (
          <Card key={booking.id} className={`${cardBgClass} transition-colors duration-300 mb-4`} data-testid={`nearby-booking-${booking.id}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className={`font-medium ${textPrimaryClass}`}>
                    {booking.photographer_name}'s Session
                  </h3>
                  <p className={`text-sm ${textSecondaryClass}`}>
                    Created by {booking.creator_name}
                    {booking.creator_skill && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        {booking.creator_skill}
                      </Badge>
                    )}
                  </p>
                </div>
                <Badge className="bg-green-500/20 text-green-400">
                  {booking.distance} mi away
                </Badge>
              </div>
              
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className={`flex items-center gap-2 text-sm ${textSecondaryClass}`}>
                  <MapPin className="w-4 h-4" />
                  <span>{booking.location}</span>
                </div>
                <div className={`flex items-center gap-2 text-sm ${textSecondaryClass}`}>
                  <Calendar className="w-4 h-4" />
                  <span>{new Date(booking.session_date).toLocaleDateString()}</span>
                </div>
                <div className={`flex items-center gap-2 text-sm ${textSecondaryClass}`}>
                  <Clock className="w-4 h-4" />
                  <span>{new Date(booking.session_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
                <div className={`flex items-center gap-2 text-sm ${textSecondaryClass}`}>
                  <Users className="w-4 h-4" />
                  <span>{booking.current_participants}/{booking.max_participants} joined</span>
                </div>
              </div>
              
              {/* Participant Skill Levels */}
              {booking.participant_skills?.length > 0 && (
                <div className={`mb-3 p-2 rounded ${isLight ? 'bg-gray-100' : 'bg-zinc-800'}`}>
                  <p className={`text-xs font-medium ${textSecondaryClass} mb-1`}>Current Participants:</p>
                  <div className="flex flex-wrap gap-1">
                    {booking.participant_skills.map((p, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {p.name} ({p.skill_level})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Skill Level Filter Badge */}
              {booking.skill_level_filter && (
                <div className="mb-3">
                  <Badge className="bg-purple-500/20 text-purple-400">
                    <Award className="w-3 h-3 mr-1" />
                    {booking.skill_level_filter} Level Only
                  </Badge>
                </div>
              )}
              
              <div className={`flex items-center justify-between pt-3 border-t ${isLight ? 'border-gray-200' : 'border-zinc-700'}`}>
                <div>
                  <p className="text-lg font-bold text-green-400">
                    ${booking.split_price?.toFixed(0)} <span className="text-xs font-normal">per person</span>
                  </p>
                  <p className={`text-xs ${textSecondaryClass}`}>
                    Split {booking.max_participants} ways
                  </p>
                </div>
                <Button
                  onClick={() => onJoinNearbyBooking(booking.id)}
                  className="bg-gradient-to-r from-emerald-400 to-green-500 text-black"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Join Session
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </>
  );
};

export default FindBuddiesTab;
