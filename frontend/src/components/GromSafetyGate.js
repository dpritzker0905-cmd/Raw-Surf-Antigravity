import React, { useState, useEffect, createContext, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../lib/apiClient';
import GromLimitedFeed from './GromLimitedFeed';
import logger from '../utils/logger';
import { Shield, Lock, Clock, ShieldAlert } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { ROLES } from '../constants/roles';
import AskMyParentPanel from './grom/AskMyParentPanel';


// Create context to share Grom status across components
const GromStatusContext = createContext(null);

export const useGromStatus = () => useContext(GromStatusContext);

/**
 * GromSafetyGate - Root-level protection for underage users
 * 
 * LOGIC:
 * 1. If user is not a Grom -> Allow all content
 * 2. If user is Admin/God Mode -> Allow all content (maintenance access)
 * 3. If Grom is linked AND approved -> Allow all content
 * 4. If Grom is unlinked OR unapproved:
 *    - /feed route -> Show LIMITED Grom feed (3 posts from other Groms)
 *    - All other protected routes -> Block completely with Safety Gate
 * 
 * BLOCKED FEATURES for unlinked Groms:
 * - Full Feed, Stories, Go Live, Messages, Post Content
 * - On-Demand/Active Photography features
 * - Direct messaging
 */
export const GromSafetyGate = ({ children, allowLimitedFeed = false }) => {
  const { user, loading: authLoading } = useAuth();
  const _navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [gromStatus, setGromStatus] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    
    if (user?.id && user?.role === ROLES.GROM) {
      checkGromStatus();
    } else {
      setLoading(false);
    }
  }, [user?.id, user?.role, authLoading]);

  const checkGromStatus = async () => {
    try {
      const response = await apiClient.get(`/grom-hq/grom-status/${user.id}`);
      setGromStatus(response.data);
    } catch (error) {
      logger.error('Failed to check grom status:', error);
      // Default to locked state on error
      setGromStatus({ is_linked: false, is_approved: false });
    } finally {
      setLoading(false);
    }
  };

  // Admin/God Mode users always have full access
  if (user?.is_admin) {
    return (
      <GromStatusContext.Provider value={{ gromStatus, loading, isUnlinked: false }}>
        {children}
      </GromStatusContext.Provider>
    );
  }

  // Not a Grom - show content normally
  if (!user || user.role !== ROLES.GROM) {
    return (
      <GromStatusContext.Provider value={{ gromStatus: null, loading: false, isUnlinked: false }}>
        {children}
      </GromStatusContext.Provider>
    );
  }

  // Loading state
  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
      </div>
    );
  }

  // Grom is linked AND approved - full access
  if (gromStatus?.is_linked && gromStatus?.is_approved) {
    return (
      <GromStatusContext.Provider value={{ gromStatus, loading: false, isUnlinked: false }}>
        {children}
      </GromStatusContext.Provider>
    );
  }

  // UNLINKED/UNAPPROVED GROM - Check if we should show limited feed
  const isOnFeedRoute = location.pathname === '/feed';
  
  if (allowLimitedFeed || isOnFeedRoute) {
    // Show limited Grom feed instead of full feed
    return (
      <GromStatusContext.Provider value={{ gromStatus, loading: false, isUnlinked: true }}>
        <GromLimitedFeed gromStatus={gromStatus} />
      </GromStatusContext.Provider>
    );
  }

  // All other routes - show full Safety Gate block
  return (
    <GromStatusContext.Provider value={{ gromStatus, loading: false, isUnlinked: true }}>
      <SafetyGateUI gromStatus={gromStatus} onRefresh={checkGromStatus} />
    </GromStatusContext.Provider>
  );
};

/**
 * SafetyGateUI - The blocking UI shown to unlinked Groms
 */
const SafetyGateUI = ({ onRefresh }) => {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-cyan-500/30 to-blue-500/30 flex items-center justify-center border-2 border-cyan-500/50">
            <Shield className="w-10 h-10 text-cyan-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Parental Link Required</h1>
          <p className="text-gray-400">
            Your account needs to be linked to a parent or guardian before you can access this feature.
          </p>
        </div>

        {/* Status Card */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <Clock className="w-6 h-6 text-yellow-400" />
              </div>
              <div>
                <p className="text-white font-semibold">Link with a parent or guardian</p>
                <p className="text-sm text-gray-400">
                  Get a one-time code for your parent, or answer an invite from them
                </p>
              </div>
            </div>

            {/* Two-sided link: the child gets a one-time code or answers an invite */}
            <AskMyParentPanel onLinked={onRefresh} />
          </CardContent>
        </Card>

        {/* What's Locked */}
        <Card className="bg-zinc-900/60 border-zinc-800">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-white mb-3 flex items-center gap-2">
              <Lock className="w-4 h-4 text-red-400" />
              Features locked until approved:
            </p>
            <div className="grid grid-cols-2 gap-2">
              {['Full Feed', 'Stories', 'Go Live', 'Messages', 'Post Content', 'Explore'].map((feature) => (
                <div 
                  key={feature}
                  className="flex items-center gap-2 p-2 bg-zinc-800/50 rounded-lg"
                >
                  <ShieldAlert className="w-4 h-4 text-red-400" />
                  <span className="text-sm text-gray-400">{feature}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Help Text */}
        <div className="text-center space-y-3">
          <p className="text-sm text-gray-500">
            Need help? Ask your parent to download Raw Surf OS and create a "Grom Parent" account.
          </p>
          <Button 
            variant="outline" 
            className="border-zinc-700 text-gray-400"
            onClick={onRefresh}
          >
            Refresh Status
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * Hook to check if current user can perform an action based on parental controls
 */
export const useParentalControls = () => {
  const { user } = useAuth();
  const [controls, setControls] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.id && user?.role === ROLES.GROM) {
      fetchControls();
    } else {
      setLoading(false);
      setControls(null);
    }
  }, [user?.id, user?.role]);

  const fetchControls = async () => {
    try {
      const response = await apiClient.get(`/grom-hq/grom-status/${user.id}`);
      setControls(response.data.parental_controls);
    } catch (error) {
      logger.error('Failed to fetch parental controls:', error);
    } finally {
      setLoading(false);
    }
  };

  const canPost = () => !user || user.role !== ROLES.GROM || controls?.can_post !== false;
  const canStream = () => !user || user.role !== ROLES.GROM || controls?.can_stream !== false;
  const canMessage = () => !user || user.role !== ROLES.GROM || controls?.can_message !== false;
  const canComment = () => !user || user.role !== ROLES.GROM || controls?.can_comment !== false;
  const isViewOnly = () => user?.role === ROLES.GROM && controls?.view_only === true;

  return {
    loading,
    controls,
    canPost,
    canStream,
    canMessage,
    canComment,
    isViewOnly
  };
};

export default GromSafetyGate;
