/**
 * ProtectedRoute.js — Auth gate for authenticated-only routes.
 *
 * Handles three cases:
 *   1. Auth still loading → shows spinner
 *   2. No user → redirects to /auth with `redirect` param for post-login return
 *   3. Grom user → wraps in GromSafetyGate unless route is always-allowed
 *
 * Hydrates from localStorage synchronously to avoid a flash to /auth
 * while AuthContext is resolving the async Supabase session.
 */
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import GromSafetyGate from '../GromSafetyGate';
import { ROLES } from '../../constants/roles';

/**
 * Routes where Groms can see limited content without parent linking.
 * (e.g., the feed shows filtered content instead of a full block)
 */
export const GROM_LIMITED_ACCESS_ROUTES = ['/feed'];

/**
 * Routes that groms can always access regardless of parent-linking status.
 * Profile, settings, theme, and GromHQ are always reachable.
 */
export const GROM_ALWAYS_ALLOWED_ROUTES = [
  '/profile',
  '/settings',
  '/theme',
  '/grom-hq',
];

const ProtectedRoute = ({ children, bypassGromGate = false }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Hydrate from localStorage synchronously while AuthContext resolves.
  // This replaces the old window.location.reload() hack that masked a timing issue.
  const storedUser = React.useMemo(() => {
    if (user || loading) return null;
    try {
      const raw = localStorage.getItem('raw-surf-user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [user, loading]);

  const effectiveUser = user || storedUser;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400"></div>
      </div>
    );
  }

  if (!effectiveUser) {
    // Save intended destination for post-login redirect
    const currentPath = window.location.pathname + window.location.search;
    return <Navigate to={`/auth?tab=signup&redirect=${encodeURIComponent(currentPath)}`} replace />;
  }

  // Grom gate logic
  const currentPath = location.pathname;
  const isAlwaysAllowed = GROM_ALWAYS_ALLOWED_ROUTES.some(route => currentPath.startsWith(route));
  const isLimitedAccess = GROM_LIMITED_ACCESS_ROUTES.includes(currentPath);

  if (effectiveUser.role === ROLES.GROM && !effectiveUser.is_admin && !bypassGromGate && !isAlwaysAllowed) {
    return (
      <GromSafetyGate allowLimitedFeed={isLimitedAccess}>
        {children}
      </GromSafetyGate>
    );
  }

  return children;
};

export default ProtectedRoute;
