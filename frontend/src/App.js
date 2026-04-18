import React from 'react';
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

// ─── Pages & Features ────────────────────────────────────────────────────────
import { Home } from './components/Home';
import { Auth } from './components/Auth';
import { ForgotPassword, ResetPassword } from './components/PasswordReset';
import { SurferSubscription } from './components/SurferSubscription';
import { PhotographerSubscription } from './components/PhotographerSubscription';
import { SubscriptionSuccess } from './components/SubscriptionSuccess';
import { ProOnboarding } from './components/ProOnboarding';
import { Feed } from './components/Feed';
import { Profile } from './components/Profile';
import { Settings } from './components/Settings';
import SinglePost from './components/SinglePost';
import { Credits } from './components/Credits';
import { Bookings } from './components/Bookings';
import { MapPage } from './components/MapPage';
import { MessagesPage } from './components/MessagesPage';
import { NotificationsPage } from './components/NotificationsPage';
import { Explore } from './components/Explore';
import { SurfAlerts } from './components/SurfAlerts';
import { GalleryPage } from './components/GalleryPage';
import { PhotographerBookingsManager } from './components/PhotographerBookingsManager';
import { PhotographerSessionsManager } from './components/PhotographerSessionsManager';
import { OnDemandSessionManager } from './components/OnDemandSessionManager';
import { PhotographerGalleryManager } from './components/PhotographerGalleryManager';
import { CreditWallet } from './components/CreditWallet';
import { GearHub } from './components/GearHub';
import { ImpactDashboard } from './components/ImpactDashboard';
import { EarningsDashboard } from './components/EarningsDashboard';
import UnifiedAdminConsole from './components/UnifiedAdminConsole';
import PaymentSuccess from './components/PaymentSuccess';
import BookingPaymentSuccess from './components/BookingPaymentSuccess';
import DispatchPaymentSuccess from './components/DispatchPaymentSuccess';
import XPLeaderboard from './components/XPLeaderboard';
import ThePeakHub from './components/ThePeakHub';
import TheInsideHub from './components/TheInsideHub';
import ImpactZoneHub from './components/ImpactZoneHub';
import StokeSponsorDashboard from './components/StokeSponsorDashboard';
import StokeSponsorLeaderboard from './components/StokeSponsorLeaderboard';
import StokedDashboard from './components/StokedDashboard';
import StokedLockedPage from './components/StokedLockedPage';
import GromHQ from './components/GromHQ';
import GromManage from './components/GromManage';
import OnDemandSettingsPage from './components/OnDemandSettingsPage';
import SpotHub from './components/SpotHub';
import CrewPaymentPage from './components/CrewPaymentPage';
import CrewChat from './components/CrewChat';
import SurferGallery from './components/SurferGallery';
import { PublicPhotographerGallery } from './components/PublicPhotographerGallery';
import UsernameSetup from './components/UsernameSetup';
import { ThemePage } from './components/ThemePage';
import SearchPage from './pages/SearchPage';
import { CreatePost } from './components/CreatePost';
import './App.css';

// ─── Simple wrappers ──────────────────────────────────────────────────────────

// Subscription-only gate (no layout needed)
const SubscriptionRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400"></div>
      </div>
    );
  }
  if (!user) return <Navigate to="/auth?tab=signup" replace />;
  return children;
};

const CreatePostPage = () => <CreatePost />;



