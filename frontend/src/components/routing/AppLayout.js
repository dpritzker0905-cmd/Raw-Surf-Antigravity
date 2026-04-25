/**
 * AppLayout.js — Responsive shell layout for authenticated users.
 *
 * Desktop: Sidebar on the left (200px), main content fills the rest.
 * Mobile: TopNav at top + BottomNav at bottom, main content in between.
 *
 * Handles:
 *   - Theme-driven background colors
 *   - Impersonation banner top padding
 *   - Push notification initialization
 *   - Back button navigation guard
 */
import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Sidebar } from '../Sidebar';
import { TopNav } from '../TopNav';
import { BottomNav } from '../BottomNav';
import ImpersonationBanner from '../ImpersonationBanner';
import PersonaMaskBanner from '../PersonaMaskBanner';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useWebRTCCall, CALL_STATE } from '../../hooks/useWebRTCCall';
import IncomingCallModal from '../messages/IncomingCallModal';
import OutgoingCallModal from '../messages/OutgoingCallModal';
import InCallView from '../messages/InCallView';
import PermissionDeniedModal from '../messages/PermissionDeniedModal';

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Renders ImpersonationBanner only when admin is viewing as another user. */
const ImpersonationBannerWrapper = () => {
  const { impersonation, loading } = useAuth();
  if (loading || !impersonation) return null;
  return <ImpersonationBanner />;
};

/** Renders PersonaMaskBanner only for authenticated admins on non-public pages. */
const PersonaMaskBannerWrapper = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const publicRoutes = ['/', '/auth', '/auth/'];
  const isOnPublicRoute = publicRoutes.includes(location.pathname);
  if (loading || !user?.id || !user?.is_admin || isOnPublicRoute) return null;
  return <PersonaMaskBanner />;
};

/** Auto-subscribes to push notifications when user logs in and permission is granted. */
const PushNotificationInit = () => {
  const { user } = useAuth();
  const { isSupported, subscribe } = usePushNotifications(user?.id);
  useEffect(() => {
    if (user?.id && isSupported && Notification.permission === 'granted') {
      subscribe();
    }
  }, [user?.id, isSupported, subscribe]);
  return null;
};

/**
 * Prevents browser back-button navigation to auth/landing pages
 * when the user is authenticated. Redirects to /feed instead.
 */
const BackButtonHandler = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    const handlePopState = () => {
      if (user && (
        window.location.pathname === '/auth' ||
        window.location.pathname === '/login' ||
        window.location.pathname === '/'
      )) {
        setTimeout(() => {
          window.history.pushState(null, '', '/feed');
          navigate('/feed', { replace: true });
        }, 0);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [user, navigate]);
  return null;
};

/** Global WebRTC Call Manager — renders incoming call + in-call overlays. */
const CallManager = () => {
  const { user } = useAuth();
  const call = useWebRTCCall(user?.id, {
    name: user?.full_name || user?.username,
    avatar: user?.avatar_url,
  });

  if (!user?.id) return null;

  return (
    <>
      {/* Incoming call overlay */}
      {call.callState === CALL_STATE.INCOMING && (
        <IncomingCallModal
          callerName={call.remoteUserInfo?.name}
          callerAvatar={call.remoteUserInfo?.avatar}
          callType={call.callType}
          onAccept={call.answerCall}
          onReject={call.declineCall}
        />
      )}

      {/* Outgoing call (ringing) overlay */}
      {call.callState === CALL_STATE.OUTGOING && (
        <OutgoingCallModal
          targetName={call.remoteUserInfo?.name}
          targetAvatar={call.remoteUserInfo?.avatar}
          callType={call.callType}
          onCancel={call.endCall}
        />
      )}

      {/* Active call overlay */}
      {(call.callState === CALL_STATE.IN_CALL || call.callState === CALL_STATE.CONNECTING) && (
        <InCallView
          callType={call.callType}
          localStream={call.localStream}
          remoteStream={call.remoteStream}
          isMuted={call.isMuted}
          isCameraOff={call.isCameraOff}
          callDuration={call.callDuration}
          remoteUserInfo={call.remoteUserInfo}
          connectionQuality={call.connectionQuality}
          onToggleMute={call.toggleMute}
          onToggleCamera={call.toggleCamera}
          onFlipCamera={call.flipCamera}
          facingMode={call.facingMode}
          onEndCall={call.endCall}
          onReplaceVideoTrack={call.replaceVideoTrack}
        />
      )}
      {/* Permission denied modal — guides user to Settings */}
      {call.permissionDenied && (
        <PermissionDeniedModal
          onRetry={call.retryAfterPermission}
          onDismiss={call.dismissPermissionModal}
        />
      )}
    </>
  );
};

// ─── Main AppLayout ───────────────────────────────────────────────────────────

/**
 * @param {React.ReactNode} children - Page content
 * @param {boolean} hideNav - Hide both sidebar/top/bottom nav (used for auth pages)
 * @param {boolean} hideTopNav - Hide only the mobile TopNav (used for pages with custom headers)
 */
const AppLayout = ({ children, hideNav = false, hideTopNav = false }) => {
  const { theme } = useTheme();
  const { impersonation } = useAuth();

  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const mainBgClass = isLight ? 'bg-gray-50' : isBeach ? 'bg-black' : 'bg-zinc-900';
  const impersonationPadding = impersonation ? 'pt-[88px] md:pt-[72px]' : '';

  const showSidebar = !hideNav;
  const showTopNav = !hideNav && !hideTopNav;
  const showBottomNav = !hideNav;

  return (
    <div
      className={`${mainBgClass} transition-colors duration-300`}
      style={{ height: '100dvh', overflow: 'hidden' }}
    >
      {/* System overlays */}
      <ImpersonationBannerWrapper />
      <PersonaMaskBannerWrapper />
      <PushNotificationInit />
      <BackButtonHandler />
      <CallManager />

      {/* Navigation chrome */}
      {showSidebar && <Sidebar />}
      {showTopNav && <TopNav />}

      {/* Page content */}
      <main
        className={`${mainBgClass} ${showSidebar ? 'md:ml-[200px]' : ''} ${showTopNav ? 'pt-14 md:pt-0' : ''} ${showBottomNav ? 'pb-20 md:pb-0' : ''} transition-colors duration-300 ${impersonationPadding} hide-scrollbar`}
        style={{ height: '100dvh', overflowY: 'auto', overflowX: 'hidden' }}
      >
        {children}
      </main>

      {showBottomNav && <BottomNav />}
    </div>
  );
};

export default AppLayout;
