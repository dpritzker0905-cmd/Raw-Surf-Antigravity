import React, { useState, useEffect, createContext, useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import GromLimitedFeed from './GromLimitedFeed';
import logger from '../utils/logger';
import { Shield, Lock, Clock, Copy, CheckCircle, ShieldAlert, UserPlus } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { toast } from 'sonner';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

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
    
    if (user?.id && user?.role === 'Grom') {
      checkGromStatus();
    } else {
      setLoading(false);
    }
  }, [user?.id, user?.role, authLoading]);

  const checkGromStatus = async () => {
    try {
      const response = await axios.get(`${API}/grom-hq/grom-status/${user.id}`);
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
  if (!user || user.role !== 'Grom') {
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
const SafetyGateUI = ({ gromStatus, onRefresh }) => {
  const [codeCopied, setCodeCopied] = useState(false);

  const copyGuardianCode = () => {
    if (gromStatus?.guardian_code) {
      navigator.clipboard.writeText(gromStatus.guardian_code);
      setCodeCopied(true);
      toast.success('Guardian code copied!');
      setTimeout(() => setCodeCopied(false), 3000);
    }
  };

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
                <p className="text-white font-semibold">Pending Guardian Approval</p>
                <p className="text-sm text-gray-400">
                  {gromStatus?.is_linked 
                    ? "Waiting for your parent to approve the link"
                    : "Share your Guardian Code with your parent"}
                </p>
              </div>
            </div>

            {/* Guardian Code */}
            {gromStatus?.guardian_code && (
              <div className="bg-zinc-800 rounded-xl p-4 mb-4">
                <p className="text-xs text-gray-400 mb-2 text-center">Your Guardian Code</p>
                <div className="flex items-center justify-center gap-3">
                  <div className="text-3xl font-mono font-bold text-cyan-400 tracking-wider">
                    {gromStatus.guardian_code}
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="border-cyan-500/50 text-cyan-400"
                    onClick={copyGuardianCode}
                  >
                    {codeCopied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-2 text-center">
                  Give this code to your parent so they can link your account
                </p>
              </div>
            )}

            {/* Parent Info (if linked but not approved) */}
            {gromStatus?.is_linked && gromStatus?.parent_info && (
              <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg">
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
                  {gromStatus.parent_info.avatar_url ? (
                    <img 
                      src={gromStatus.parent_info.avatar_url} 
                      alt="" 
                      className="w-10 h-10 rounded-full"
                    />
                  ) : (
                    <UserPlus className="w-5 h-5 text-cyan-400" />
                  )}
                </div>
                <div>
                  <p className="text-white font-medium">{gromStatus.parent_info.full_name}</p>
                  <p className="text-xs text-gray-400">Pending approval...</p>
                </div>
                <Badge className="ml-auto bg-yellow-500/20 text-yellow-400 border-0">
                  PENDING
                </Badge>
              </div>
            )}
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
    if (user?.id && user?.role === 'Grom') {
      fetchControls();
    } else {
      setLoading(false);
      setControls(null);
    }
  }, [user?.id, user?.role]);

  const fetchControls = async () => {
    try {
      const response = await axios.get(`${API}/grom-hq/grom-status/${user.id}`);
      setControls(response.data.parental_controls);
    } catch (error) {
      logger.error('Failed to fetch parental controls:', error);
    } finally {
      setLoading(false);
    }
  };

  const canPost = () => !user || user.role !== 'Grom' || controls?.can_post !== false;
  const canStream = () => !user || user.role !== 'Grom' || controls?.can_stream !== false;
  const canMessage = () => !user || user.role !== 'Grom' || controls?.can_message !== false;
  const canComment = () => !user || user.role !== 'Grom' || controls?.can_comment !== false;
  const isViewOnly = () => user?.role === 'Grom' && controls?.view_only === true;

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
