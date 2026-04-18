import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { PricingProvider } from './contexts/PricingContext';
import { PersonaProvider } from './contexts/PersonaContext';
import { Toaster } from './components/ui/sonner';
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
import { Sidebar } from './components/Sidebar';
import { TopNav } from './components/TopNav';
import { BottomNav } from './components/BottomNav';
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
import GromSafetyGate from './components/GromSafetyGate';
import OnDemandSettingsPage from './components/OnDemandSettingsPage';
import SpotHub from './components/SpotHub';
import CrewPaymentPage from './components/CrewPaymentPage';
import CrewChat from './components/CrewChat';
import SurferGallery from './components/SurferGallery';
import { PublicPhotographerGallery } from './components/PublicPhotographerGallery';
import UsernameSetup from './components/UsernameSetup';
import { usePushNotifications } from './hooks/usePushNotifications';
import { ThemePage } from './components/ThemePage';
import PersonaMaskBanner from './components/PersonaMaskBanner';
import ImpersonationBanner from './components/ImpersonationBanner';
import AccessCodeScreen from './components/AccessCodeScreen';
import SearchPage from './pages/SearchPage';
import './App.css';

// Wrapper to render ImpersonationBanner when admin is viewing as another user
const ImpersonationBannerWrapper = () => {
  const { impersonation, loading } = useAuth();
  
  if (loading || !impersonation) {
    return null;
  }
  
  return <ImpersonationBanner />;
};

// Wrapper to only render PersonaMaskBanner when user is confirmed authenticated
// and NOT on public/landing pages
const PersonaMaskBannerWrapper = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  
  // List of public routes where God Mode banner should NOT appear
  const publicRoutes = ['/', '/auth', '/auth/'];
  const isOnPublicRoute = publicRoutes.includes(location.pathname);
  
  // CRITICAL: Don't render anything during loading, if no user, or on public routes
  // This prevents any flash of the God Mode UI for unauthorized users or on landing page
  if (loading || !user?.id || !user?.is_admin || isOnPublicRoute) {
    return null;
  }
  
  return <PersonaMaskBanner />;
};

/**
 * ROUTES THAT ALLOW LIMITED GROM ACCESS
 * These routes show limited content for unlinked Groms instead of blocking
 */
const GROM_LIMITED_ACCESS_ROUTES = ['/feed'];

/**
 * ROUTES THAT ARE ALWAYS ALLOWED FOR GROMS
 * These routes don't require parent linking (profile, settings, etc.)
 */
const GROM_ALWAYS_ALLOWED_ROUTES = [
  '/profile',
  '/settings',
  '/theme',
  '/grom-hq',  // They can see their own status
];

const ProtectedRoute = ({ children, bypassGromGate = false }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    // Double-check localStorage for auth persistence fix
    if (!user && !loading) {
      const storedUser = localStorage.getItem('raw-surf-user');
      if (storedUser) {
        // User exists in localStorage but not in state - reload
        window.location.reload();
        return;
      }
    }
    setIsRestoring(false);
  }, [user, loading]);

  if (loading || isRestoring) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400"></div>
      </div>
    );
  }

  if (!user) {
    // Save intended destination for post-login redirect
    const currentPath = window.location.pathname + window.location.search;
    return <Navigate to={`/auth?tab=signup&redirect=${encodeURIComponent(currentPath)}`} replace />;
  }

  // Check if this route should bypass Grom gate (e.g., profile, settings)
  const currentPath = location.pathname;
  const isAlwaysAllowed = GROM_ALWAYS_ALLOWED_ROUTES.some(route => currentPath.startsWith(route));
  const isLimitedAccess = GROM_LIMITED_ACCESS_ROUTES.includes(currentPath);

  // If user is Grom and route is not always allowed, wrap with GromSafetyGate
  if (user.role === 'Grom' && !user.is_admin && !bypassGromGate && !isAlwaysAllowed) {
    return (
      <GromSafetyGate allowLimitedFeed={isLimitedAccess}>
        {children}
      </GromSafetyGate>
    );
  }

  return children;
};

const SubscriptionRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth?tab=signup" replace />;
  }

  return children;
};

