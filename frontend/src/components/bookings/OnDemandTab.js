/**
 * OnDemandTab - On-demand photographer requests
 * Extracted from Bookings.js for better maintainability
 */

import React from 'react';
import { Camera, MapPin, DollarSign, ChevronRight, Star, Radio, Loader2, Users, Zap } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { CrewPaymentProgress } from '../dispatch/CrewPaymentProgress';
import { getFullUrl } from '../../utils/media';
import { ROLES } from '../../constants/roles';

export const OnDemandTab = ({
  user,
  onDemandPhotographers,
  onDemandLoading,
  userLocation,
  activeDispatch,
  onRefresh,
  onSelectPhotographer,
  onResumeDispatch,
  crewInvites = [],
  onPayCrewShare,
  theme
}) => {
  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';
  
  // Determine if user is crew member vs captain
  const isCrewMember = activeDispatch?.role === 'crew_member';

  return (
    <>
      {/* ─── Crew Session Invites ──────────────────────────────────────────── */}
      {crewInvites.length > 0 && (
        <div className="mb-4 space-y-3">
          <p className={`text-xs font-semibold uppercase tracking-wider ${textSecondaryClass} flex items-center gap-2`}>
            <Users className="w-3.5 h-3.5 text-cyan-400" />
            You've been invited to join a session
          </p>
          {crewInvites.map((invite) => (
            <Card
              key={invite.id}
              className="bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border-2 border-cyan-400/50 cursor-pointer hover:border-cyan-400 transition-all"
              onClick={() => onPayCrewShare?.(invite)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  {/* Captain avatar */}
                  <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 ring-2 ring-cyan-400">
                    {invite.captain?.avatar_url ? (
                      <img src={getFullUrl(invite.captain.avatar_url)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                        <Users className="w-6 h-6 text-white" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`font-bold text-sm ${textPrimaryClass}`}>
                      {invite.captain?.full_name || 'A friend'} invited you!
                    </p>
                    <p className={`text-xs ${textSecondaryClass} truncate`}>
                      {invite.location_name || 'On-demand session'}
                      {invite.share_amount && ` · Your share: $${Number(invite.share_amount).toFixed(2)}`}
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge className="bg-cyan-500/30 text-cyan-300 border-0 text-xs">
                      <Zap className="w-3 h-3 mr-1" />
                      Join
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-cyan-400" />
                  </div>
                </div>

                <Button
                  className="w-full mt-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold py-2 text-sm"
                  onClick={(e) => { e.stopPropagation(); onPayCrewShare?.(invite); }}
                >
                  <Zap className="w-4 h-4 mr-1" />
                  Join & Pay Your Share
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Active Dispatch Card - Different UI for Captain vs Crew Member */}
      {activeDispatch && ['searching_for_pro', 'pending_payment', 'accepted', 'en_route', 'arrived'].includes(activeDispatch.status) && (
        <Card 
          className={`border-2 cursor-pointer transition-all mb-4 ${
            isCrewMember 
              ? 'bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border-cyan-400/50 hover:border-cyan-400'
              : 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-amber-400/50 hover:border-amber-400'
          }`}
          onClick={() => onResumeDispatch?.(activeDispatch)}
        >
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
                  isCrewMember ? 'bg-cyan-500/20' : 'bg-amber-500/20'
                }`}>
                  <Radio className={`w-7 h-7 animate-pulse ${
                    isCrewMember ? 'text-cyan-400' : 'text-amber-400'
                  }`} />
                </div>
                <div className={`absolute -top-1 -right-1 w-4 h-4 rounded-full animate-ping ${
                  isCrewMember ? 'bg-cyan-400' : 'bg-amber-400'
                }`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className={`font-bold ${textPrimaryClass}`}>
                    {isCrewMember ? (
                      <>
                        {activeDispatch.status === 'searching_for_pro' && 'Session Active - Finding Photographer'}
                        {activeDispatch.status === 'pending_payment' && 'Waiting for Captain to Pay'}
                        {activeDispatch.status === 'accepted' && 'Photographer Confirmed!'}
                        {activeDispatch.status === 'en_route' && 'Photographer On The Way!'}
                        {activeDispatch.status === 'arrived' && 'Photographer Has Arrived!'}
                      </>
                    ) : (
                      <>
                        {activeDispatch.status === 'searching_for_pro' && 'Finding Your Photographer'}
                        {activeDispatch.status === 'pending_payment' && 'Pending Payment'}
                        {activeDispatch.status === 'accepted' && 'Photographer Accepted!'}
                        {activeDispatch.status === 'en_route' && 'Photographer On The Way'}
                        {activeDispatch.status === 'arrived' && 'Photographer Arrived!'}
                      </>
                    )}
                  </h3>
                  {['searching_for_pro', 'en_route'].includes(activeDispatch.status) && (
                    <Loader2 className={`w-4 h-4 animate-spin ${
                      isCrewMember ? 'text-cyan-400' : 'text-amber-400'
                    }`} />
                  )}
                </div>
                <p className={`text-sm ${textSecondaryClass}`}>
                  {isCrewMember ? (
                    <>
                      {activeDispatch.status === 'searching_for_pro' && (
                        `Session with ${activeDispatch.requester_name || 'your crew'} at ${activeDispatch.location_name || 'the spot'}`
                      )}
                      {activeDispatch.status === 'accepted' && (
                        `${activeDispatch.photographer_name || 'Photographer'} is joining your session`
                      )}
                      {activeDispatch.status === 'en_route' && (
                        `ETA: ${activeDispatch.eta_minutes || '?'} min • Meet at ${activeDispatch.location_name || 'the spot'}`
                      )}
                      {activeDispatch.status === 'arrived' && (
                        `Look for ${activeDispatch.photographer_name || 'your photographer'}!`
                      )}
                    </>
                  ) : (
                    <>
                      {activeDispatch.status === 'searching_for_pro' && (
                        activeDispatch.photographer_name 
                          ? `Waiting for ${activeDispatch.photographer_name} to accept...`
                          : `Searching near ${activeDispatch.location_name || 'your location'}...`
                      )}
                      {activeDispatch.status === 'pending_payment' && 'Complete payment to continue'}
                      {activeDispatch.status === 'accepted' && `${activeDispatch.photographer_name || 'Photographer'} is getting ready`}
                      {activeDispatch.status === 'en_route' && `ETA: ${activeDispatch.eta_minutes || '?'} minutes`}
                      {activeDispatch.status === 'arrived' && 'Your photographer is here!'}
                    </>
                  )}
                </p>
                
                {/* Crew Info for Crew Members */}
                {isCrewMember && activeDispatch.crew && activeDispatch.crew.length > 0 && (
                  <div className="flex items-center gap-1 mt-2">
                    <span className={`text-xs ${textSecondaryClass}`}>With:</span>
                    {activeDispatch.crew.slice(0, 3).map((member, idx) => (
                      <div key={idx} className="w-6 h-6 rounded-full bg-zinc-700 overflow-hidden border border-cyan-400/30">
                        {member.avatar_url ? (
                          <img src={getFullUrl(member.avatar_url)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-cyan-400">
                            {member.name?.charAt(0) || '?'}
                          </div>
                        )}
                      </div>
                    ))}
                    {activeDispatch.crew.length > 3 && (
                      <span className="text-xs text-cyan-400">+{activeDispatch.crew.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
              <ChevronRight className={`w-5 h-5 ${
                isCrewMember ? 'text-cyan-400' : 'text-amber-400'
              }`} />
            </div>
            
            {/* Crew Payment Progress - Show when this is a crew session with pending payments */}
            {activeDispatch?.is_shared && activeDispatch?.crew && activeDispatch.crew.length > 0 && (
              <div className="mt-4 pt-4 border-t border-zinc-700/50" onClick={(e) => e.stopPropagation()}>
                <CrewPaymentProgress
                  dispatchId={activeDispatch.id}
                  serviceType="dispatch"
                  currentUserId={user?.id}
                  isCaptain={activeDispatch.requester_id === user?.id}
                  onRefresh={onRefresh}
                  theme={theme}
                  compact={true}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Credit Balance Banner */}
      {(user?.credit_balance || 0) > 0 && (
        <Card className="bg-gradient-to-r from-yellow-400/20 to-orange-400/20 border-yellow-400/30">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-yellow-400" />
                <div>
                  <span className={`text-sm font-medium ${textPrimaryClass}`}>
                    Account Credit Available
                  </span>
                  <p className="text-yellow-400 font-bold">${(user?.credit_balance || 0).toFixed(2)}</p>
                </div>
              </div>
              <Badge className="bg-yellow-400 text-black text-xs">
                Use at checkout
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Location Info */}
      <Card className={`${cardBgClass} transition-colors duration-300`}>
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3">
            <MapPin className="w-5 h-5 text-cyan-400" />
            <div className="flex-1">
              <span className={`text-sm ${textSecondaryClass}`}>
                {userLocation ? 'Searching photographers near you...' : 'Getting your location...'}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={onRefresh}
              disabled={onDemandLoading}
            >
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {onDemandLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
        </div>
      ) : onDemandPhotographers.length === 0 ? (
        <Card className={`${cardBgClass} transition-colors duration-300`}>
          <CardContent className="py-12 text-center">
            <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
              <Camera className={`w-8 h-8 ${textSecondaryClass}`} />
            </div>
            <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No Photographers Available</h3>
            <p className={`${textSecondaryClass} mb-2`}>
              No photographers are available for on-demand requests in your area right now.
            </p>
            <p className={`text-sm ${textSecondaryClass}`}>
              Try again later or check the Live Now tab for active sessions.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className={`text-sm ${textSecondaryClass} mb-2`}>
            {onDemandPhotographers.length} photographer{onDemandPhotographers.length > 1 ? 's' : ''} available on-demand
          </p>
          {onDemandPhotographers.map((pro, index) => {
            const isPro = pro.role === ROLES.APPROVED_PRO || pro.role === ROLES.PRO;
            const isPhotographer = pro.role === ROLES.PHOTOGRAPHER;
            
            return (
              <Card 
                key={pro.id} 
                className={`${cardBgClass} transition-all duration-300 hover:scale-[1.02] cursor-pointer ${
                  isPro ? 'ring-2 ring-yellow-400/50' : ''
                }`}
                onClick={() => onSelectPhotographer(pro)}
                data-testid={`on-demand-pro-${index}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Avatar */}
                    <div className="relative">
                      <div className={`w-14 h-14 rounded-full overflow-hidden ${
                        isPro ? 'ring-2 ring-yellow-400' : 'ring-2 ring-cyan-400/50'
                      }`}>
                        {pro.avatar_url ? (
                          <img src={getFullUrl(pro.avatar_url)} alt={pro.full_name} className="w-full h-full object-cover" />
                        ) : (
                          <div className={`w-full h-full flex items-center justify-center ${isLight ? 'bg-gray-100' : 'bg-zinc-700'}`}>
                            <Camera className="w-6 h-6 text-gray-400" />
                          </div>
                        )}
                      </div>
                      {isPro && (
                        <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-yellow-400 flex items-center justify-center">
                          <Star className="w-3 h-3 text-black fill-black" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={`font-semibold ${textPrimaryClass} truncate`}>{pro.full_name}</h3>
                        {isPro && (
                          <Badge className="bg-gradient-to-r from-yellow-400 to-orange-400 text-black text-xs font-bold">
                            PRO
                          </Badge>
                        )}
                        {isPhotographer && (
                          <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">
                            Photographer
                          </Badge>
                        )}
                      </div>
                      
                      {/* Distance */}
                      {pro.distance && (
                        <p className={`text-xs ${textSecondaryClass} mb-2`}>
                          <MapPin className="w-3 h-3 inline mr-1" />
                          {pro.distance.toFixed(1)} miles away
                        </p>
                      )}

                      {/* Resolution Pricing */}
                      <div className="flex flex-wrap gap-2 mb-2">
                        <Badge variant="outline" className="text-xs border-blue-400/50 text-blue-400">
                          Web ${pro.photo_price_web || 3}
                        </Badge>
                        <Badge variant="outline" className="text-xs border-cyan-400/50 text-cyan-400">
                          Std ${pro.photo_price_standard || 5}
                        </Badge>
                        <Badge variant="outline" className="text-xs border-purple-400/50 text-purple-400">
                          Hi-Res ${pro.photo_price_high || 10}
                        </Badge>
                      </div>

                      {/* On-Demand Rate */}
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${textSecondaryClass}`}>On-Demand Rate:</span>
                        <span className="text-emerald-400 font-bold">
                          ${pro.on_demand_hourly_rate || 75}/hr
                        </span>
                        {(pro.on_demand_photos_included || 0) > 0 && (
                          <Badge className="bg-green-500/20 text-green-400 text-xs">
                            {pro.on_demand_photos_included} photos incl.
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Arrow */}
                    <ChevronRight className={`w-5 h-5 ${textSecondaryClass} flex-shrink-0`} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </>
  );
};

export default OnDemandTab;
