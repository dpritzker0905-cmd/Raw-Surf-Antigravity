/**
 * ScheduledTab - Booking Command Center for managing confirmed/pending bookings
 * 
 * This tab is strictly for MANAGING existing bookings (Modify, Cancel, Split, Invite Crew).
 * Booking CREATION happens in "The Lineup" tab via the Photographer Directory.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, Wallet, Camera, MapPin, CreditCard, Users } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { BookingCard } from '../BookingCard';
import { BookingSelfieModal } from '../BookingSelfieModal';
import { getFullUrl } from '../../utils/media';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '../ui/alert-dialog';

export const ScheduledTab = ({
  user,
  scheduledBookings,
  pendingInvites,
  crewInvites = [],
  _onOpenDirectory,
  onInvite,
  onRespondToInvite,
  onPayCrewShare,
  onRefresh,
  onOpenCrewHub,
  onOpenModify,
  onOpenCrewView,  // New prop for crew lineup
  theme
}) => {
  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-gray-400';

  const consentOwner = useRef(null);
  const consentOpener = useRef(null);
  const consentFallback = useRef(null);
  const restoredConsentFocus = useRef(null);
  const [consent, setConsent] = useState(null);
  const userId = user?.id;
  const session = user?.access_token;
  useLayoutEffect(() => {
    const owner = { request: 0, submitting: false };
    consentOwner.current = owner;
    restoredConsentFocus.current = null;
    setConsent(null);
    return () => { if (consentOwner.current === owner) consentOwner.current = null; };
  }, [userId, session]);

  useEffect(() => {
    const releaseRestoredFocus = event => {
      if (restoredConsentFocus.current && event.target !== restoredConsentFocus.current) {
        restoredConsentFocus.current = null;
      }
    };
    document.addEventListener('focusin', releaseRestoredFocus);
    return () => document.removeEventListener('focusin', releaseRestoredFocus);
  }, []);

  const closeConsent = () => {
    if (consentOwner.current?.submitting) return;
    if (consentOwner.current) consentOwner.current.request++;
    setConsent(null);
  };

  useLayoutEffect(() => {
    if (consent && !consent.retainOutcome && !pendingInvites.some(invite => invite.id === consent.id)) closeConsent();
    const restored = restoredConsentFocus.current;
    if (!consent && restored && !restored.isConnected) {
      restoredConsentFocus.current = null;
      if (document.activeElement === document.body) consentFallback.current?.focus();
    }
  }, [pendingInvites, consent]);

  const loadConsent = async (id, message = '', opener = null) => {
    const owner = consentOwner.current;
    if (!owner || !userId || owner.submitting) return;
    if (opener) consentOpener.current = opener;
    const request = ++owner.request;
    setConsent({ id, loading: true, message });
    const result = await onRespondToInvite(id, true, { quoteOnly: true });
    if (consentOwner.current !== owner || request !== owner.request) return;
    const quote = result?.quote;
    const valid = result?.status === 'quoted' && quote?.invite_id === id && quote?.unit === 'credits'
      && typeof quote.booking_id === 'string' && quote.booking_id.length > 0
      && typeof quote.amount_credits === 'string' && /^(0|[1-9]\d*)\.\d{2}$/.test(quote.amount_credits)
      && /^[a-f0-9]{64}$/.test(quote.quote || '');
    setConsent({ id, quote: valid ? quote : null,
      message: valid ? message : result?.message || 'Could not confirm invite price.' });
  };

  const confirmConsent = async () => {
    const owner = consentOwner.current;
    if (!owner || owner.submitting || !consent?.quote) return;
    const { id, quote } = consent;
    const request = owner.request;
    owner.submitting = true;
    setConsent({ ...consent, submitting: true });
    const result = await onRespondToInvite(id, true, { consentQuote: quote.quote });
    owner.submitting = false;
    if (consentOwner.current !== owner || owner.request !== request) return;
    if (result?.status === 'accepted') closeConsent();
    else if (result?.status === 'changed') await loadConsent(id, result.message);
    else setConsent({ id, retainOutcome: true,
      message: result?.message || 'Could not confirm acceptance. Check your bookings.' });
  };
  
  // Selfie modal state
  const [selfieModalOpen, setSelfieModalOpen] = useState(false);
  const [selectedBookingForSelfie, setSelectedBookingForSelfie] = useState(null);
  
  // Check for bookings that need selfies (user hasn't added one yet)
  const bookingsNeedingSelfie = scheduledBookings?.filter(booking => {
    // Find user's participation in this booking
    const myParticipation = booking.participants?.find(p => p.participant_id === user?.id);
    return myParticipation && !myParticipation.selfie_url && booking.status !== 'cancelled';
  }) || [];
  
  const handleOpenSelfieModal = (booking) => {
    setSelectedBookingForSelfie(booking);
    setSelfieModalOpen(true);
  };
  
  const handleSelfieSuccess = () => {
    if (onRefresh) onRefresh();
  };
  
  const [searchParams] = useSearchParams();
  const highlightedSessionId = searchParams.get('session');
  const highlightedBookingId = searchParams.get('highlight');
  const sessionRefs = useRef({});
  const [flashingId, setFlashingId] = useState(null);
  
  // Auto-scroll to highlighted session
  useEffect(() => {
    const targetId = highlightedSessionId || highlightedBookingId;
    if (targetId && sessionRefs.current[targetId]) {
      setTimeout(() => {
        sessionRefs.current[targetId]?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }, 300);
    }
  }, [highlightedSessionId, highlightedBookingId, scheduledBookings]);
  
  // Flash animation for newly created bookings
  useEffect(() => {
    if (highlightedBookingId) {
      setFlashingId(highlightedBookingId);
      // Auto-clear flash after 4 seconds
      const timer = setTimeout(() => setFlashingId(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [highlightedBookingId]);

  return (
    <>
      <h2 className="sr-only" tabIndex={-1} ref={consentFallback}>Scheduled bookings</h2>
      {/* Selfie Prompt - Show if user has bookings without selfies */}
      {bookingsNeedingSelfie.length > 0 && (
        <Card className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-cyan-500/30 mb-4">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-full bg-cyan-500/20">
                <Camera className="w-5 h-5 text-cyan-400" />
              </div>
              <div className="flex-1">
                <h4 className={`font-medium ${textPrimaryClass}`}>
                  Add a Selfie for Better Photos!
                </h4>
                <p className={`text-sm ${textSecondaryClass} mt-1`}>
                  Help photographers identify you in {bookingsNeedingSelfie.length} upcoming session{bookingsNeedingSelfie.length > 1 ? 's' : ''}.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {bookingsNeedingSelfie.slice(0, 2).map((booking) => (
                    <Button aria-label="Camera"
                      key={booking.id}
                      size="sm"
                      onClick={() => handleOpenSelfieModal(booking)}
                      className="bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/30"
                    >
                      <Camera className="w-3 h-3 mr-1" />
                      {booking.photographer_name?.split(' ')[0] || 'Session'}
                    </Button>
                  ))}
                  {bookingsNeedingSelfie.length > 2 && (
                    <span className={`text-xs ${textSecondaryClass} self-center`}>
                      +{bookingsNeedingSelfie.length - 2} more
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Account Credit Display - Only show if user has credits */}
      {user?.credit_balance > 0 && (
        <Card className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-green-500/30 mb-4">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-green-400" />
                <span className={`text-sm ${textSecondaryClass}`}>Account Credit</span>
              </div>
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                ${user.credit_balance.toFixed(2)}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Invites Section */}
      {pendingInvites.length > 0 && (
        <div className="mb-4">
          <h3 className={`text-sm font-medium ${textSecondaryClass} mb-2`}>Pending Invites</h3>
          {pendingInvites.map((invite) => (
            <Card key={invite.id} className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border-yellow-500/30 mb-2">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className={`font-medium ${textPrimaryClass}`}>
                      {invite.inviter_name} invited you
                    </h4>
                    <p className={`text-sm ${textSecondaryClass}`}>{invite.location}</p>
                    <p className={`text-xs ${textSecondaryClass} mt-1`}>
                      {new Date(invite.session_date).toLocaleString()}
                    </p>
                  </div>
                </div>
                {invite.message && (
                  <p className={`text-sm ${textSecondaryClass} italic mb-3`}>"{invite.message}"</p>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={event => loadConsent(invite.id, '', event.currentTarget)}
                    className="flex-1 bg-green-500 hover:bg-green-600 text-white"
                    size="sm"
                  >
                    Accept
                  </Button>
                  <Button
                    onClick={() => onRespondToInvite(invite.id, false)}
                    variant="outline"
                    className="flex-1 border-red-500/50 text-red-400 hover:bg-red-500/10"
                    size="sm"
                  >
                    Decline
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* On-Demand Crew Invites Section */}
      {crewInvites.length > 0 && (
        <div className="mb-4">
          <h3 className={`text-sm font-medium ${textSecondaryClass} mb-2 flex items-center gap-2`}>
            <Users className="w-4 h-4 text-cyan-400" />
            On-Demand Session Invites
          </h3>
          {crewInvites.map((invite) => (
            <Card key={invite.id} className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-cyan-500/30 mb-2">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {invite.captain?.avatar_url ? (
                      <img loading="lazy" decoding="async" src={getFullUrl(invite.captain.avatar_url)} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
                        <span className="text-cyan-400 font-bold">{invite.captain?.name?.[0] || '?'}</span>
                      </div>
                    )}
                    <div>
                      <h4 className={`font-medium ${textPrimaryClass}`}>
                        {invite.captain?.name || 'A friend'} invited you to surf!
                      </h4>
                      <p className={`text-sm ${textSecondaryClass}`}>
                        On-Demand Session - {invite.estimated_duration_hours}h
                      </p>
                    </div>
                  </div>
                  <Badge className="bg-cyan-500/20 text-cyan-400">
                    ${invite.your_share?.toFixed(2)}
                  </Badge>
                </div>
                
                <div className="flex items-center gap-4 mb-3 text-sm">
                  <div className="flex items-center gap-1">
                    <MapPin className="w-4 h-4 text-cyan-400" />
                    <span className={textSecondaryClass}>{invite.location_name || 'TBD'}</span>
                  </div>
                  {invite.photographer && (
                    <div className="flex items-center gap-1">
                      <Camera className="w-4 h-4 text-amber-400" />
                      <span className={textSecondaryClass}>{invite.photographer.name}</span>
                    </div>
                  )}
                </div>
                
                <Button aria-label="Credit Card"
                  onClick={() => onPayCrewShare(invite)}
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white"
                  size="sm"
                >
                  <CreditCard className="w-4 h-4 mr-2" />
                  View Details & Pay
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Scheduled Bookings List */}
      {scheduledBookings.length === 0 && pendingInvites.length === 0 && crewInvites.length === 0 ? (
        <Card className={`${cardBgClass} transition-colors duration-300`}>
          <CardContent className="py-12 text-center">
            <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
              <CalendarClock className={`w-8 h-8 ${textSecondaryClass}`} />
            </div>
            <h3 className={`text-lg font-medium ${textPrimaryClass} mb-2`}>No Scheduled Bookings</h3>
            <p className={`${textSecondaryClass}`}>
              Your confirmed and pending bookings will appear here.
              Head to <span className="text-cyan-400 font-medium">The Lineup</span> tab to start or join a session.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h3 className={`text-sm font-medium ${textSecondaryClass}`}>
            Your Scheduled Sessions ({scheduledBookings.length})
          </h3>
          {scheduledBookings.map((booking) => (
            <div 
              key={booking.id}
              ref={(el) => sessionRefs.current[booking.id] = el}
              className={`transition-all duration-500 rounded-xl ${
                flashingId === booking.id 
                  ? 'animate-booking-flash ring-2 ring-cyan-400 ring-offset-2 ring-offset-zinc-900' 
                  : highlightedSessionId === booking.id 
                    ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-zinc-900' 
                    : ''
              }`}
            >
              <BookingCard
                booking={booking}
                user={user}
                theme={theme}
                onInvite={onInvite}
                onRefresh={onRefresh}
                onOpenCrewHub={onOpenCrewHub}
                onOpenModify={onOpenModify}
                onOpenCrewView={onOpenCrewView}
              />
            </div>
          ))}
        </div>
      )}
      
      <AlertDialog open={Boolean(consent)} onOpenChange={open => { if (!open) closeConsent(); }}>
        <AlertDialogContent onEscapeKeyDown={event => {
          if (consentOwner.current?.submitting) event.preventDefault();
        }} onCloseAutoFocus={event => {
          event.preventDefault();
          const target = consentOpener.current?.isConnected ? consentOpener.current : consentFallback.current;
          if (target?.isConnected) {
            restoredConsentFocus.current = target === consentOpener.current ? target : null;
            target.focus();
          }
        }} className={theme === 'beach' ? 'bg-amber-50 text-amber-950 border-amber-200'
          : isLight ? 'bg-white text-gray-900' : 'bg-zinc-900 text-white'}>
          <AlertDialogHeader>
            <AlertDialogTitle>Accept session invite</AlertDialogTitle>
            <AlertDialogDescription className={theme === 'beach' ? 'text-amber-900'
              : isLight ? 'text-gray-600' : 'text-gray-300'}>
              {consent?.loading ? 'Loading the current price…' : consent?.quote
                ? `Accepting will charge ${consent.quote.amount_credits} credits from your account.`
                : 'Acceptance is unavailable until the current price is confirmed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {consent?.message && <p role="status">{consent.message}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={consent?.submitting}>Cancel</AlertDialogCancel>
            {consent?.quote && <Button disabled={consent.submitting} onClick={confirmConsent}>
              {consent.submitting ? 'Submitting…' : `Pay ${consent.quote.amount_credits} credits and accept`}
            </Button>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Selfie Modal */}
      <BookingSelfieModal
        isOpen={selfieModalOpen}
        onClose={() => {
          setSelfieModalOpen(false);
          setSelectedBookingForSelfie(null);
        }}
        booking={selectedBookingForSelfie}
        userId={user?.id}
        theme={theme}
        onSuccess={handleSelfieSuccess}
      />
    </>
  );
};

export default ScheduledTab;
