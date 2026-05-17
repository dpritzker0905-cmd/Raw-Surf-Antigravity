/**
 * OnDemandTab - On-demand photographer requests
 * Extracted from Bookings.js for better maintainability
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSessionChatSync } from '../../hooks/useSessionChatSync';
import { Camera, MapPin, DollarSign, ChevronRight, Star, Radio, Loader2, Users, Zap, Globe, MessageCircle } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { CrewPaymentProgress } from '../dispatch/CrewPaymentProgress';
import { getFullUrl } from '../../utils/media';
import { ROLES } from '../../constants/roles';

// Curated surf region data with coordinates for GPS fallback
var SURF_REGIONS = {
  'United States': {
    'California': {
      'San Diego': { lat: 32.7157, lng: -117.1611 },
      'Los Angeles / Malibu': { lat: 34.0259, lng: -118.7798 },
      'Santa Cruz': { lat: 36.9741, lng: -122.0308 },
      'San Francisco / Pacifica': { lat: 37.6138, lng: -122.4869 },
      'Huntington Beach': { lat: 33.6595, lng: -117.9988 },
    },
    'Hawaii': {
      'North Shore, Oahu': { lat: 21.5912, lng: -158.1036 },
      'South Shore, Oahu': { lat: 21.2614, lng: -157.8231 },
      'Maui': { lat: 20.7984, lng: -156.3319 },
      'Big Island': { lat: 19.8968, lng: -155.5828 },
    },
    'Florida': {
      'Cocoa Beach': { lat: 28.3200, lng: -80.6076 },
      'New Smyrna Beach': { lat: 29.0258, lng: -80.9270 },
      'Jacksonville Beach': { lat: 30.2849, lng: -81.3935 },
      'Sebastian Inlet': { lat: 27.8592, lng: -80.4489 },
      'Palm Beach': { lat: 26.7056, lng: -80.0364 },
    },
    'New Jersey': {
      'Asbury Park': { lat: 40.2204, lng: -74.0001 },
      'Long Beach Island': { lat: 39.6571, lng: -74.1437 },
    },
    'New York': {
      'Long Beach, NY': { lat: 40.5884, lng: -73.6579 },
      'Montauk': { lat: 41.0365, lng: -71.9543 },
      'Rockaway Beach': { lat: 40.5834, lng: -73.8155 },
    },
    'Texas': {
      'South Padre Island': { lat: 26.1118, lng: -97.1681 },
      'Galveston': { lat: 29.2866, lng: -94.7977 },
    },
    'Oregon': {
      'Short Sands / Oswald West': { lat: 45.7601, lng: -123.9641 },
    },
    'North Carolina': {
      'Outer Banks': { lat: 35.9582, lng: -75.6218 },
      'Wrightsville Beach': { lat: 34.2085, lng: -77.7964 },
    },
  },
  'Australia': {
    'New South Wales': {
      'Sydney / Bondi': { lat: -33.8915, lng: 151.2767 },
      'Byron Bay': { lat: -28.6474, lng: 153.6020 },
    },
    'Queensland': {
      'Gold Coast': { lat: -28.0167, lng: 153.4000 },
      'Noosa Heads': { lat: -26.3923, lng: 153.0756 },
    },
    'Western Australia': {
      'Margaret River': { lat: -33.9510, lng: 115.0711 },
    },
  },
  'Indonesia': {
    'Bali': {
      'Uluwatu': { lat: -8.8291, lng: 115.0849 },
      'Canggu': { lat: -8.6478, lng: 115.1385 },
      'Kuta / Seminyak': { lat: -8.7180, lng: 115.1690 },
    },
    'Mentawai Islands': {
      'Mentawai': { lat: -2.0833, lng: 99.6167 },
    },
  },
  'Portugal': {
    'Algarve': {
      'Sagres': { lat: 37.0087, lng: -8.9390 },
    },
    'Central Portugal': {
      'Peniche / Supertubos': { lat: 39.3554, lng: -9.3848 },
      'Ericeira': { lat: 38.9626, lng: -9.4190 },
      'Nazar\u00e9': { lat: 39.6015, lng: -9.0705 },
    },
  },
  'Costa Rica': {
    'Guanacaste': {
      'Tamarindo': { lat: 10.2994, lng: -85.8375 },
      'Nosara': { lat: 9.9769, lng: -85.6530 },
    },
    'Puntarenas': {
      'Santa Teresa': { lat: 9.6410, lng: -85.1680 },
      'Jac\u00f3': { lat: 9.6150, lng: -84.6300 },
    },
  },
  'Mexico': {
    'Baja California': {
      'Todos Santos': { lat: 23.4467, lng: -110.2233 },
      'San Jos\u00e9 del Cabo': { lat: 23.0597, lng: -109.7006 },
    },
    'Oaxaca': {
      'Puerto Escondido': { lat: 15.8720, lng: -97.0767 },
    },
  },
  'South Africa': {
    'Western Cape': {
      "Jeffreys Bay (J-Bay)": { lat: -34.0488, lng: 24.9310 },
      'Cape Town / Muizenberg': { lat: -34.1067, lng: 18.4756 },
    },
  },
  'Brazil': {
    'Rio de Janeiro': {
      'Rio / Barra da Tijuca': { lat: -23.0125, lng: -43.3650 },
    },
    'Santa Catarina': {
      'Florian\u00f3polis': { lat: -27.5954, lng: -48.5480 },
    },
  },
};

export var OnDemandTab = ({
  user,
  onDemandPhotographers,
  onDemandLoading,
  userLocation,
  gpsUnavailable = false,
  activeDispatch,
  onRefresh,
  onManualLocationSelect,
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

  // Chat sync for active dispatch - shows unread badge + latest message on card
  const photographerId = activeDispatch?.photographer_id || activeDispatch?.photographer?.id;
  const photographerName = activeDispatch?.photographer_name || 'Photographer';
  const dispatchChatReady = !!activeDispatch && !!photographerId && ['accepted', 'en_route', 'arrived'].includes(activeDispatch?.status);
  const {
    unreadCount: dispatchUnread,
    latestMessage: dispatchLatestMsg,
  } = useSessionChatSync({
    userId: user?.id,
    otherUserId: photographerId,
    otherUserName: photographerName,
    drawerOpen: false, // always poll - there's no drawer on this page
    enabled: dispatchChatReady,
  });
  
  // Highlight flash for newly created dispatches
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const [flashingDispatch, setFlashingDispatch] = useState(false);
  
  useEffect(() => {
    if (highlightId && activeDispatch?.id === highlightId) {
      setFlashingDispatch(true);
      const timer = setTimeout(() => setFlashingDispatch(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [highlightId, activeDispatch?.id]);
  
  // Determine if user is crew member vs captain
  const isCrewMember = activeDispatch?.role === 'crew_member';

  // Manual location fallback state
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');

  const countries = Object.keys(SURF_REGIONS);
  const states = selectedCountry ? Object.keys(SURF_REGIONS[selectedCountry] || {}) : [];
  const cities = selectedCountry && selectedState ? Object.keys(SURF_REGIONS[selectedCountry]?.[selectedState] || {}) : [];

  const handleManualSearch = () => {
    const coords = SURF_REGIONS[selectedCountry]?.[selectedState]?.[selectedCity];
    if (coords && onManualLocationSelect) {
      onManualLocationSelect(coords.lat, coords.lng, `${selectedCity}, ${selectedState}`);
    }
  };

  return (
    <>
      {/* --- Crew Session Invites -------------------------------------------- */}
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
                      <img loading="lazy" decoding="async" src={getFullUrl(invite.captain.avatar_url)} alt="" className="w-full h-full object-cover" />
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
                      {invite.share_amount && ` - Your share: $${Number(invite.share_amount).toFixed(2)}`}
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

                <Button aria-label="Zap"
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

      {/* Active Dispatch Card - Redesigned with progress stepper + chat notification */}
      {activeDispatch && ['searching_for_pro', 'pending_payment', 'accepted', 'en_route', 'arrived'].includes(activeDispatch.status) && (() => {
        // -- Stepper logic --
        const STEPS = [
          { key: 'searching_for_pro', label: 'Confirming', shortLabel: 'Confirm' },
          { key: 'accepted',          label: 'Accepted',   shortLabel: 'Accept' },
          { key: 'en_route',          label: 'En Route',   shortLabel: 'En Route' },
          { key: 'arrived',           label: 'Arrived',    shortLabel: 'Arrived' },
        ];
        // pending_payment maps to searching_for_pro step
        const currentKey = activeDispatch.status === 'pending_payment' ? 'searching_for_pro' : activeDispatch.status;
        const currentIdx = STEPS.findIndex(s => s.key === currentKey);

        // -- Status display config --
        const accentColor = isCrewMember ? 'cyan' : 'amber';
        const gradientFrom = isCrewMember ? 'from-cyan-500/20' : 'from-amber-500/20';
        const gradientTo   = isCrewMember ? 'to-blue-500/20'   : 'to-orange-500/20';
        const borderActive = isCrewMember ? 'border-cyan-400/60' : 'border-amber-400/60';
        const accentText   = isCrewMember ? 'text-cyan-400' : 'text-amber-400';
        const accentBg     = isCrewMember ? 'bg-cyan-400' : 'bg-amber-400';

        // -- Title / subtitle --
        let title = '';
        let subtitle = '';
        if (isCrewMember) {
          switch (activeDispatch.status) {
            case 'searching_for_pro': title = 'Waiting for Photographer'; subtitle = `Session with ${activeDispatch.requester_name || 'your crew'}`; break;
            case 'pending_payment':   title = 'Waiting for Captain to Pay'; subtitle = 'Payment in progress...'; break;
            case 'accepted':          title = 'Photographer Confirmed!'; subtitle = `${activeDispatch.photographer_name || 'Photographer'} is joining`; break;
            case 'en_route':          title = 'Photographer On The Way!'; subtitle = `ETA: ${activeDispatch.eta_minutes || '?'} min`; break;
            case 'arrived':           title = 'Photographer Has Arrived!'; subtitle = `Look for ${activeDispatch.photographer_name || 'your photographer'}!`; break;
            default: break;
          }
        } else {
          switch (activeDispatch.status) {
            case 'searching_for_pro': title = 'Waiting for Confirmation'; subtitle = activeDispatch.photographer_name ? `Waiting for ${activeDispatch.photographer_name}...` : `Searching near ${activeDispatch.location_name || 'your location'}...`; break;
            case 'pending_payment':   title = 'Pending Payment'; subtitle = 'Complete payment to continue'; break;
            case 'accepted':          title = 'Photographer Accepted!'; subtitle = `${activeDispatch.photographer_name || 'Photographer'} is getting ready`; break;
            case 'en_route':          title = 'Photographer On The Way'; subtitle = `ETA: ${activeDispatch.eta_minutes || '?'} minutes`; break;
            case 'arrived':           title = 'Photographer Arrived!'; subtitle = 'Your photographer is here!'; break;
            default: break;
          }
        }

        return (
          <Card 
            className={`border-2 cursor-pointer transition-all mb-4 overflow-hidden ${
              flashingDispatch ? 'animate-booking-flash ' : ''
            }bg-gradient-to-br ${gradientFrom} ${gradientTo} ${borderActive} hover:shadow-lg hover:shadow-${accentColor}-400/10 active:scale-[0.98]`}
            onClick={() => onResumeDispatch?.(activeDispatch)}
            data-testid="active-dispatch-card"
          >
            <CardContent className="py-0 px-0">
              {/* -- Progress Stepper Bar -- */}
              <div className={`flex items-center justify-between px-4 py-2.5 border-b ${isLight ? 'border-gray-200/60 bg-white/40' : 'border-zinc-700/40 bg-zinc-900/30'}`}>
                {STEPS.map((step, idx) => {
                  const isComplete = idx < currentIdx;
                  const isCurrent  = idx === currentIdx;
                  const isFuture   = idx > currentIdx;
                  return (
                    <React.Fragment key={step.key}>
                      {/* Step dot + label */}
                      <div className="flex flex-col items-center gap-0.5 min-w-0">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold transition-all ${
                          isComplete ? `${accentBg} text-black` :
                          isCurrent  ? `${accentBg} text-black ring-2 ring-offset-1 ${isLight ? 'ring-offset-white' : 'ring-offset-zinc-900'} ring-${accentColor}-400/60 animate-pulse` :
                                       `${isLight ? 'bg-gray-200 text-gray-400' : 'bg-zinc-700 text-zinc-500'}`
                        }`}>
                          {isComplete ? '?' : idx + 1}
                        </div>
                        <span className={`text-[10px] font-medium leading-tight text-center ${
                          isCurrent ? accentText : isFuture ? (isLight ? 'text-gray-400' : 'text-zinc-500') : (isLight ? 'text-gray-600' : 'text-zinc-300')
                        }`}>
                          {step.shortLabel}
                        </span>
                      </div>
                      {/* Connector line */}
                      {idx < STEPS.length - 1 && (
                        <div className={`flex-1 h-0.5 mx-1 mt-[-12px] rounded-full ${
                          idx < currentIdx ? accentBg : (isLight ? 'bg-gray-200' : 'bg-zinc-700')
                        }`} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* -- Main Card Body -- */}
              <div className="px-4 py-3">
                <div className="flex items-center gap-3">
                  {/* Animated icon */}
                  <div className="relative flex-shrink-0">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isCrewMember ? 'bg-cyan-500/20' : 'bg-amber-500/20'}`}>
                      <Radio className={`w-6 h-6 animate-pulse ${accentText}`} />
                    </div>
                    {['searching_for_pro', 'en_route'].includes(activeDispatch.status) && (
                      <div className={`absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full animate-ping ${accentBg}`} />
                    )}
                  </div>

                  {/* Status text */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className={`font-bold text-sm ${textPrimaryClass}`}>{title}</h3>
                      {['searching_for_pro', 'en_route'].includes(activeDispatch.status) && (
                        <Loader2 className={`w-3.5 h-3.5 animate-spin ${accentText}`} />
                      )}
                    </div>
                    <p className={`text-xs ${textSecondaryClass} truncate`}>{subtitle}</p>
                  </div>
                </div>

                {/* -- Crew avatars (for crew members) -- */}
                {isCrewMember && activeDispatch.crew && activeDispatch.crew.length > 0 && (
                  <div className="flex items-center gap-1 mt-2 ml-15">
                    <span className={`text-xs ${textSecondaryClass}`}>With:</span>
                    {activeDispatch.crew.slice(0, 3).map((member, idx) => (
                      <div key={idx} className="w-6 h-6 rounded-full bg-zinc-700 overflow-hidden border border-cyan-400/30">
                        {member.avatar_url ? (
                          <img loading="lazy" decoding="async" src={getFullUrl(member.avatar_url)} alt="" className="w-full h-full object-cover" />
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

              {/* -- Crew Payment Progress -- */}
              {activeDispatch?.is_shared && activeDispatch?.crew && activeDispatch.crew.length > 0 && (
                <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
                  <div className={`pt-3 border-t ${isLight ? 'border-gray-200/60' : 'border-zinc-700/50'}`}>
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
                </div>
              )}

              {/* -- Inline Chat Notification -- */}
              {dispatchChatReady && (dispatchUnread > 0 || dispatchLatestMsg) && (
                <div className={`flex items-center gap-3 mx-4 mb-2 px-3 py-2 rounded-xl border transition-all ${
                  dispatchUnread > 0
                    ? (isLight ? 'bg-cyan-50 border-cyan-300 ring-1 ring-cyan-200' : 'bg-cyan-500/10 border-cyan-400/40 ring-1 ring-cyan-400/20')
                    : (isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/50 border-zinc-700/50')
                }`}>
                  <div className="relative flex-shrink-0">
                    <MessageCircle className={`w-4 h-4 ${
                      dispatchUnread > 0 ? 'text-cyan-500' : (isLight ? 'text-gray-400' : 'text-zinc-500')
                    }`} />
                    {dispatchUnread > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-red-500 text-[8px] font-bold text-white flex items-center justify-center">
                        {dispatchUnread > 9 ? '9+' : dispatchUnread}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs truncate ${
                      dispatchUnread > 0 ? (isLight ? 'text-gray-900 font-semibold' : 'text-white font-semibold') : textSecondaryClass
                    }`}>
                      {dispatchUnread > 0
                        ? `${photographerName}: ${dispatchLatestMsg?.content || 'New message'}`
                        : (dispatchLatestMsg?.content || 'Chat available')}
                    </p>
                  </div>
                  <span className={`text-[10px] flex-shrink-0 ${dispatchUnread > 0 ? 'text-cyan-500' : textSecondaryClass}`}>Open ?</span>
                </div>
              )}

              {/* -- Tap-to-View CTA Strip -- */}
              <div className={`flex items-center justify-between px-4 py-2.5 border-t ${
                isLight ? 'border-gray-200/60 bg-white/50' : 'border-zinc-700/40 bg-zinc-800/50'
              }`}>
                <span className={`text-xs font-medium ${accentText} flex items-center gap-1.5`}>
                  <Zap className="w-3 h-3" />
                  Tap to view session details
                </span>
                <div className={`flex items-center gap-0.5 ${accentText}`}>
                  <ChevronRight className="w-4 h-4 animate-[pulse_1.5s_ease-in-out_infinite]" />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

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
                {userLocation?.label
                  ? `Showing photographers near ${userLocation.label}`
                  : userLocation
                    ? 'Searching photographers near you...'
                    : gpsUnavailable
                      ? 'Select your location below'
                      : 'Getting your location...'}
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={onRefresh} disabled={onDemandLoading}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* GPS Fallback: Manual Location Selector */}
      {gpsUnavailable && !userLocation && (
        <Card className={`${cardBgClass} border-2 border-amber-400/40 transition-colors duration-300`}>
          <CardContent className="py-4 px-4">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="w-5 h-5 text-amber-400" />
              <h3 className={`font-semibold text-sm ${textPrimaryClass}`}>Select Your Location</h3>
            </div>
            <p className={`text-xs ${textSecondaryClass} mb-3`}>
              GPS is unavailable. Choose your surf region to find nearby photographers.
            </p>

            {/* Country */}
            <select
              value={selectedCountry}
              onChange={(e) => { setSelectedCountry(e.target.value); setSelectedState(''); setSelectedCity(''); }}
              className={`w-full p-2.5 rounded-lg mb-2 text-sm border ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-zinc-800 border-zinc-600 text-white'}`}
            >
              <option value="">Select Country</option>
              {countries.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* State */}
            {selectedCountry && (
              <select
                value={selectedState}
                onChange={(e) => { setSelectedState(e.target.value); setSelectedCity(''); }}
                className={`w-full p-2.5 rounded-lg mb-2 text-sm border ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-zinc-800 border-zinc-600 text-white'}`}
              >
                <option value="">Select State / Province</option>
                {states.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}

            {/* City */}
            {selectedState && (
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                className={`w-full p-2.5 rounded-lg mb-2 text-sm border ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-zinc-800 border-zinc-600 text-white'}`}
              >
                <option value="">Select City / Area</option>
                {cities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}

            {/* Search Button */}
            {selectedCity && (
              <Button aria-label="Loader2"
                onClick={handleManualSearch}
                className="w-full mt-1 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-semibold"
                disabled={onDemandLoading}
              >
                {onDemandLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MapPin className="w-4 h-4 mr-2" />}
                Find Photographers
              </Button>
            )}
          </CardContent>
        </Card>
      )}

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
                          <img loading="lazy" decoding="async" src={getFullUrl(pro.avatar_url)} alt={pro.full_name} className="w-full h-full object-cover" />
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
