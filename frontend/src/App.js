import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { PricingProvider } from './contexts/PricingContext';
import { PersonaProvider } from './contexts/PersonaContext';
import { Toaster } from './components/ui/sonner';
import AccessCodeScreen from './components/AccessCodeScreen';

// ─── Routing utilities ─────────────────────────────────────────────────────────
import ErrorBoundary from './components/routing/ErrorBoundary';
import ProtectedRoute from './components/routing/ProtectedRoute';
import AppLayout from './components/routing/AppLayout';

// ─── Critical path (NOT lazy — loaded immediately) ────────────────────────────
import { Home } from './components/Home';
import { Auth } from './components/Auth';
import { ForgotPassword, ResetPassword } from './components/PasswordReset';

// ─── Route-split (lazy): loaded only when the user navigates there ─────────────
// This splits the 1.09 MB bundle into smaller chunks for faster initial load
const Feed                        = React.lazy(() => import('./components/Feed').then(m => ({ default: m.Feed })));
const Profile                     = React.lazy(() => import('./components/Profile').then(m => ({ default: m.Profile })));
const Settings                    = React.lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const MessagesPage                = React.lazy(() => import('./components/MessagesPage').then(m => ({ default: m.MessagesPage })));
const MapPage                     = React.lazy(() => import('./components/MapPage').then(m => ({ default: m.MapPage })));
const GalleryPage                 = React.lazy(() => import('./components/GalleryPage').then(m => ({ default: m.GalleryPage })));
const UnifiedAdminConsole         = React.lazy(() => import('./components/UnifiedAdminConsole'));
const PhotographerBookingsManager = React.lazy(() => import('./components/PhotographerBookingsManager').then(m => ({ default: m.PhotographerBookingsManager })));
const PhotographerSessionsManager = React.lazy(() => import('./components/PhotographerSessionsManager').then(m => ({ default: m.PhotographerSessionsManager })));
const OnDemandSessionManager      = React.lazy(() => import('./components/OnDemandSessionManager').then(m => ({ default: m.OnDemandSessionManager })));
const ScheduledBookingDrawer      = React.lazy(() => import('./components/ScheduledBookingDrawer')); // used by bookings page

// ─── Medium-priority lazy ─────────────────────────────────────────────────────
const SurferSubscription          = React.lazy(() => import('./components/SurferSubscription').then(m => ({ default: m.SurferSubscription })));
const PhotographerSubscription    = React.lazy(() => import('./components/PhotographerSubscription').then(m => ({ default: m.PhotographerSubscription })));
const SubscriptionSuccess         = React.lazy(() => import('./components/SubscriptionSuccess').then(m => ({ default: m.SubscriptionSuccess })));
const ProOnboarding               = React.lazy(() => import('./components/ProOnboarding').then(m => ({ default: m.ProOnboarding })));
const Bookings                    = React.lazy(() => import('./components/Bookings').then(m => ({ default: m.Bookings })));
const Explore                     = React.lazy(() => import('./components/Explore').then(m => ({ default: m.Explore })));
const SurfAlerts                  = React.lazy(() => import('./components/SurfAlerts').then(m => ({ default: m.SurfAlerts })));
const Credits                     = React.lazy(() => import('./components/Credits').then(m => ({ default: m.Credits })));
const CreditWallet                = React.lazy(() => import('./components/CreditWallet').then(m => ({ default: m.CreditWallet })));
const GearHub                     = React.lazy(() => import('./components/GearHub').then(m => ({ default: m.GearHub })));
const ImpactDashboard             = React.lazy(() => import('./components/ImpactDashboard').then(m => ({ default: m.ImpactDashboard })));
const EarningsDashboard           = React.lazy(() => import('./components/EarningsDashboard').then(m => ({ default: m.EarningsDashboard })));
const PhotographerGalleryManager  = React.lazy(() => import('./components/PhotographerGalleryManager').then(m => ({ default: m.PhotographerGalleryManager })));
const NotificationsPage           = React.lazy(() => import('./components/NotificationsPage').then(m => ({ default: m.NotificationsPage })));
const SinglePost                  = React.lazy(() => import('./components/SinglePost'));
const PaymentSuccess              = React.lazy(() => import('./components/PaymentSuccess'));
const BookingPaymentSuccess       = React.lazy(() => import('./components/BookingPaymentSuccess'));
const DispatchPaymentSuccess      = React.lazy(() => import('./components/DispatchPaymentSuccess'));
const XPLeaderboard               = React.lazy(() => import('./components/XPLeaderboard'));
const ThePeakHub                  = React.lazy(() => import('./components/ThePeakHub'));
const TheInsideHub                = React.lazy(() => import('./components/TheInsideHub'));
const ImpactZoneHub               = React.lazy(() => import('./components/ImpactZoneHub'));
const StokeSponsorDashboard       = React.lazy(() => import('./components/StokeSponsorDashboard'));
const StokeSponsorLeaderboard     = React.lazy(() => import('./components/StokeSponsorLeaderboard'));
const StokedDashboard             = React.lazy(() => import('./components/StokedDashboard'));
const StokedLockedPage            = React.lazy(() => import('./components/StokedLockedPage'));
const GromHQ                      = React.lazy(() => import('./components/GromHQ'));
const GromManage                  = React.lazy(() => import('./components/GromManage'));
const OnDemandSettingsPage        = React.lazy(() => import('./components/OnDemandSettingsPage'));
const SpotHub                     = React.lazy(() => import('./components/SpotHub'));
const CrewPaymentPage             = React.lazy(() => import('./components/CrewPaymentPage'));
const CrewChat                    = React.lazy(() => import('./components/CrewChat'));
const SurferGallery               = React.lazy(() => import('./components/SurferGallery'));
const PublicPhotographerGallery   = React.lazy(() => import('./components/PublicPhotographerGallery').then(m => ({ default: m.PublicPhotographerGallery })));
const UsernameSetup               = React.lazy(() => import('./components/UsernameSetup'));
const ThemePage                   = React.lazy(() => import('./components/ThemePage').then(m => ({ default: m.ThemePage })));
const SearchPage                  = React.lazy(() => import('./pages/SearchPage'));
const CreatePost                  = React.lazy(() => import('./components/CreatePost').then(m => ({ default: m.CreatePost })));
const DispatchLobby               = React.lazy(() => import('./components/DispatchLobby').then(m => ({ default: m.DispatchLobby })));