// Push notification initializer component
const PushNotificationInit = () => {
  const { user } = useAuth();
  const { isSupported, subscribe } = usePushNotifications(user?.id);

  useEffect(() => {
    // Auto-subscribe to push notifications when user logs in
    // Only if supported and user has already granted permission
    if (user?.id && isSupported && Notification.permission === 'granted') {
      subscribe();
    }
  }, [user?.id, isSupported, subscribe]);

  return null; // This component doesn't render anything
};

// Handle browser back button to prevent going to auth pages
const BackButtonHandler = () => {
  const _location = useLocation();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  useEffect(() => {
    // Handler for browser back/forward navigation
    const handlePopState = (_event) => {
      // If user is authenticated and trying to go back to auth page, redirect to feed
      if (user && (
        window.location.pathname === '/auth' || 
        window.location.pathname === '/login' ||
        window.location.pathname === '/'
      )) {
        // Prevent the back navigation by pushing forward to feed
        // Use setTimeout to ensure this runs after the popstate event completes
        setTimeout(() => {
          window.history.pushState(null, '', '/feed');
          // Trigger a React Router navigation to properly render the Feed component
          navigate('/feed', { replace: true });
        }, 0);
      }
    };

    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [user, navigate]);

  return null;
};

// Responsive layout for authenticated users
// Desktop: Sidebar on left
// Mobile: TopNav + BottomNav
const AppLayout = ({ children, hideNav = false, hideTopNav = false }) => {
  const { theme } = useTheme();
  const { impersonation } = useAuth();
  
  // Theme-specific classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  // Main bg: white for light, dark gray for dark, pure black for beach
  const mainBgClass = isLight ? 'bg-gray-50' : isBeach ? 'bg-black' : 'bg-zinc-900';
  
  // Add top padding when impersonation banner is shown
  const impersonationPadding = impersonation ? 'pt-[88px] md:pt-[72px]' : '';
  
  // Determine what to show based on hideNav and hideTopNav
  const showSidebar = !hideNav;
  const showTopNav = !hideNav && !hideTopNav;
  const showBottomNav = !hideNav;
  
  return (
    <div 
      className={`${mainBgClass} transition-colors duration-300`}
      style={{ height: '100dvh', overflow: 'hidden' }}
    >
      {/* Impersonation Banner - shows when admin is viewing as another user */}
      <ImpersonationBannerWrapper />
      
      {/* Initialize push notifications */}
      <PushNotificationInit />
      
      {/* Handle browser back button */}
      <BackButtonHandler />
      
      {/* Desktop Sidebar - changes with theme */}
      {showSidebar && <Sidebar />}
      
      {/* Mobile Top Nav */}
      {showTopNav && <TopNav />}
      
      {/* Main Content */}
      <main 
        className={`${mainBgClass} ${showSidebar ? 'md:ml-[200px]' : ''} ${showTopNav ? 'pt-14' : ''} ${showBottomNav ? 'pb-20 md:pb-0' : ''} transition-colors duration-300 ${impersonationPadding} hide-scrollbar`}
        style={{ height: '100dvh', overflowY: 'auto', overflowX: 'hidden' }}
      >
        {children}
      </main>
      
      {/* Mobile Bottom Nav */}
      {showBottomNav && <BottomNav />}
    </div>
  );
};

// Placeholder components for routes
const _ExplorePage = () => (
  <div className="p-4 md:p-8">
    <h1 className="text-2xl font-bold text-white mb-4" style={{ fontFamily: 'Oswald' }}>Explore</h1>
    <p className="text-gray-400">Explore photographers and surf spots...</p>
  </div>
);

// Import the actual CreatePost component
import { CreatePost } from './components/CreatePost';

const CreatePostPage = () => (
  <CreatePost />
);

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
      <PersonaProvider>
      <PricingProvider>
        <AccessCodeScreen>
        <BrowserRouter>
          <PersonaMaskBannerWrapper />
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
              element={
                <ProtectedRoute>
                  <AppLayout>
                    <UnifiedAdminConsole />
                  </AppLayout>
                </ProtectedRoute>
              }
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
  );
}

export default App;
