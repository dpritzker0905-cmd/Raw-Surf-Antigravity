import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { 

  Shield, Users, DollarSign, Clock, Trophy, Plus,
  Settings, ChevronRight, CheckCircle, XCircle,
  ShoppingBag, Activity, Bell, UserPlus,
  CreditCard, ShieldCheck, ShieldAlert, ArrowRight, Loader2, Unlink,
  KeyRound, UserX
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import {

  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import apiClient from '../lib/apiClient';
import { getNotifications, getUnreadCount, markRead, markAllRead, sendNotification, sendPhotographerAlert, createNotification, markAlertRead } from '../services/notificationService';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getFullUrl } from '../utils/media';



/**
 * Grom HQ - Parental Management Dashboard
 * For Grom Parent users to manage their linked Grom children
 * Features: Linked Groms list, Activity monitoring, Spending controls, Safety settings, Age Verification
 */
export const GromHQ = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [linkedGroms, setLinkedGroms] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [stats, setStats] = useState({
    totalEarnings: 0,
    totalSessions: 0,
    totalScreenTime: 0,
    achievementsUnlocked: 0
  });
  const [ageVerified, setAgeVerified] = useState(false);
  const [verifyingAge, setVerifyingAge] = useState(false);
  
  // Unlink modal state
  const [unlinkModalOpen, setUnlinkModalOpen] = useState(false);
  const [unlinkPassword, setUnlinkPassword] = useState('');
  const [unlinkingGrom, setUnlinkingGrom] = useState(null);
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  
  // Spending alerts state
  const [spendingAlerts, setSpendingAlerts] = useState([]);
  
  // Family Activity Feed state
  const [activityFeed, setActivityFeed] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [showActivityFeed, setShowActivityFeed] = useState(false);

  // Theme classes
  const isLight = theme === 'light';
  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const borderColor = isLight ? 'border-gray-200' : 'border-zinc-800';

  useEffect(() => {
    fetchGromData();
    checkAgeVerification();
    fetchSpendingAlerts();
    fetchActivityFeed();
  }, [user?.id]);

  const fetchGromData = async () => {
    if (!user?.id) return;
    setLoading(true);
    
    try {
      // Fetch linked Groms
      const gromsResponse = await apiClient.get(`/grom-hq/linked-groms/${user.id}`);
      setLinkedGroms(gromsResponse.data.linked_groms || []);
      setPendingRequests(gromsResponse.data.pending_requests || []);
      setStats(gromsResponse.data.stats || {
        totalEarnings: 0,
        totalSessions: 0,
        totalScreenTime: 0,
        achievementsUnlocked: 0
      });
    } catch (error) {
      logger.error('Failed to fetch Grom HQ data:', error);
      // Use defaults on error
      setLinkedGroms([]);
      setPendingRequests([]);
    } finally {
      setLoading(false);
    }
  };

  const checkAgeVerification = async () => {
    if (!user?.id) return;
    try {
      const response = await apiClient.get(`/grom-hq/age-verification-status/${user.id}`);
      setAgeVerified(response.data.age_verified || false);
    } catch (error) {
      logger.error('Failed to check age verification:', error);
    }
  };

  const fetchSpendingAlerts = async () => {
    if (!user?.id) return;
    try {
      const response = await apiClient.get(`/grom-hq/spending-alerts/${user.id}?limit=5`);
      setSpendingAlerts(response.data.alerts || []);
    } catch (error) {
      logger.error('Failed to fetch spending alerts:', error);
    }
  };
  
  const fetchActivityFeed = async () => {
    if (!user?.id) return;
    setActivityLoading(true);
    try {
      const response = await apiClient.get(`/grom-hq/family-activity/${user.id}?limit=20`);
      setActivityFeed(response.data.activities || []);
    } catch (error) {
      logger.error('Failed to fetch activity feed:', error);
      setActivityFeed([]);
    } finally {
      setActivityLoading(false);
    }
  };

  const markAlertRead = async (alertId) => {
    try {
      await markAlertRead(alertId);
      setSpendingAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch (error) {
      logger.error('Failed to mark alert read:', error);
    }
  };

  const startAgeVerification = async () => {
    setVerifyingAge(true);
    try {
      const response = await apiClient.post(`/grom-hq/create-age-verification/${user.id}`, {
        return_url: window.location.href
      });
      
      if (response.data.already_verified) {
        setAgeVerified(true);
        toast.success('You are already age verified!');
        return;
      }
      
      // Open Stripe Identity verification
      if (response.data.verification_session_id) {
        const sessionId = response.data.verification_session_id;
        
        toast.info('Opening secure identity verification...');
        
        // Open Stripe hosted verification page
        window.open(
          `https://verify.stripe.com/start/${sessionId}`,
          '_blank'
        );
        
        // Poll for verification completion
        toast.info('Complete the verification in the new window. We\'ll update your status automatically.');
        
        const checkStatus = async () => {
          try {
            const statusResponse = await apiClient.post(
              `/grom-hq/verify-age-complete/${user.id}?verification_session_id=${sessionId}`
            );
            
            if (statusResponse.data.success && statusResponse.data.age_verified) {
              setAgeVerified(true);
              toast.success('Guardian Verified! You can now link and manage Grom accounts.');
              return true;
            } else if (statusResponse.data.status === 'verified') {
              setAgeVerified(true);
              toast.success('Guardian Verified!');
              return true;
            }
            return false;
          } catch (e) {
            return false;
          }
        };
        
        // Poll every 5 seconds for up to 5 minutes
        let attempts = 0;
        const maxAttempts = 60;
        const pollInterval = setInterval(async () => {
          attempts++;
          const verified = await checkStatus();
          if (verified || attempts >= maxAttempts) {
            clearInterval(pollInterval);
            if (!verified && attempts >= maxAttempts) {
              toast.info('Verification check timed out. Click "Verify Age" again if you completed it.');
            }
          }
        }, 5000);
      } else {
        toast.error('Failed to create verification session. Please try again.');
      }
      
    } catch (error) {
      logger.error('Failed to start age verification:', error);
      const errorMessage = error.response?.data?.detail || 'Failed to start age verification';
      toast.error(errorMessage);
    } finally {
      setVerifyingAge(false);
    }
  };

  const handleUnlinkGrom = async () => {
    if (!unlinkingGrom || !unlinkPassword) return;
    
    setUnlinkLoading(true);
    try {
      await apiClient.post(
        `/grom-hq/unlink-grom/${unlinkingGrom.id}?parent_id=${user.id}`,
        { password: unlinkPassword }
      );
      
      toast.success(`Unlinked ${unlinkingGrom.full_name}`);
      setUnlinkModalOpen(false);
      setUnlinkPassword('');
      setUnlinkingGrom(null);
      
      // Refresh data
      fetchGromData();
    } catch (error) {
      if (error.response?.status === 401) {
        toast.error('Incorrect password');
      } else {
        toast.error('Failed to unlink Grom');
      }
    } finally {
      setUnlinkLoading(false);
    }
  };

  const openUnlinkModal = (grom) => {
    setUnlinkingGrom(grom);
    setUnlinkPassword('');
    setUnlinkModalOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${isLight ? 'bg-gray-50' : 'bg-black'} pb-24 md:pb-8`}>
      {/* Header */}
      <div className="bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Grom HQ</h1>
              <p className="text-cyan-100 text-sm">Parental Management Dashboard</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className={`${cardBg} ${borderColor}`}>
            <CardContent className="p-4 text-center">
              <Users className="w-6 h-6 text-cyan-400 mx-auto mb-2" />
              <div className={`text-2xl font-bold ${textPrimary}`}>{linkedGroms.length}</div>
              <div className={`text-xs ${textSecondary}`}>Linked Groms</div>
            </CardContent>
          </Card>
          
          <Card className={`${cardBg} ${borderColor}`}>
            <CardContent className="p-4 text-center">
              <DollarSign className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
              <div className={`text-2xl font-bold ${textPrimary}`}>${stats.totalEarnings?.toFixed(0) || 0}</div>
              <div className={`text-xs ${textSecondary}`}>Total Earnings</div>
            </CardContent>
          </Card>
          
          <Card className={`${cardBg} ${borderColor}`}>
            <CardContent className="p-4 text-center">
              <Clock className="w-6 h-6 text-yellow-400 mx-auto mb-2" />
              <div className={`text-2xl font-bold ${textPrimary}`}>{stats.totalSessions || 0}</div>
              <div className={`text-xs ${textSecondary}`}>Sessions Joined</div>
            </CardContent>
          </Card>
          
          <Card className={`${cardBg} ${borderColor}`}>
            <CardContent className="p-4 text-center">
              <Trophy className="w-6 h-6 text-amber-400 mx-auto mb-2" />
              <div className={`text-2xl font-bold ${textPrimary}`}>{stats.achievementsUnlocked || 0}</div>
              <div className={`text-xs ${textSecondary}`}>Achievements</div>
            </CardContent>
          </Card>
        </div>

        {/* Pending Link Requests */}
        {pendingRequests.length > 0 && (
          <Card className={`${cardBg} border-2 border-yellow-500/50`}>
            <CardHeader className="pb-2">
              <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
                <Bell className="w-5 h-5 text-yellow-400" />
                Pending Link Requests
                <Badge className="ml-auto bg-yellow-500/20 text-yellow-400 border-0">
                  {pendingRequests.length} NEW
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {pendingRequests.map((request) => (
                <div 
                  key={request.id}
                  className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-gray-50' : 'bg-zinc-800'}`}
                >
                  <Avatar className="w-12 h-12 border-2 border-yellow-500/30">
                    <AvatarImage src={getFullUrl(request.avatar_url)} />
                    <AvatarFallback className="bg-yellow-500/20 text-yellow-400">
                      {request.full_name?.[0] || 'G'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className={`font-medium ${textPrimary}`}>{request.full_name}</p>
                    <p className={`text-xs ${textSecondary}`}>Requesting to link as your Grom</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white">
                      <CheckCircle className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="outline" className="border-red-500/50 text-red-400">
                      <XCircle className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Spending Alerts */}
        {spendingAlerts.length > 0 && (
          <Card className={`${cardBg} border-2 border-orange-500/50`} data-testid="spending-alerts-card">
            <CardHeader className="pb-2">
              <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
                <CreditCard className="w-5 h-5 text-orange-400" />
                Spending Alerts
                <Badge className="ml-auto bg-orange-500/20 text-orange-400 border-0">
                  {spendingAlerts.length} ALERT{spendingAlerts.length > 1 ? 'S' : ''}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {spendingAlerts.map((alert) => (
                <div 
                  key={alert.id}
                  className={`flex items-center gap-3 p-3 rounded-xl ${isLight ? 'bg-orange-50' : 'bg-orange-500/10'}`}
                  data-testid={`spending-alert-${alert.id}`}
                >
                  <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center shrink-0">
                    <DollarSign className="w-5 h-5 text-orange-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm ${textPrimary}`}>{alert.title}</p>
                    <p className={`text-xs ${textSecondary} truncate`}>{alert.body}</p>
                    <p className={`text-xs ${textSecondary} mt-1`}>
                      {new Date(alert.created_at).toLocaleDateString()} at {new Date(alert.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </p>
                  </div>
                  <Button 
                    size="sm" 
                    variant="ghost"
                    className="text-orange-400 hover:text-orange-500 shrink-0"
                    onClick={() => markAlertRead(alert.id)}
                  >
                    <XCircle className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Family Activity Feed - Timeline of Grom activities */}
        <Card className={`${cardBg} border-2 border-emerald-500/30`} data-testid="family-activity-feed">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
                <Activity className="w-5 h-5 text-emerald-400" />
                Family Activity
                {activityFeed.length > 0 && (
                  <Badge className="ml-2 bg-emerald-500/20 text-emerald-400 border-0">
                    {activityFeed.length}
                  </Badge>
                )}
              </CardTitle>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setShowActivityFeed(!showActivityFeed)}
                className="text-emerald-400"
              >
                {showActivityFeed ? 'Hide' : 'Show'}
              </Button>
            </div>
          </CardHeader>
          {showActivityFeed && (
            <CardContent className="space-y-3 max-h-[400px] overflow-y-auto">
              {activityLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
                </div>
              ) : activityFeed.length === 0 ? (
                <div className="text-center py-8">
                  <Activity className="w-8 h-8 mx-auto mb-2 text-gray-500" />
                  <p className={`text-sm ${textSecondary}`}>No recent activity from your Groms</p>
                </div>
              ) : (
                activityFeed.map((activity, index) => (
                  <div 
                    key={`${activity.type}-${activity.id}-${index}`}
                    className={`flex items-start gap-3 p-3 rounded-xl ${
                      isLight ? 'bg-gray-50' : 'bg-zinc-800/50'
                    }`}
                  >
                    {/* Activity Icon */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                      activity.type === 'post' ? 'bg-blue-500/20' :
                      activity.type === 'session' ? 'bg-cyan-500/20' :
                      activity.type === 'badge' ? 'bg-yellow-500/20' :
                      'bg-purple-500/20'
                    }`}>
                      <span className="text-lg">{activity.icon}</span>
                    </div>
                    
                    {/* Activity Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Avatar className="w-5 h-5">
                          <AvatarImage src={activity.grom_avatar} />
                          <AvatarFallback className="bg-cyan-500/20 text-cyan-400 text-xs">
                            {activity.grom_name?.[0] || 'G'}
                          </AvatarFallback>
                        </Avatar>
                        <span className={`text-sm font-medium ${textPrimary}`}>
                          {activity.grom_name}
                        </span>
                        <span className={`text-xs ${textSecondary}`}>
                          {activity.created_at ? new Date(activity.created_at).toLocaleDateString() : ''}
                        </span>
                      </div>
                      
                      <p className={`text-sm font-medium ${textPrimary}`}>{activity.title}</p>
                      
                      {activity.content && (
                        <p className={`text-xs ${textSecondary} mt-0.5`}>{activity.content}</p>
                      )}
                      
                      {/* Media preview for posts/highlights */}
                      {activity.media_url && (
                        <div className="mt-2 rounded-lg overflow-hidden max-w-[200px]">
                          {activity.media_type === 'video' ? (
                            <video src={getFullUrl(activity.media_url)} className="w-full h-auto" muted />
                          ) : (
                            <img src={getFullUrl(activity.media_url)} alt="Activity" className="w-full h-auto" />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              
              {activityFeed.length > 0 && (
                <Button 
                  variant="ghost" 
                  className="w-full text-emerald-400 hover:text-emerald-300"
                  onClick={fetchActivityFeed}
                >
                  Refresh
                </Button>
              )}
            </CardContent>
          )}
        </Card>

        {/* Linked Groms */}
        <Card className={`${cardBg} ${borderColor}`}>
          <CardHeader className="pb-2">
            <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
              <ShieldCheck className="w-5 h-5 text-cyan-400" />
              Linked Groms
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {linkedGroms.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
                  <UserPlus className="w-8 h-8 text-gray-500" />
                </div>
                <h3 className={`font-semibold mb-1 ${textPrimary}`}>No Linked Groms</h3>
                <p className={`text-sm mb-4 ${textSecondary}`}>
                  Invite your child to link their Grom account
                </p>
                <Button className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white">
                  <Plus className="w-4 h-4 mr-2" />
                  Send Invite
                </Button>
              </div>
            ) : (
              linkedGroms.map((grom) => (
                <div 
                  key={grom.id}
                  className={`flex flex-col gap-3 p-4 rounded-xl transition-all ${
                    isLight ? 'bg-gray-50' : 'bg-zinc-800'
                  }`}
                  data-testid={`grom-card-${grom.id}`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="w-14 h-14 border-2 border-cyan-500/30">
                      <AvatarImage src={getFullUrl(grom.avatar_url)} />
                      <AvatarFallback className="bg-cyan-500/20 text-cyan-400 text-lg">
                        {grom.full_name?.[0] || 'G'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`font-semibold ${textPrimary}`}>{grom.full_name}</p>
                        <Badge className="bg-cyan-500/20 text-cyan-400 border-0 text-xs">Grom</Badge>
                        {grom.elite_tier === 'grom_rising' && (
                          <Badge className="bg-yellow-500/20 text-yellow-400 border-0 text-xs">
                            <Trophy className="w-3 h-3 mr-1" />
                            Competes
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <span className={`text-xs ${textSecondary}`}>
                          <DollarSign className="w-3 h-3 inline" /> ${grom.credits_balance?.toFixed(0) || 0}
                        </span>
                        <span className={`text-xs ${textSecondary}`}>
                          <Trophy className="w-3 h-3 inline" /> {grom.achievements_count || 0} badges
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        size="sm" 
                        variant="ghost"
                        className="text-gray-400 hover:text-red-400"
                        onClick={(e) => {
                          e.stopPropagation();
                          openUnlinkModal(grom);
                        }}
                      >
                        <Unlink className="w-4 h-4" />
                      </Button>
                      <ChevronRight 
                        className={`w-5 h-5 ${textSecondary} cursor-pointer`}
                        onClick={() => navigate(`/grom-hq/manage/${grom.id}`)}
                      />
                    </div>
                  </div>
                  
                  {/* Competition Status Toggle */}
                  <div className={`flex items-center justify-between p-3 rounded-lg ${isLight ? 'bg-gray-100' : 'bg-zinc-700/50'}`}>
                    <div className="flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-yellow-400" />
                      <span className={`text-sm ${textPrimary}`}>Competition Mode</span>
                    </div>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        const newStatus = grom.elite_tier !== 'grom_rising';
                        try {
                          await apiClient.post(`/grom-hq/toggle-competition/${grom.id}?parent_id=${user.id}`, {
                            competes: newStatus
                          });
                          // Update local state
                          setLinkedGroms(prev => prev.map(g => 
                            g.id === grom.id 
                              ? { ...g, elite_tier: newStatus ? 'grom_rising' : null }
                              : g
                          ));
                          toast.success(newStatus 
                            ? `${grom.full_name} is now a competitive Grom!` 
                            : `${grom.full_name} competition mode disabled`
                          );
                        } catch (err) {
                          toast.error('Failed to update competition status');
                        }
                      }}
                      className={`w-11 h-6 rounded-full transition-colors ${
                        grom.elite_tier === 'grom_rising' ? 'bg-yellow-500' : 'bg-zinc-600'
                      }`}
                      data-testid={`grom-competition-toggle-${grom.id}`}
                    >
                      <div
                        className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${
                          grom.elite_tier === 'grom_rising' ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className={`${cardBg} ${borderColor}`}>
          <CardHeader className="pb-2">
            <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
              <Settings className="w-5 h-5 text-gray-400" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button 
              variant="outline" 
              className={`w-full justify-start h-auto py-4 ${borderColor}`}
              onClick={() => navigate('/grom-hq/invite')}
            >
              <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center mr-3">
                <UserPlus className="w-5 h-5 text-cyan-400" />
              </div>
              <div className="text-left flex-1">
                <div className={`font-semibold ${textPrimary}`}>Invite a Grom</div>
                <div className={`text-xs ${textSecondary}`}>Send a link request to your child</div>
              </div>
              <ArrowRight className="w-5 h-5 text-cyan-400" />
            </Button>
            
            <Button 
              variant="outline" 
              className={`w-full justify-start h-auto py-4 ${borderColor}`}
              onClick={() => navigate('/grom-hq/spending')}
            >
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center mr-3">
                <CreditCard className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="text-left flex-1">
                <div className={`font-semibold ${textPrimary}`}>Spending Controls</div>
                <div className={`text-xs ${textSecondary}`}>Set limits and approve purchases</div>
              </div>
              <ArrowRight className="w-5 h-5 text-emerald-400" />
            </Button>
            
            <Button 
              variant="outline" 
              className={`w-full justify-start h-auto py-4 ${borderColor}`}
              onClick={() => navigate('/grom-hq/activity')}
            >
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center mr-3">
                <Activity className="w-5 h-5 text-yellow-400" />
              </div>
              <div className="text-left flex-1">
                <div className={`font-semibold ${textPrimary}`}>Activity Monitor</div>
                <div className={`text-xs ${textSecondary}`}>View screen time and session history</div>
              </div>
              <ArrowRight className="w-5 h-5 text-yellow-400" />
            </Button>
            
            <Button 
              variant="outline" 
              className={`w-full justify-start h-auto py-4 ${borderColor}`}
              onClick={() => navigate('/grom-hq/safety')}
            >
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center mr-3">
                <ShieldAlert className="w-5 h-5 text-red-400" />
              </div>
              <div className="text-left flex-1">
                <div className={`font-semibold ${textPrimary}`}>Safety Settings</div>
                <div className={`text-xs ${textSecondary}`}>Manage privacy and content filters</div>
              </div>
              <ArrowRight className="w-5 h-5 text-red-400" />
            </Button>
            
            <Button 
              variant="outline" 
              className={`w-full justify-start h-auto py-4 ${borderColor}`}
              onClick={() => navigate('/gear-hub')}
            >
              <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center mr-3">
                <ShoppingBag className="w-5 h-5 text-purple-400" />
              </div>
              <div className="text-left flex-1">
                <div className={`font-semibold ${textPrimary}`}>Gear Hub</div>
                <div className={`text-xs ${textSecondary}`}>Buy gear for your Grom</div>
              </div>
              <ArrowRight className="w-5 h-5 text-purple-400" />
            </Button>
          </CardContent>
        </Card>

        {/* Parent Age Verification Status */}
        <Card className={`${cardBg} border-2 ${ageVerified ? 'border-emerald-500/30' : 'border-yellow-500/30'}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-full ${ageVerified ? 'bg-emerald-500/20' : 'bg-yellow-500/20'} flex items-center justify-center`}>
                {ageVerified ? (
                  <ShieldCheck className="w-6 h-6 text-emerald-400" />
                ) : (
                  <ShieldAlert className="w-6 h-6 text-yellow-400" />
                )}
              </div>
              <div className="flex-1">
                <p className={`font-semibold ${textPrimary}`}>
                  {ageVerified ? 'Guardian Verified' : 'Age Verification Required'}
                </p>
                <p className={`text-xs ${textSecondary}`}>
                  {ageVerified 
                    ? 'Your identity is verified to manage Grom accounts'
                    : 'Verify your age to link Grom accounts'}
                </p>
              </div>
              {ageVerified ? (
                <Badge className="bg-emerald-500/20 text-emerald-400 border-0">
                  <ShieldCheck className="w-3 h-3 mr-1" />
                  GUARDIAN
                </Badge>
              ) : (
                <Button 
                  size="sm"
                  className="bg-yellow-500 hover:bg-yellow-600 text-black"
                  onClick={startAgeVerification}
                  disabled={verifyingAge}
                >
                  {verifyingAge ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>Verify Now</>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Unlink Confirmation Modal */}
      <Dialog open={unlinkModalOpen} onOpenChange={setUnlinkModalOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <UserX className="w-5 h-5 text-red-400" />
              Unlink {unlinkingGrom?.full_name}?
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              This will remove the link between your account and this Grom. 
              They will be locked out of the app until re-linked to a parent.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg">
              <Avatar className="w-10 h-10">
                <AvatarImage src={getFullUrl(unlinkingGrom?.avatar_url)} />
                <AvatarFallback className="bg-cyan-500/20 text-cyan-400">
                  {unlinkingGrom?.full_name?.[0]}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-white font-medium">{unlinkingGrom?.full_name}</p>
                <p className="text-xs text-gray-500">Grom Account</p>
              </div>
            </div>
            
            <div>
              <label className="text-sm text-gray-400 mb-2 block">
                <KeyRound className="w-4 h-4 inline mr-1" />
                Enter your password to confirm
              </label>
              <Input
                type="password"
                placeholder="Your password"
                value={unlinkPassword}
                onChange={(e) => setUnlinkPassword(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-white"
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setUnlinkModalOpen(false)}
              className="border-zinc-700 text-gray-400"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleUnlinkGrom}
              disabled={!unlinkPassword || unlinkLoading}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {unlinkLoading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Unlink className="w-4 h-4 mr-2" />
              )}
              Unlink
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GromHQ;
