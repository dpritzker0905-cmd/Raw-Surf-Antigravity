/**
 * SpotReportContent.js
 * Extracted from UnifiedSpotDrawer.js -- Report Mode JSX content
 * Includes: savings banner, spot of day, conditions, active photographers,
 * open bookings, tab navigation (reports/pro/community), and view hub CTA
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, Radio, Users, Waves, DollarSign,
  Sparkles, ExternalLink, ChevronRight, MessageCircle
} from 'lucide-react';
import { ScanFace } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { SpotConditions } from '../SpotConditions';
import { SpotVerificationNudge } from '../SpotVerificationNudge';
import { SpotOfTheDayBadge, GeofenceUpgradeCTA } from './SpotDrawerHelpers';
import { getFullUrl } from '../../utils/media';

const SpotReportContent = ({
  spot,
  user,
  isPhotographer,
  isWithinGeofence,
  activeShooters,
  spotOfTheDay,
  userLocation,
  distanceMiles,
  visibilityRadius,
  // Tab state
  drawerTab,
  setDrawerTab,
  // Data
  conditionReports,
  proPhotos,
  communityPhotos,
  // Handlers
  handleJumpInClick,
  setScanModalOpen,
  setLightboxUrl,
  onClose,
  // Theme
  textPrimary,
  textSecondary,
  cardBg,
  headerBorder,
  isLight,
  isBeach,
  timeOffsetHours = 0,
}) => {
  const navigate = useNavigate();

  return (
    <>
      {/* Live Session Savings Banner */}
      {activeShooters.length > 0 && (
        <div className="px-4 py-3 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-b border-green-500/20">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-green-400" />
            <span className="text-green-400 font-medium text-sm">Live Session Savings!</span>
          </div>
          <p className="text-gray-400 text-xs mt-1">
            Join a session now and get photos at discounted rates
          </p>
        </div>
      )}

      {/* Spot of the Day Badge - Social Discovery Engine */}
      {spotOfTheDay && (
        <SpotOfTheDayBadge 
          spotOfTheDay={spotOfTheDay}
          onClick={() => {
            if (activeShooters.length > 0) {
              handleJumpInClick(activeShooters[0]);
            }
          }}
        />
      )}

      {/* Surf Conditions - Always visible */}
      <div className="px-4">
        <SpotConditions spotId={spot?.id} spotName={spot?.name} />
        
        {/* Targeted Spot AI Scan Feature */}
        {user && (
          <div className="mt-4 p-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-white font-medium flex items-center gap-2">
                  <ScanFace className="w-4 h-4 text-cyan-400" />
                  Scan {spot?.name} for My Photos
                </h4>
                <p className="text-gray-400 text-xs mt-1">
                  Did you shred here recently? We'll sweep this exact spot searching for your wetsuit, board, and face.
                </p>
              </div>
              <Button
                onClick={() => setScanModalOpen(true)}
                className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold shrink-0"
                size="sm"
                data-testid="spot-scan-btn"
              >
                Scan Spot
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Photographer Verification Nudge */}
      {isPhotographer && (
        <div className="px-4 py-3">
          <SpotVerificationNudge 
            spot={spot}
            userLocation={userLocation}
          />
        </div>
      )}

      {/* Privacy Shield: Show upgrade CTA if outside geofence */}
      {!isWithinGeofence && (
        <GeofenceUpgradeCTA 
          distanceMiles={distanceMiles}
          visibilityRadius={visibilityRadius}
          activePhotographersCount={spot?.active_photographers_count || 0}
        />
      )}

      {/* Active Photographers - Only show if within geofence */}
      {isWithinGeofence && (
        <div className="px-4 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Radio className="w-4 h-4 text-green-400" />
            <h3 className="text-white font-medium text-sm">
              Live Now ({activeShooters.length})
            </h3>
          </div>

          {activeShooters.length > 0 ? (
            <div className="space-y-3">
              {activeShooters.map((shooter) => (
                <div 
                  key={shooter.id} 
                  className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-xl cursor-pointer hover:bg-zinc-800 transition-colors"
                  onClick={() => handleJumpInClick(shooter)}
                  data-testid={`photographer-card-${shooter.id}`}
                >
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full p-[2px] bg-gradient-to-r from-green-400 to-cyan-400">
                      <div className="w-full h-full rounded-full bg-zinc-800 overflow-hidden">
                        {shooter.avatar_url ? (
                          <img loading="lazy" decoding="async" src={getFullUrl(shooter.avatar_url)} className="w-full h-full object-cover" alt="" />
                        ) : (
                          <span className="flex items-center justify-center h-full text-cyan-400">
                            {shooter.full_name?.[0]}
                          </span>
                        )}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-500 rounded-full border-2 border-zinc-900" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-medium text-sm">{shooter.full_name}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-gray-400 text-xs">
                        ${shooter.session_price || 25} buy-in
                      </p>
                      {shooter.live_photo_price && shooter.general_photo_price && 
                       shooter.live_photo_price < shooter.general_photo_price && (
                        <Badge className="bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0">
                          Save ${shooter.general_photo_price - shooter.live_photo_price}/photo
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button aria-label="Users"
                    size="sm"
                    variant="outline"
                    className="border-yellow-500/50 text-yellow-400 hover:bg-yellow-500/10 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleJumpInClick(shooter);
                    }}
                    data-testid={`jump-in-btn-${shooter.id}`}
                  >
                    <Users className="w-3 h-3 mr-1" />
                    Jump In
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500">
              <Camera className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No photographers shooting here yet</p>
              {isPhotographer && (
                <p className="text-xs text-cyan-400 mt-1">Be the first to go live!</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Difficulty Badge */}
      {spot.difficulty && (
        <div className="px-4 py-3">
          <span className="inline-block px-3 py-1 bg-zinc-800 rounded-lg text-xs text-gray-300">
            {spot.difficulty}
          </span>
        </div>
      )}

      {/* Open Sessions - Bookings with split_mode='open_nearby' */}
      {isWithinGeofence && spot.open_bookings?.length > 0 && (
        <div className="px-4 py-4 border-t border-zinc-800">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-cyan-400" />
            <h3 className="text-white font-medium text-sm">
              Join a Crew ({spot.open_bookings.length})
            </h3>
            <Badge className="bg-cyan-500/20 text-cyan-400 text-[10px] px-1.5 py-0">
              Open to Nearby
            </Badge>
          </div>
          
          <div className="space-y-3">
            {spot.open_bookings.map((booking) => (
              <div 
                key={booking.id}
                className="p-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-xl border border-cyan-500/30 cursor-pointer hover:border-cyan-500/50 transition-colors"
                onClick={() => {
                  navigate(`/bookings?join=${booking.invite_code}`);
                  onClose?.();
                }}
                data-testid={`open-booking-${booking.id}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {booking.photographer_avatar ? (
                      <img loading="lazy" decoding="async" 
                        src={booking.photographer_avatar}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover border border-cyan-500/30"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white text-sm font-bold">
                        {booking.photographer_name?.[0] || '?'}
                      </div>
                    )}
                    <div>
                      <p className="text-white text-sm font-medium">
                        {booking.photographer_name || 'Session'}
                      </p>
                      <p className="text-gray-400 text-xs">
                        {new Date(booking.session_date).toLocaleDateString(undefined, { 
                          weekday: 'short', 
                          month: 'short', 
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
                  <Badge className="bg-green-500/20 text-green-400 text-xs px-2 py-0.5">
                    {booking.spots_left} spot{booking.spots_left > 1 ? 's' : ''} left
                  </Badge>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      ${booking.price_per_person?.toFixed(2)}/person
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {booking.max_participants - booking.spots_left}/{booking.max_participants}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    className="bg-cyan-500 hover:bg-cyan-600 text-black text-xs h-7"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/bookings?join=${booking.invite_code}`);
                      onClose?.();
                    }}
                  >
                    Join Crew
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* -- Tab Navigation (mirrors SpotHub) ------------ */}
      <div className={`flex border-t border-b ${headerBorder} mt-2`}>
        {[
          { id: 'reports', label: 'Reports', icon: MessageCircle, count: conditionReports.length },
          { id: 'pro', label: 'Pro', icon: Camera, count: proPhotos.length },
          { id: 'community', label: 'Community', icon: Users, count: communityPhotos.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setDrawerTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors relative ${
              drawerTab === tab.id ? textPrimary : textSecondary
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            {tab.count > 0 && (
              <span className={`text-[10px] ${textSecondary}`}>({tab.count})</span>
            )}
            {drawerTab === tab.id && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-cyan-400 rounded-full" />
            )}
          </button>
        ))}
      </div>
      <div className="px-4 py-3">
        {drawerTab === 'reports' && (
          <div className="space-y-2">
            {conditionReports.length > 0 ? conditionReports.slice(0, 5).map((report) => (
              <div key={report.id} className={`p-2.5 rounded-lg border ${cardBg}`}>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-cyan-500 shrink-0">
                    {report.photographer_avatar ? (
                      <img loading="lazy" decoding="async" src={getFullUrl(report.photographer_avatar)} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <div className="w-full h-full bg-cyan-500 flex items-center justify-center text-xs font-bold text-white">{report.photographer_name?.[0]}</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${textPrimary}`}>{report.photographer_name}</p>
                    <p className={`text-[10px] ${textSecondary}`}>{report.time_ago}</p>
                  </div>
                  {report.conditions_label && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 font-medium shrink-0">{report.conditions_label}</span>
                  )}
                </div>
                {/* Captured timestamp */}
                <p className={`text-xs mt-1.5 ${textSecondary}`}>
                  Captured {new Date(report.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {new Date(report.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })} - {report.spot_name || spot?.name || 'Unknown Spot'}
                </p>
                <div className="flex items-center gap-3 mt-1.5">
                  {report.wave_height_ft && (<span className="text-xs flex items-center gap-1"><Waves className="w-3 h-3 text-cyan-400" /><span className={textPrimary}>{report.wave_height_ft}ft</span></span>)}
                  {report.wind_conditions && (<span className={`text-xs ${textSecondary}`}>{report.wind_conditions}</span>)}
                  {report.crowd_level && (<span className="text-xs flex items-center gap-1"><Users className="w-3 h-3 text-purple-400" /><span className={textPrimary}>{report.crowd_level}</span></span>)}
                </div>
                {(() => {
                  const urls = [report.thumbnail_url, report.media_url].filter(u => u && u.trim() && !u.startsWith('/api/uploads/'));
                  if (!urls[0]) return null;
                  return (<img loading="lazy" decoding="async" src={getFullUrl(urls[0])} alt="" className="mt-2 w-full h-48 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity" onClick={() => setLightboxUrl(getFullUrl(urls[0]))} onError={(e) => { if (urls[1] && e.target.src !== getFullUrl(urls[1])) { e.target.src = getFullUrl(urls[1]); } else { e.target.style.display = 'none'; } }} />);
                })()}
              </div>
            )) : (
              <div className={`text-center py-8 ${textSecondary}`}>
                <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No condition reports yet</p>
                <p className="text-xs">Photographers will post when they start shooting</p>
              </div>
            )}
          </div>
        )}
        {drawerTab === 'pro' && (
          <div>
            {proPhotos.length > 0 ? (<>
              <p className={`text-[10px] ${textSecondary} mb-2`}>Photos/videos tagged to this spot by photographers</p>
              <div className="grid grid-cols-3 gap-1.5">
                {proPhotos.slice(0, 9).map((post) => (
                  <div key={post.id} className="aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity" onClick={() => { navigate(`/post/${post.id}`); onClose?.(); }}>
                    <img loading="lazy" decoding="async" src={getFullUrl(post.thumbnail_url || post.media_url)} alt="" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
                  </div>
                ))}
              </div>
            </>) : (
              <div className={`text-center py-8 ${textSecondary}`}>
                <Camera className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No pro photos tagged here</p>
                <p className="text-xs">Photographers can tag their photos to this spot</p>
              </div>
            )}
          </div>
        )}
        {drawerTab === 'community' && (
          <div>
            {communityPhotos.length > 0 ? (<>
              <p className={`text-[10px] ${textSecondary} mb-2`}>Photos/videos tagged to this spot by surfers</p>
              <div className="grid grid-cols-3 gap-1.5">
                {communityPhotos.slice(0, 9).map((post) => (
                  <div key={post.id} className="aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-80 transition-opacity" onClick={() => { navigate(`/post/${post.id}`); onClose?.(); }}>
                    <img loading="lazy" decoding="async" src={getFullUrl(post.thumbnail_url || post.media_url)} alt="" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
                  </div>
                ))}
              </div>
            </>) : (
              <div className={`text-center py-8 ${textSecondary}`}>
                <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No community posts tagged here</p>
                <p className="text-xs">Tag your photos to this spot to appear here</p>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="px-4 py-3">
        <button aria-label="div" onClick={() => { navigate(`/spot-hub/${spot.id}?timeOffset=${timeOffsetHours}`); onClose?.(); }} className={`w-full group overflow-hidden rounded-xl border ${isLight ? 'border-cyan-400/40 bg-gradient-to-r from-cyan-50 via-blue-50 to-purple-50 hover:from-cyan-100 hover:via-blue-100 hover:to-purple-100' : 'border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10 hover:from-cyan-500/20 hover:via-blue-500/20 hover:to-purple-500/20'} transition-all duration-300`} data-testid="view-spot-hub-btn">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 p-0.5 shrink-0">
                <div className={`w-full h-full rounded-full ${isLight ? 'bg-white' : isBeach ? 'bg-amber-50' : 'bg-zinc-900'} flex items-center justify-center`}>
                  <ExternalLink className="w-4 h-4 text-cyan-400" />
                </div>
              </div>
              <div>
                <p className={`${textPrimary} font-semibold text-sm`}>View Full Spot Hub</p>
                <p className={`${textSecondary} text-xs`}>Forecast, reports, galleries & more</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-cyan-400 group-hover:translate-x-1 transition-transform" />
          </div>
        </button>
      </div>
      {/* Bottom safe area padding for mobile */}
      <div className="h-20" aria-hidden="true" />
    </>
  );
};

export default React.memo(SpotReportContent);