function App() {
  console.log('[App] Rendering App component');
  return (
    <ErrorBoundary>
    <ThemeProvider>
      <AuthProvider>
      <PersonaProvider>
      <PricingProvider>
        <AccessCodeScreen>
        <BrowserRouter>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Home />} />
            <Route path="/auth" element={<Auth />} />
            
            {/* Subscription/Onboarding Routes (no nav) */}
            <Route
              path="/surfer-subscription"
              element={
                <SubscriptionRoute>
                  <SurferSubscription />
                </SubscriptionRoute>
              }
            />
            <Route
              path="/photographer-subscription"
              element={
                <SubscriptionRoute>
                  <PhotographerSubscription />
                </SubscriptionRoute>
              }
            />
            <Route
              path="/pro-onboarding"
              element={
                <SubscriptionRoute>
                  <ProOnboarding />
                </SubscriptionRoute>
              }
            />
            <Route
              path="/subscription/success"
              element={
                <SubscriptionRoute>
                  <SubscriptionSuccess />
                </SubscriptionRoute>
              }
            />
            
            {/* Username Setup Route */}
            <Route
              path="/setup-username"
              element={
                <SubscriptionRoute>
                  <UsernameSetup skipAllowed={true} />
                </SubscriptionRoute>
              }
            />
            
            {/* Protected App Routes with Responsive Layout */}
            <Route
              path="/feed"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Feed />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/explore"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Explore />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/search"
              element={
                <ProtectedRoute>
                  <AppLayout hideTopNav={true}>
                    <SearchPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/map"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <MapPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/spot-hub/:spotId"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <SpotHub />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/bookings"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Bookings />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/messages"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <MessagesPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/messages/:conversationId"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <MessagesPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/messages/new/:recipientId"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <MessagesPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Profile />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile/:userId"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Profile />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/post/:postId"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <SinglePost />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Settings />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/theme"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <ThemePage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/photographer/on-demand-settings"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <OnDemandSettingsPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/credits"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Credits />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/credits/success"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <Credits />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/wallet"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <CreditWallet />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/payment/success"
              element={
                <ProtectedRoute>
                  <PaymentSuccess />
                </ProtectedRoute>
              }
            />
            <Route
              path="/gear-hub"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <GearHub />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/impact"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <ImpactDashboard />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/impacted"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <ImpactDashboard />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/create"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <CreatePostPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/notifications"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <NotificationsPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/alerts"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <SurfAlerts />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/gallery"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <GalleryPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            {/* Public Photographer Gallery - accessible to anyone */}
            <Route
              path="/photographer/:photographerId/gallery"
              element={
                <AppLayout>
                  <PublicPhotographerGallery />
                </AppLayout>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <UnifiedAdminConsole />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/god-mode"
              element={<Navigate to="/admin" replace />}
            />
            <Route
              path="/leaderboard"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <div className="max-w-2xl mx-auto p-4">
                      <XPLeaderboard />
                    </div>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/career/the-peak"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <div className="max-w-2xl mx-auto p-4">
                      <ThePeakHub />
                    </div>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/career/impact-zone"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <div className="max-w-2xl mx-auto p-4">
                      <ImpactZoneHub />
                    </div>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/career/the-inside"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <div className="max-w-2xl mx-auto p-4">
                      <TheInsideHub />
                    </div>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/career/stoke-sponsor"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <div className="max-w-2xl mx-auto p-4">
                      <StokeSponsorDashboard />
                    </div>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/career/stoke-leaderboard"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <div className="max-w-2xl mx-auto p-4">
                      <StokeSponsorLeaderboard />
                    </div>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/stoked"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <div className="max-w-2xl mx-auto p-4">
                      <StokedDashboard />
                    </div>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/stoked-locked"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <div className="max-w-2xl mx-auto p-4">
                      <StokedLockedPage />
                    </div>
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/grom-hq"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <GromHQ />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/grom-hq/manage/:gromId"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <GromManage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/photographer/bookings"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <PhotographerBookingsManager />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/bookings/pay/:bookingId"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <CrewPaymentPage />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/bookings/success"
              element={
                <ProtectedRoute>
                  <BookingPaymentSuccess />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dispatch/success"
              element={
                <ProtectedRoute>
                  <DispatchPaymentSuccess />
                </ProtectedRoute>
              }
            />
            <Route
              path="/bookings/:bookingId/chat"
              element={
                <ProtectedRoute>
                  <CrewChat />
                </ProtectedRoute>
              }
            />
            <Route
              path="/photographer/sessions"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <PhotographerSessionsManager />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/photographer/on-demand"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <OnDemandSessionManager />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/photographer/earnings"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <EarningsDashboard />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/photographer/galleries/:galleryId"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <PhotographerGalleryManager />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            
            {/* Surfer Gallery - "My Gallery" / "The Locker" */}
            <Route
              path="/my-gallery"
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <SurferGallery />
                  </AppLayout>
                </ProtectedRoute>
              }
            />
            
            {/* Password Reset Routes (Public) */}
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            
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