import './App.css';

// ─── Audio: Unlock AudioContext on first user gesture for reliable ringtones ──
import { ensureAudioUnlocked } from './utils/audioUnlock';
ensureAudioUnlocked();

// ─── Full-screen loading spinner while lazy chunk loads ────────────────────────
const PageLoader = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0a0a0a 0%, #0d1a2a 100%)'
  }}>
    <div style={{
      width: 40,
      height: 40,
      border: '3px solid rgba(6,182,212,0.2)',
      borderTop: '3px solid #06b6d4',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite'
    }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// ─── Wrapper to apply Suspense on every lazy route ────────────────────────────
const Lazy = ({ children }) => (
  <Suspense fallback={<PageLoader />}>{children}</Suspense>
);

// ─── Subscription-only gate ────────────────────────────────────────────────────
const SubscriptionRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/auth?tab=signup" replace />;
  return children;
};

function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
      <AuthProvider>
      <PersonaProvider>
      <PricingProvider>
        <AccessCodeScreen>
        <BrowserRouter>
          <Routes>
            {/* ── Public ── */}
            <Route path="/" element={<Home />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* ── Onboarding / Subscription (no nav) ── */}
            <Route path="/surfer-subscription" element={<SubscriptionRoute><Lazy><SurferSubscription /></Lazy></SubscriptionRoute>} />
            <Route path="/photographer-subscription" element={<SubscriptionRoute><Lazy><PhotographerSubscription /></Lazy></SubscriptionRoute>} />
            <Route path="/pro-onboarding" element={<SubscriptionRoute><Lazy><ProOnboarding /></Lazy></SubscriptionRoute>} />
            <Route path="/subscription/success" element={<SubscriptionRoute><Lazy><SubscriptionSuccess /></Lazy></SubscriptionRoute>} />
            <Route path="/setup-username" element={<SubscriptionRoute><Lazy><UsernameSetup skipAllowed={true} /></Lazy></SubscriptionRoute>} />

            {/* ── Protected App Routes ── */}
            <Route path="/feed" element={<ProtectedRoute><AppLayout><Lazy><Feed /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/explore" element={<ProtectedRoute><AppLayout><Lazy><Explore /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/search" element={<ProtectedRoute><AppLayout hideTopNav={true}><Lazy><SearchPage /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/map" element={<ProtectedRoute><AppLayout><Lazy><MapPage /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/spot-hub/:spotId" element={<ProtectedRoute><AppLayout><Lazy><SpotHub /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/bookings" element={<ProtectedRoute><AppLayout><Lazy><Bookings /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/messages" element={<ProtectedRoute><AppLayout><Lazy><MessagesPage /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/messages/:conversationId" element={<ProtectedRoute><AppLayout><Lazy><MessagesPage /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/messages/new/:recipientId" element={<ProtectedRoute><AppLayout><Lazy><MessagesPage /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><AppLayout><Lazy><Profile /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/profile/:userId" element={<ProtectedRoute><AppLayout><Lazy><Profile /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/post/:postId" element={<ProtectedRoute><AppLayout><Lazy><SinglePost /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><AppLayout><Lazy><Settings /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/theme" element={<ProtectedRoute><AppLayout><Lazy><ThemePage /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/photographer/on-demand-settings" element={<ProtectedRoute><AppLayout><Lazy><OnDemandSettingsPage /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/credits" element={<ProtectedRoute><AppLayout><Lazy><Credits /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/credits/success" element={<ProtectedRoute><AppLayout><Lazy><Credits /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/wallet" element={<ProtectedRoute><AppLayout><Lazy><CreditWallet /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/payment/success" element={<ProtectedRoute><Lazy><PaymentSuccess /></Lazy></ProtectedRoute>} />
            <Route path="/gear-hub" element={<ProtectedRoute><AppLayout><Lazy><GearHub /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/impact" element={<ProtectedRoute><AppLayout><Lazy><ImpactDashboard /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/impacted" element={<Navigate to="/impact" replace />} />
            <Route path="/create" element={<ProtectedRoute><AppLayout><Lazy><CreatePost /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><AppLayout><Lazy><NotificationsPage /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute><AppLayout><Lazy><SurfAlerts /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/gallery" element={<ProtectedRoute><AppLayout><Lazy><GalleryPage /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/my-gallery" element={<ProtectedRoute><AppLayout><Lazy><SurferGallery /></Lazy></AppLayout></ProtectedRoute>} />

            {/* Public photographer gallery */}
            <Route path="/photographer/:photographerId/gallery" element={<AppLayout><Lazy><PublicPhotographerGallery /></Lazy></AppLayout>} />

            {/* Admin */}
            <Route path="/admin" element={<ProtectedRoute><AppLayout><Lazy><UnifiedAdminConsole /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/god-mode" element={<Navigate to="/admin" replace />} />

            {/* Career / Leaderboard */}
            <Route path="/leaderboard" element={<ProtectedRoute><AppLayout><Lazy><div className="max-w-2xl mx-auto p-4"><XPLeaderboard /></div></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/career/the-peak" element={<ProtectedRoute><AppLayout><Lazy><div className="max-w-2xl mx-auto p-4"><ThePeakHub /></div></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/career/impact-zone" element={<ProtectedRoute><AppLayout><Lazy><div className="max-w-2xl mx-auto p-4"><ImpactZoneHub /></div></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/career/the-inside" element={<ProtectedRoute><AppLayout><Lazy><div className="max-w-2xl mx-auto p-4"><TheInsideHub /></div></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/career/stoke-sponsor" element={<ProtectedRoute><AppLayout><Lazy><div className="max-w-2xl mx-auto p-4"><StokeSponsorDashboard /></div></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/career/stoke-leaderboard" element={<ProtectedRoute><AppLayout><Lazy><div className="max-w-2xl mx-auto p-4"><StokeSponsorLeaderboard /></div></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/stoked" element={<ProtectedRoute><AppLayout><Lazy><div className="max-w-2xl mx-auto p-4"><StokedDashboard /></div></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/stoked-locked" element={<ProtectedRoute><AppLayout><Lazy><div className="max-w-2xl mx-auto p-4"><StokedLockedPage /></div></Lazy></AppLayout></ProtectedRoute>} />

            {/* Grom HQ */}
            <Route path="/grom-hq" element={<ProtectedRoute><AppLayout><Lazy><GromHQ /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/grom-hq/manage/:gromId" element={<ProtectedRoute><AppLayout><Lazy><GromManage /></Lazy></AppLayout></ProtectedRoute>} />

            {/* Photographer */}
            <Route path="/photographer/bookings" element={<ProtectedRoute><AppLayout><Lazy><PhotographerBookingsManager /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/photographer/sessions" element={<ProtectedRoute><AppLayout><Lazy><PhotographerSessionsManager /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/photographer/on-demand" element={<ProtectedRoute><AppLayout><Lazy><OnDemandSessionManager /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/photographer/earnings" element={<ProtectedRoute><AppLayout><Lazy><EarningsDashboard /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/photographer/galleries/:galleryId" element={<ProtectedRoute><AppLayout><Lazy><PhotographerGalleryManager /></Lazy></AppLayout></ProtectedRoute>} />

            {/* Bookings / Crew */}
            <Route path="/bookings/pay/:bookingId" element={<ProtectedRoute><AppLayout><Lazy><CrewPaymentPage /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/bookings/success" element={<ProtectedRoute><Lazy><BookingPaymentSuccess /></Lazy></ProtectedRoute>} />
            <Route path="/dispatch/success" element={<ProtectedRoute><Lazy><DispatchPaymentSuccess /></Lazy></ProtectedRoute>} />
            <Route path="/dispatch/:dispatchId/lobby" element={<ProtectedRoute><AppLayout hideTopNav={false}><Lazy><DispatchLobby /></Lazy></AppLayout></ProtectedRoute>} />
            <Route path="/bookings/:bookingId/chat" element={<ProtectedRoute><Lazy><CrewChat /></Lazy></ProtectedRoute>} />

            {/* Fallback */}
            <Route path="*" element={<Home />} />
          </Routes>
          <Toaster position="top-center" richColors />
        </BrowserRouter>
        </AccessCodeScreen>
      </PricingProvider>
      </PersonaProvider>
      </AuthProvider>
    </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
