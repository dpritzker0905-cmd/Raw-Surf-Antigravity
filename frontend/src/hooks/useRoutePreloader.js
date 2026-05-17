/**
 * useRoutePreloader GÇö Preloads React.lazy route chunks on hover/touch.
 * Eliminates perceived loading delay when navigating between high-traffic pages.
 *
 * Usage:
 *   const preload = useRoutePreloader();
 *   <button onMouseEnter={() => preload('profile')} onClick={() => navigate('/profile')}>
 *     Profile
 *   </button>
 */
import { useCallback, useRef } from 'react';

// Map route keys to their dynamic import functions
const ROUTE_LOADERS = {
  feed: () => import('../components/Feed'),
  profile: () => import('../components/Profile'),
  messages: () => import('../components/MessagesPage'),
  explore: () => import('../components/Explore'),
  bookings: () => import('../components/Bookings'),
  gallery: () => import('../components/GalleryPage'),
  settings: () => import('../components/Settings'),
  map: () => import('../components/MapPage'),
  notifications: () => import('../components/NotificationsPage'),
};

const useRoutePreloader = () => {
  // Track which routes we've already preloaded to avoid duplicate imports
  const preloadedRef = useRef(new Set());

  const preload = useCallback((routeKey) => {
    if (preloadedRef.current.has(routeKey)) return;
    
    const loader = ROUTE_LOADERS[routeKey];
    if (loader) {
      preloadedRef.current.add(routeKey);
      // Fire and forget GÇö the browser will cache the chunk
      loader().catch(() => {
        // Silent failure GÇö preload is best-effort
        preloadedRef.current.delete(routeKey);
      });
    }
  }, []);

  return preload;
};

export default useRoutePreloader;
