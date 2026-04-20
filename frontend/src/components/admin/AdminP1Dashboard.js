import React, { useState, useEffect } from 'react';

import { useAuth } from '../../contexts/AuthContext';

import { useTheme } from '../../contexts/ThemeContext';

import { useLocation } from 'react-router-dom';

import apiClient from '../../lib/apiClient';

import { UserCheck, Eye, AlertTriangle, Search,

  Loader2, ChevronRight, ExternalLink, Instagram, Globe, FileText, Camera, Award, Link2, RefreshCw, Activity, Calendar, DollarSign, MessageSquare,
  Flag, Gavel, Ban, Scale, MapPin, ThumbsUp, ThumbsDown, Users, Copy
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';

import { Button } from '../ui/button';

import { Input } from '../ui/input';

import { Textarea } from '../ui/textarea';

import { Badge } from '../ui/badge';

import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

import { toast } from 'sonner';

import logger from '../../utils/logger';
import { getFullUrl } from '../../utils/media';



// Status badge component
const StatusBadge = ({ status }) => {
  const styles = {
    pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    under_review: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    approved: 'bg-green-500/20 text-green-400 border-green-500/30',
    rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
    more_info_needed: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    open: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    investigating: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    resolved: 'bg-green-500/20 text-green-400 border-green-500/30',
    false_positive: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };
  return (
    <Badge className={`text-xs ${styles[status] || 'bg-zinc-500/20 text-zinc-400'}`}>
      {status?.replace(/_/g, ' ')}
    </Badge>
  );
};

// Severity badge
const SeverityBadge = ({ severity }) => {
  const styles = {
    low: 'bg-gray-500/20 text-gray-400',
    medium: 'bg-yellow-500/20 text-yellow-400',
    high: 'bg-orange-500/20 text-orange-400',
    critical: 'bg-red-500/20 text-red-400 animate-pulse',
  };
  return <Badge className={`text-xs ${styles[severity] || styles.medium}`}>{severity}</Badge>;
};

export const AdminP1Dashboard = () => {
  const { user, startImpersonation: authStartImpersonation, impersonation: authImpersonation, endImpersonation: authEndImpersonation } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  const [activeSubTab, setActiveSubTab] = useState('verification');
  const [loading, setLoading] = useState(true);
  
  // Verification Queue state
  const [verificationQueue, setVerificationQueue] = useState([]);
  const [pendingVerifications, setPendingVerifications] = useState(0);
  const [selectedVerification, setSelectedVerification] = useState(null);
  const [showVerificationDetail, setShowVerificationDetail] = useState(false);
  const [verificationFilter, setVerificationFilter] = useState({ type: 'all' });
  
  // Handle navigation state from notification click
  useEffect(() => {
    if (location.state?.tab) {
      setActiveSubTab(location.state.tab);
    }
  }, [location.state]);
  
  // Auto-open specific application when navigating from notification
  useEffect(() => {
    const applicantId = location.state?.applicantId;
    const verificationRequestId = location.state?.verificationRequestId;
    
    if ((applicantId || verificationRequestId) && verificationQueue.length > 0) {
      const targetApplication = verificationQueue.find(
        v => v.id === verificationRequestId || v.user?.id === applicantId
      );
      if (targetApplication) {
        setSelectedVerification(targetApplication);
        setShowVerificationDetail(true);
        // Clear the state so it doesn't re-open on subsequent renders
        window.history.replaceState({}, document.title);
      }
    }
  }, [location.state?.applicantId, location.state?.verificationRequestId, verificationQueue]);
  
  
  // Impersonation state
  const [impersonationHistory, setImpersonationHistory] = useState([]);
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [activeImpersonation, setActiveImpersonation] = useState(authImpersonation);
  const [impersonationReason, setImpersonationReason] = useState('');
  
  // Fraud Detection state
  const [fraudAlerts, setFraudAlerts] = useState([]);
  const [severityCounts, setSeverityCounts] = useState({});
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [showAlertDetail, setShowAlertDetail] = useState(false);
  const [fraudFilter, setFraudFilter] = useState({ severity: 'all' });
  
  // User Journey state
  const [journeyUser, setJourneyUser] = useState(null);
  const [journeyActivities, setJourneyActivities] = useState([]);
  const [journeySummary, setJourneySummary] = useState(null);
  
  // Compliance (ToS Violations) state
  const [complianceStats, setComplianceStats] = useState(null);
  const [recentViolations, setRecentViolations] = useState([]);
  const [pendingAppeals, setPendingAppeals] = useState([]);
  const [selectedViolation, setSelectedViolation] = useState(null);
  const [showViolationDetail, setShowViolationDetail] = useState(false);
  const [appealNotes, setAppealNotes] = useState('');
  const [complianceFilter, setComplianceFilter] = useState({ type: 'all' });
  const [locationFraudMapData, setLocationFraudMapData] = useState([]);
  const [selectedAppeals, setSelectedAppeals] = useState(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  
  // Test Accounts state
  const [testAccounts, setTestAccounts] = useState([]);
  const [seedingAccounts, setSeedingAccounts] = useState(false);
  const [testAccountPassword, setTestAccountPassword] = useState('Test123!');
  
  // Form states
  const [reviewStatus, setReviewStatus] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';

  useEffect(() => {
    if (user?.id) {
      if (activeSubTab === 'verification') fetchVerificationQueue();
      else if (activeSubTab === 'impersonation') fetchImpersonationHistory();
      else if (activeSubTab === 'fraud') fetchFraudAlerts();
      else if (activeSubTab === 'compliance') fetchComplianceData();
      else if (activeSubTab === 'test_accounts') fetchTestAccounts();
    }
  }, [user?.id, activeSubTab, verificationFilter, fraudFilter, complianceFilter]);

  const fetchVerificationQueue = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ admin_id: user.id });
      if (verificationFilter.type && verificationFilter.type !== 'all') {
        params.append('verification_type', verificationFilter.type);
      }
      
      const response = await apiClient.get(`/admin/verification/queue?${params}`);
      setVerificationQueue(response.data.requests || []);
      setPendingVerifications(response.data.pending_count || 0);
    } catch (error) {
      toast.error('Failed to load verification queue');
    } finally {
      setLoading(false);
    }
  };

  const fetchImpersonationHistory = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/admin/impersonate/history`);
      setImpersonationHistory(response.data || []);
    } catch (error) {
      toast.error('Failed to load impersonation history');
    } finally {
      setLoading(false);
    }
  };

  const fetchFraudAlerts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ admin_id: user.id });
      if (fraudFilter.severity && fraudFilter.severity !== 'all') {
        params.append('severity', fraudFilter.severity);
      }
      
      const response = await apiClient.get(`/admin/fraud/alerts?${params}`);
      setFraudAlerts(response.data.alerts || []);
      setSeverityCounts(response.data.severity_counts || {});
    } catch (error) {
      toast.error('Failed to load fraud alerts');
    } finally {
      setLoading(false);
    }
  };

  const fetchComplianceData = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/compliance/dashboard`);
      setComplianceStats(response.data.stats);
      setRecentViolations(response.data.recent_violations || []);
      setLocationFraudMapData(response.data.location_fraud_map_data || []);
      
      // Filter for pending appeals
      const appeals = response.data.recent_violations?.filter(v => v.appeal_status === 'pending') || [];
      setPendingAppeals(appeals);
      setSelectedAppeals(new Set()); // Reset selection
    } catch (error) {
      logger.error('Failed to load compliance data:', error);
      toast.error('Failed to load compliance data');
    } finally {
      setLoading(false);
    }
  };

  const handleReviewAppeal = async (violationId, approved) => {
    setActionLoading(true);
    try {
      await apiClient.put(`/compliance/violations/${violationId}/appeal/review`, {
        approved,
        notes: appealNotes
      });
      toast.success(approved ? 'Appeal approved - strike removed' : 'Appeal denied');
      setShowViolationDetail(false);
      setAppealNotes('');
      fetchComplianceData();
    } catch (error) {
      toast.error('Failed to review appeal');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkReviewAppeals = async (approved) => {
    if (selectedAppeals.size === 0) {
      toast.error('No appeals selected');
      return;
    }
    
    setBulkProcessing(true);
    try {
      const response = await apiClient.post(
        `/compliance/violations/bulk-review-appeals`,
        {
          violation_ids: Array.from(selectedAppeals),
          approved,
          notes: `Bulk ${approved ? 'approved' : 'denied'} by admin`
        }
      );
      
      toast.success(`${response.data.processed} appeals ${approved ? 'approved' : 'denied'}`);
      setSelectedAppeals(new Set());
      fetchComplianceData();
    } catch (error) {
      toast.error('Failed to process bulk appeals');
    } finally {
      setBulkProcessing(false);
    }
  };

  const toggleAppealSelection = (violationId) => {
    setSelectedAppeals(prev => {
      const next = new Set(prev);
      if (next.has(violationId)) {
        next.delete(violationId);
      } else {
        next.add(violationId);
      }
      return next;
    });
  };

  const selectAllAppeals = () => {
    if (selectedAppeals.size === pendingAppeals.length) {
      setSelectedAppeals(new Set());
    } else {
      setSelectedAppeals(new Set(pendingAppeals.map(a => a.id)));
    }
  };

  // ============ TEST ACCOUNTS ============
  
  const fetchTestAccounts = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/admin/test-accounts`);
      setTestAccounts(response.data.accounts || []);
    } catch (error) {
      toast.error('Failed to load test accounts');
    } finally {
      setLoading(false);
    }
  };

  const seedAllRoleAccounts = async () => {
    setSeedingAccounts(true);
    try {
      const response = await apiClient.post(`/admin/seed-test-accounts`, {
        seed_all_roles: true,
        password: testAccountPassword
      });
      toast.success(response.data.message);
      fetchTestAccounts();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to seed test accounts');
    } finally {
      setSeedingAccounts(false);
    }
  };

  const cleanupOldTestAccounts = async () => {
    setActionLoading(true);
    try {
      const response = await apiClient.delete(`/admin/test-accounts/cleanup?older_than_days=7`);
      toast.success(response.data.message);
      fetchTestAccounts();
    } catch (error) {
      toast.error('Failed to cleanup test accounts');
    } finally {
      setActionLoading(false);
    }
  };

  const copyCredentials = (account) => {
    const text = `Email: ${account.email}\nPassword: ${testAccountPassword}\nRole: ${account.role}`;
    navigator.clipboard.writeText(text);
    toast.success('Credentials copied to clipboard');
  };

  const searchUsers = async (query) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const response = await apiClient.get(`/admin/users/search?q=${query}&limit=10`);
      setSearchResults(response.data.users || []);
    } catch (error) {
      logger.error('Search failed:', error);
    }
  };

  const handleReviewVerification = async (requestId) => {
    if (!reviewStatus) {
      toast.error('Please select a status');
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.put(`/admin/verification/${requestId}/review`, {
        status: reviewStatus,
        admin_notes: adminNotes,
        rejection_reason: rejectionReason
      });
      toast.success(`Verification ${reviewStatus}`);
      setShowVerificationDetail(false);
      setReviewStatus('');
      setAdminNotes('');
      setRejectionReason('');
      fetchVerificationQueue();
    } catch (error) {
      toast.error('Failed to review verification');
    } finally {
      setActionLoading(false);
    }
  };

  const startImpersonation = async (targetUserId) => {
    setActionLoading(true);
    try {
      const response = await apiClient.post(`/admin/impersonate/start`, {
        target_user_id: targetUserId,
        reason: impersonationReason,
        is_read_only: true
      });
      
      // Use AuthContext to switch user view
      authStartImpersonation(response.data);
      setActiveImpersonation(response.data);
      
      toast.success(`Now viewing as ${response.data.target_user.full_name || response.data.target_user.email}`);
      setSearchUserQuery('');
      setSearchResults([]);
      setImpersonationReason('');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to start impersonation');
    } finally {
      setActionLoading(false);
    }
  };

  const endImpersonation = async () => {
    if (!activeImpersonation && !authImpersonation) return;
    setActionLoading(true);
    try {
      // Use AuthContext to restore admin view
      await authEndImpersonation();
      setActiveImpersonation(null);
      toast.success('Impersonation ended - restored admin view');
      fetchImpersonationHistory();
    } catch (error) {
      toast.error('Failed to end impersonation');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResolveFraudAlert = async (alertId) => {
    if (!actionTaken) {
      toast.error('Please select an action');
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.put(`/admin/fraud/alerts/${alertId}/resolve`, {
        resolution_notes: resolutionNotes,
        action_taken: actionTaken
      });
      toast.success('Alert resolved');
      setShowAlertDetail(false);
      setResolutionNotes('');
      setActionTaken('');
      fetchFraudAlerts();
    } catch (error) {
      toast.error('Failed to resolve alert');
    } finally {
      setActionLoading(false);
    }
  };

  const fetchUserJourney = async (userId) => {
    setLoading(true);
    try {
      const [summaryRes, activitiesRes] = await Promise.all([
        apiClient.get(`/admin/user-journey/${userId}/summary`),
        apiClient.get(`/admin/user-journey/${userId}?limit=50`)
      ]);
      setJourneySummary(summaryRes.data);
      setJourneyUser(summaryRes.data.user);
      setJourneyActivities(activitiesRes.data.activities || []);
    } catch (error) {
      toast.error('Failed to load user journey');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-4" data-testid="admin-p1-dashboard">
      {/* Sub-tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
          { id: 'verification', label: 'Verification Queue', icon: UserCheck, count: pendingVerifications },
          { id: 'impersonation', label: 'Impersonation', icon: Eye },
          { id: 'fraud', label: 'Fraud Detection', icon: AlertTriangle, count: severityCounts.critical || 0 },
          { id: 'compliance', label: 'Compliance', icon: Gavel, count: complianceStats?.pending_appeals || 0 },
          { id: 'journey', label: 'User Journey', icon: Activity },
          { id: 'test_accounts', label: 'Test Accounts', icon: Users },
        ].map(tab => (
          <Button
            key={tab.id}
            variant={activeSubTab === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveSubTab(tab.id)}
            className={activeSubTab === tab.id ? 'bg-purple-500 hover:bg-purple-600' : ''}
            data-testid={`p1-tab-${tab.id}`}
          >
            <tab.icon className="w-4 h-4 mr-1.5" />
            {tab.label}
            {tab.count > 0 && (
              <Badge className="ml-1.5 bg-white/20 text-white">{tab.count}</Badge>
            )}
          </Button>
        ))}
      </div>

      {/* Active Impersonation Banner */}
      {activeImpersonation && (
        <Card className="bg-purple-500/20 border-purple-500/50">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Eye className="w-5 h-5 text-purple-400" />
              <div>
                <p className="text-white font-medium">
                  Viewing as: {activeImpersonation.target_user.full_name}
                </p>
                <p className="text-purple-300 text-xs">
                  {activeImpersonation.target_user.email} • {activeImpersonation.is_read_only ? 'Read-only' : 'Full access'}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={endImpersonation}
              disabled={actionLoading}
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'End Session'}
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && activeSubTab !== 'journey' ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* VERIFICATION QUEUE TAB */}
          {activeSubTab === 'verification' && (
            <div className="space-y-3">
              {/* Filters */}
              <div className="flex gap-2">
                <Select value={verificationFilter.type} onValueChange={(v) => setVerificationFilter({ type: v })}>
                  <SelectTrigger className="w-48 bg-zinc-800 border-zinc-700">
                    <SelectValue placeholder="Verification Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="pro_surfer">Pro Surfer (WSL)</SelectItem>
                    <SelectItem value="approved_pro_photographer">Approved Pro Photographer</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={fetchVerificationQueue}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>

              {/* Verification List */}
              {verificationQueue.length === 0 ? (
                <Card className={cardBgClass}>
                  <CardContent className="py-12 text-center">
                    <UserCheck className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                    <p className={textSecondary}>No pending verification requests</p>
                  </CardContent>
                </Card>
              ) : (
                verificationQueue.map(req => (
                  <Card 
                    key={req.id} 
                    className={`${cardBgClass} cursor-pointer hover:border-purple-500/50 transition-colors`}
                    onClick={() => { setSelectedVerification(req); setShowVerificationDetail(true); }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <Avatar className="w-12 h-12">
                          <AvatarImage src={getFullUrl(req.user?.avatar_url)} />
                          <AvatarFallback>{req.user?.full_name?.[0]}</AvatarFallback>
                        </Avatar>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className={`font-medium ${textClass}`}>{req.user?.full_name}</p>
                            <StatusBadge status={req.status} />
                          </div>
                          <p className={`text-sm ${textSecondary}`}>{req.user?.email}</p>
                          
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="outline" className={`text-xs ${
                              req.verification_type === 'pro_surfer' 
                                ? 'border-cyan-500 text-cyan-400' 
                                : 'border-purple-500 text-purple-400'
                            }`}>
                              {req.verification_type === 'pro_surfer' ? (
                                <><Award className="w-3 h-3 mr-1" /> Pro Surfer (WSL)</>
                              ) : (
                                <><Camera className="w-3 h-3 mr-1" /> Approved Pro Photographer</>
                              )}
                            </Badge>
                          </div>
                          
                          {/* Quick preview of verification data */}
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            {req.wsl_profile_url && (
                              <a 
                                href={req.wsl_profile_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1 text-cyan-400 hover:underline"
                              >
                                <Globe className="w-3 h-3" /> WSL Profile
                              </a>
                            )}
                            {req.instagram_url && (
                              <a 
                                href={req.instagram_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1 text-pink-400 hover:underline"
                              >
                                <Instagram className="w-3 h-3" /> Instagram
                              </a>
                            )}
                            {req.portfolio_website && (
                              <a 
                                href={req.portfolio_website} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1 text-blue-400 hover:underline"
                              >
                                <Globe className="w-3 h-3" /> Portfolio
                              </a>
                            )}
                          </div>
                        </div>
                        
                        <div className="text-right shrink-0">
                          <p className={`text-xs ${textSecondary}`}>{formatDate(req.created_at)}</p>
                          <ChevronRight className="w-5 h-5 text-gray-500 mt-2" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* IMPERSONATION TAB */}
          {activeSubTab === 'impersonation' && (
            <div className="space-y-4">
              {/* Search User */}
              <Card className={cardBgClass}>
                <CardHeader className="pb-2">
                  <CardTitle className={`text-sm ${textClass}`}>
                    <Eye className="w-4 h-4 inline mr-2" />
                    Start Impersonation Session
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <Input
                      placeholder="Search user by name or email..."
                      value={searchUserQuery}
                      onChange={(e) => {
                        setSearchUserQuery(e.target.value);
                        searchUsers(e.target.value);
                      }}
                      className="pl-10 bg-zinc-800 border-zinc-700"
                    />
                  </div>
                  
                  <Input
                    placeholder="Reason for impersonation (optional)"
                    value={impersonationReason}
                    onChange={(e) => setImpersonationReason(e.target.value)}
                    className="bg-zinc-800 border-zinc-700"
                  />
                  
                  {/* Search Results */}
                  {searchResults.length > 0 && (
                    <div className="bg-zinc-800 rounded-lg divide-y divide-zinc-700 max-h-60 overflow-y-auto">
                      {searchResults.map(u => (
                        <div 
                          key={u.id}
                          className="p-3 flex items-center justify-between hover:bg-zinc-700 cursor-pointer"
                          onClick={() => startImpersonation(u.id)}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8">
                              <AvatarImage src={getFullUrl(u.avatar_url)} />
                              <AvatarFallback>{u.full_name?.[0]}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-white text-sm">{u.full_name}</p>
                              <p className="text-gray-400 text-xs">{u.email}</p>
                            </div>
                          </div>
                          <Button size="sm" className="bg-purple-500 hover:bg-purple-600">
                            <Eye className="w-3 h-3 mr-1" /> View As
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Impersonation History */}
              <Card className={cardBgClass}>
                <CardHeader className="pb-2">
                  <CardTitle className={`text-sm ${textClass}`}>Recent Impersonation Sessions</CardTitle>
                </CardHeader>
                <CardContent>
                  {impersonationHistory.length === 0 ? (
                    <p className={`text-sm ${textSecondary} text-center py-4`}>No impersonation history</p>
                  ) : (
                    <div className="space-y-2">
                      {impersonationHistory.map(session => (
                        <div key={session.id} className="p-2 bg-zinc-800 rounded-lg flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8">
                              <AvatarFallback>{session.target_user?.full_name?.[0]}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-white text-sm">{session.target_user?.full_name}</p>
                              <p className="text-gray-400 text-xs">
                                {session.reason || 'No reason provided'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-gray-400">{formatDate(session.started_at)}</p>
                            <p className="text-xs text-gray-500">
                              {session.duration_minutes ? `${Math.round(session.duration_minutes)} min` : 'Active'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* FRAUD DETECTION TAB */}
          {activeSubTab === 'fraud' && (
            <div className="space-y-3">
              {/* Severity Summary */}
              <div className="grid grid-cols-4 gap-2">
                {['critical', 'high', 'medium', 'low'].map(severity => (
                  <Card key={severity} className={`${cardBgClass} ${
                    severity === 'critical' ? 'border-red-500/50' :
                    severity === 'high' ? 'border-orange-500/50' :
                    severity === 'medium' ? 'border-yellow-500/50' : ''
                  }`}>
                    <CardContent className="p-3 text-center">
                      <p className="text-2xl font-bold text-white">{severityCounts[severity] || 0}</p>
                      <p className={`text-xs capitalize ${textSecondary}`}>{severity}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Filters */}
              <div className="flex gap-2">
                <Select value={fraudFilter.severity} onValueChange={(v) => setFraudFilter({ severity: v })}>
                  <SelectTrigger className="w-40 bg-zinc-800 border-zinc-700">
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severity</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Alerts List */}
              {fraudAlerts.length === 0 ? (
                <Card className={cardBgClass}>
                  <CardContent className="py-12 text-center">
                    <AlertTriangle className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                    <p className={textSecondary}>No active fraud alerts</p>
                  </CardContent>
                </Card>
              ) : (
                fraudAlerts.map(alert => (
                  <Card 
                    key={alert.id} 
                    className={`${cardBgClass} cursor-pointer hover:border-red-500/50 transition-colors ${
                      alert.severity === 'critical' ? 'border-red-500/30' : ''
                    }`}
                    onClick={() => { setSelectedAlert(alert); setShowAlertDetail(true); }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <SeverityBadge severity={alert.severity} />
                            <StatusBadge status={alert.status} />
                            <Badge variant="outline" className="text-xs capitalize">
                              {alert.alert_type?.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          <p className={`font-medium ${textClass}`}>{alert.title}</p>
                          <p className={`text-sm ${textSecondary} line-clamp-2 mt-1`}>{alert.description}</p>
                          
                          <div className="flex items-center gap-2 mt-2">
                            <Avatar className="w-5 h-5">
                              <AvatarImage src={getFullUrl(alert.user?.avatar_url)} />
                              <AvatarFallback className="text-xs">{alert.user?.full_name?.[0]}</AvatarFallback>
                            </Avatar>
                            <span className={`text-xs ${textSecondary}`}>{alert.user?.full_name}</span>
                          </div>
                        </div>
                        
                        <div className="text-right shrink-0">
                          <div className="flex items-center gap-1 mb-1">
                            <span className="text-xs text-gray-500">Risk Score:</span>
                            <span className={`font-bold ${
                              alert.risk_score >= 80 ? 'text-red-400' :
                              alert.risk_score >= 50 ? 'text-orange-400' :
                              'text-yellow-400'
                            }`}>{alert.risk_score}</span>
                          </div>
                          <p className={`text-xs ${textSecondary}`}>{formatDate(alert.created_at)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* COMPLIANCE (TOS VIOLATIONS) TAB */}
          {activeSubTab === 'compliance' && (
            <div className="space-y-4" data-testid="compliance-tab">
              {/* Stats Cards */}
              {complianceStats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card className={`${cardBgClass} border`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-yellow-500/20">
                          <AlertTriangle className="w-5 h-5 text-yellow-400" />
                        </div>
                        <div>
                          <p className={`text-2xl font-bold ${textClass}`}>{complianceStats.total_violations}</p>
                          <p className={`text-xs ${textSecondary}`}>Total Violations</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className={`${cardBgClass} border`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-red-500/20">
                          <MapPin className="w-5 h-5 text-red-400" />
                        </div>
                        <div>
                          <p className={`text-2xl font-bold ${textClass}`}>{complianceStats.location_fraud_count}</p>
                          <p className={`text-xs ${textSecondary}`}>Location Fraud</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className={`${cardBgClass} border`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-orange-500/20">
                          <Scale className="w-5 h-5 text-orange-400" />
                        </div>
                        <div>
                          <p className={`text-2xl font-bold ${textClass}`}>{complianceStats.pending_appeals}</p>
                          <p className={`text-xs ${textSecondary}`}>Pending Appeals</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card className={`${cardBgClass} border`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-purple-500/20">
                          <Ban className="w-5 h-5 text-purple-400" />
                        </div>
                        <div>
                          <p className={`text-2xl font-bold ${textClass}`}>{complianceStats.suspended_users + complianceStats.banned_users}</p>
                          <p className={`text-xs ${textSecondary}`}>Suspended/Banned</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Week Summary */}
              {complianceStats && (
                <Card className={`${cardBgClass} border border-blue-500/30`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Calendar className="w-5 h-5 text-blue-400" />
                        <span className={textClass}>This Week: <strong>{complianceStats.violations_this_week}</strong> new violations</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={fetchComplianceData}
                        className="gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Refresh
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Location Fraud Map Visualization */}
              {locationFraudMapData.length > 0 && (
                <Card className={`${cardBgClass} border border-red-500/30`}>
                  <CardHeader className="pb-2">
                    <CardTitle className={`text-sm ${textClass} flex items-center gap-2`}>
                      <MapPin className="w-4 h-4 text-red-400" />
                      Location Fraud Map ({locationFraudMapData.length} incidents)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {/* Legend */}
                      <div className="flex gap-4 text-xs">
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                          <span className={textSecondary}>Claimed Location</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-red-500"></div>
                          <span className={textSecondary}>Actual Location</span>
                        </div>
                      </div>
                      
                      {/* Fraud Incidents List */}
                      <div className="max-h-60 overflow-y-auto space-y-2">
                        {locationFraudMapData.map((fraud, _idx) => (
                          <div 
                            key={fraud.id}
                            className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <Badge className={`text-[10px] ${
                                fraud.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                                fraud.severity === 'severe' ? 'bg-orange-500/20 text-orange-400' :
                                'bg-yellow-500/20 text-yellow-400'
                              }`}>
                                {fraud.severity} • {fraud.distance_miles?.toFixed(1)} mi
                              </Badge>
                              <span className={`text-[10px] ${textSecondary}`}>
                                {formatDate(fraud.created_at)}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                <span className={textSecondary}>
                                  Claimed: {fraud.claimed[0]?.toFixed(4)}, {fraud.claimed[1]?.toFixed(4)}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full bg-red-500"></div>
                                <span className={textSecondary}>
                                  Actual: {fraud.actual[0]?.toFixed(4)}, {fraud.actual[1]?.toFixed(4)}
                                </span>
                              </div>
                            </div>
                            {/* Visual Distance Bar */}
                            <div className="mt-2 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                              <div 
                                className={`h-full ${
                                  fraud.distance_miles > 50 ? 'bg-red-500' :
                                  fraud.distance_miles > 10 ? 'bg-orange-500' :
                                  'bg-yellow-500'
                                }`}
                                style={{ width: `${Math.min((fraud.distance_miles / 100) * 100, 100)}%` }}
                              ></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Pending Appeals Section with Bulk Actions */}
              {pendingAppeals.length > 0 && (
                <Card className={`${cardBgClass} border border-orange-500/30`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className={`text-sm ${textClass} flex items-center gap-2`}>
                        <Scale className="w-4 h-4 text-orange-400" />
                        Pending Appeals ({pendingAppeals.length})
                      </CardTitle>
                      
                      {/* Bulk Actions */}
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={selectAllAppeals}
                          className="h-7 text-xs"
                        >
                          {selectedAppeals.size === pendingAppeals.length ? 'Deselect All' : 'Select All'}
                        </Button>
                        
                        {selectedAppeals.size > 0 && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleBulkReviewAppeals(true)}
                              disabled={bulkProcessing}
                              className="h-7 text-xs border-green-500 text-green-400 hover:bg-green-500/20"
                            >
                              {bulkProcessing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ThumbsUp className="w-3 h-3 mr-1" />}
                              Approve ({selectedAppeals.size})
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleBulkReviewAppeals(false)}
                              disabled={bulkProcessing}
                              className="h-7 text-xs border-red-500 text-red-400 hover:bg-red-500/20"
                            >
                              {bulkProcessing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ThumbsDown className="w-3 h-3 mr-1" />}
                              Deny ({selectedAppeals.size})
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {pendingAppeals.map(violation => (
                      <div
                        key={violation.id}
                        className={`p-3 rounded-lg border transition-colors ${
                          selectedAppeals.has(violation.id) 
                            ? 'bg-orange-500/20 border-orange-500' 
                            : 'bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20'
                        }`}
                        data-testid={`appeal-${violation.id}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={selectedAppeals.has(violation.id)}
                              onChange={() => toggleAppealSelection(violation.id)}
                              className="w-4 h-4 rounded border-orange-500 bg-zinc-800 text-orange-500 focus:ring-orange-500"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div 
                              className="cursor-pointer"
                              onClick={() => {
                                setSelectedViolation(violation);
                                setShowViolationDetail(true);
                              }}
                            >
                              <p className={`font-medium ${textClass}`}>{violation.title}</p>
                              <p className={`text-xs ${textSecondary}`}>
                                {violation.violation_type.replace(/_/g, ' ')} • User: {violation.user_id.slice(0, 8)}...
                              </p>
                            </div>
                          </div>
                          <Badge className="bg-orange-500/20 text-orange-400">Appeal Pending</Badge>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Recent Violations List */}
              <Card className={cardBgClass}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className={`text-sm ${textClass}`}>
                      <Flag className="w-4 h-4 inline mr-2" />
                      Recent Violations
                    </CardTitle>
                    <Select value={complianceFilter.type} onValueChange={(v) => setComplianceFilter({ type: v })}>
                      <SelectTrigger className="w-[140px] h-8 bg-zinc-800 border-zinc-700">
                        <SelectValue placeholder="Filter" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="location_fraud">Location Fraud</SelectItem>
                        <SelectItem value="harassment">Harassment</SelectItem>
                        <SelectItem value="scam">Scam</SelectItem>
                        <SelectItem value="spam">Spam</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {recentViolations.length === 0 ? (
                    <p className={`text-center py-8 ${textSecondary}`}>No violations recorded</p>
                  ) : (
                    recentViolations
                      .filter(v => complianceFilter.type === 'all' || v.violation_type === complianceFilter.type)
                      .map(violation => (
                        <div
                          key={violation.id}
                          className={`p-3 rounded-lg ${cardBgClass} border cursor-pointer hover:bg-zinc-800/50 transition-colors`}
                          onClick={() => {
                            setSelectedViolation(violation);
                            setShowViolationDetail(true);
                          }}
                          data-testid={`violation-${violation.id}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`p-1.5 rounded-full ${
                                violation.severity === 'critical' ? 'bg-red-500/20' :
                                violation.severity === 'severe' ? 'bg-orange-500/20' :
                                violation.severity === 'moderate' ? 'bg-yellow-500/20' :
                                'bg-gray-500/20'
                              }`}>
                                {violation.violation_type === 'location_fraud' ? (
                                  <MapPin className={`w-4 h-4 ${
                                    violation.severity === 'critical' ? 'text-red-400' :
                                    violation.severity === 'severe' ? 'text-orange-400' :
                                    'text-yellow-400'
                                  }`} />
                                ) : (
                                  <Flag className="w-4 h-4 text-gray-400" />
                                )}
                              </div>
                              <div>
                                <p className={`font-medium ${textClass}`}>{violation.title}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <Badge className={`text-[10px] ${
                                    violation.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                                    violation.severity === 'severe' ? 'bg-orange-500/20 text-orange-400' :
                                    violation.severity === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' :
                                    'bg-gray-500/20 text-gray-400'
                                  }`}>
                                    {violation.severity}
                                  </Badge>
                                  <span className={`text-xs ${textSecondary}`}>
                                    {violation.action_taken.replace(/_/g, ' ')}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`text-xs ${textSecondary}`}>{formatDate(violation.created_at)}</p>
                              {violation.appeal_status && (
                                <Badge className={`mt-1 text-[10px] ${
                                  violation.appeal_status === 'pending' ? 'bg-orange-500/20 text-orange-400' :
                                  violation.appeal_status === 'approved' ? 'bg-green-500/20 text-green-400' :
                                  'bg-red-500/20 text-red-400'
                                }`}>
                                  Appeal: {violation.appeal_status}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* USER JOURNEY TAB */}
          {activeSubTab === 'journey' && (
            <div className="space-y-4">
              {/* Search User */}
              <Card className={cardBgClass}>
                <CardHeader className="pb-2">
                  <CardTitle className={`text-sm ${textClass}`}>
                    <Activity className="w-4 h-4 inline mr-2" />
                    View User Journey
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <Input
                      placeholder="Search user by name or email..."
                      value={searchUserQuery}
                      onChange={(e) => {
                        setSearchUserQuery(e.target.value);
                        searchUsers(e.target.value);
                      }}
                      className="pl-10 bg-zinc-800 border-zinc-700"
                    />
                  </div>
                  
                  {/* Search Results */}
                  {searchResults.length > 0 && !journeyUser && (
                    <div className="mt-2 bg-zinc-800 rounded-lg divide-y divide-zinc-700 max-h-40 overflow-y-auto">
                      {searchResults.map(u => (
                        <div 
                          key={u.id}
                          className="p-3 flex items-center justify-between hover:bg-zinc-700 cursor-pointer"
                          onClick={() => { fetchUserJourney(u.id); setSearchResults([]); }}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8">
                              <AvatarImage src={getFullUrl(u.avatar_url)} />
                              <AvatarFallback>{u.full_name?.[0]}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-white text-sm">{u.full_name}</p>
                              <p className="text-gray-400 text-xs">{u.email}</p>
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-500" />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* User Journey Display */}
              {journeyUser && journeySummary && (
                <>
                  {/* User Summary */}
                  <Card className={cardBgClass}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <Avatar className="w-16 h-16">
                          <AvatarImage src={getFullUrl(journeyUser.avatar_url)} />
                          <AvatarFallback className="text-xl">{journeyUser.full_name?.[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className={`text-lg font-bold ${textClass}`}>{journeyUser.full_name}</p>
                            {journeyUser.is_suspended && (
                              <Badge className="bg-red-500/20 text-red-400">Suspended</Badge>
                            )}
                          </div>
                          <p className={textSecondary}>{journeyUser.email}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline">{journeyUser.role || 'User'}</Badge>
                            <span className={`text-xs ${textSecondary}`}>
                              Joined {formatDate(journeyUser.created_at)}
                            </span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setJourneyUser(null); setJourneySummary(null); }}
                        >
                          Clear
                        </Button>
                      </div>
                      
                      {/* Stats Grid */}
                      <div className="grid grid-cols-5 gap-2 mt-4">
                        {[
                          { label: 'Posts', value: journeySummary.stats?.posts || 0, icon: FileText },
                          { label: 'Bookings', value: journeySummary.stats?.bookings || 0, icon: Calendar },
                          { label: 'Transactions', value: journeySummary.stats?.transactions || 0, icon: DollarSign },
                          { label: 'Disputes', value: journeySummary.stats?.disputes || 0, icon: MessageSquare },
                          { label: 'Reports', value: journeySummary.stats?.reports_against || 0, icon: Flag },
                        ].map(stat => (
                          <div key={stat.label} className="p-2 bg-zinc-800 rounded-lg text-center">
                            <stat.icon className="w-4 h-4 mx-auto text-gray-500 mb-1" />
                            <p className="text-lg font-bold text-white">{stat.value}</p>
                            <p className="text-xs text-gray-400">{stat.label}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Activity Timeline */}
                  <Card className={cardBgClass}>
                    <CardHeader className="pb-2">
                      <CardTitle className={`text-sm ${textClass}`}>Activity Timeline</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {loading ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                        </div>
                      ) : journeyActivities.length === 0 ? (
                        <p className={`text-sm ${textSecondary} text-center py-4`}>No activity recorded</p>
                      ) : (
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                          {journeyActivities.map((activity, _idx) => (
                            <div key={activity.id} className="flex gap-3 p-2 hover:bg-zinc-800 rounded-lg">
                              <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                                <Activity className="w-4 h-4 text-gray-500" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm ${textClass}`}>{activity.description}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="outline" className="text-xs capitalize">
                                    {activity.activity_category}
                                  </Badge>
                                  <span className={`text-xs ${textSecondary}`}>
                                    {formatDate(activity.created_at)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          )}

          {/* TEST ACCOUNTS TAB */}
          {activeSubTab === 'test_accounts' && (
            <div className="space-y-4">
              {/* Seed Accounts Card */}
              <Card className={cardBgClass}>
                <CardHeader>
                  <CardTitle className={`flex items-center gap-2 ${textClass}`}>
                    <Users className="w-5 h-5 text-green-400" />
                    Seed Test Accounts
                  </CardTitle>
                  <p className={`text-sm ${textSecondary}`}>
                    Create test accounts for QA testing. All accounts use @test.rawsurf.io email domain.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <label className={`text-xs ${textSecondary}`}>Password for new accounts</label>
                      <Input
                        value={testAccountPassword}
                        onChange={(e) => setTestAccountPassword(e.target.value)}
                        className="bg-zinc-800 border-zinc-700"
                        placeholder="Test123!"
                      />
                    </div>
                    <Button
                      onClick={seedAllRoleAccounts}
                      disabled={seedingAccounts}
                      className="bg-green-500 hover:bg-green-600 text-white"
                      data-testid="seed-all-roles-btn"
                    >
                      {seedingAccounts ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Seed All Roles
                    </Button>
                    <Button
                      onClick={cleanupOldTestAccounts}
                      disabled={actionLoading}
                      variant="outline"
                      className="border-red-500/50 text-red-400 hover:bg-red-500/10"
                      data-testid="cleanup-test-accounts-btn"
                    >
                      Cleanup Old (&gt;7 days)
                    </Button>
                  </div>
                  
                  <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <p className={`text-sm ${textClass}`}>
                      <strong>Seed All Roles</strong> creates one account for each role type:
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {['Surfer', 'Photographer', 'Approved Pro', 'Grom', 'GromParent', 'Competitive Surfer'].map(role => (
                        <Badge key={role} variant="outline" className="text-green-400 border-green-500/50">
                          {role}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Existing Test Accounts */}
              <Card className={cardBgClass}>
                <CardHeader>
                  <CardTitle className={`flex items-center gap-2 ${textClass}`}>
                    <Users className="w-5 h-5 text-blue-400" />
                    Existing Test Accounts
                    <Badge className="ml-2 bg-blue-500/20 text-blue-400">{testAccounts.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {testAccounts.length === 0 ? (
                    <p className={`text-center py-8 ${textSecondary}`}>
                      No test accounts found. Click "Seed All Roles" to create test accounts.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {testAccounts.map(account => (
                        <div 
                          key={account.id}
                          className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors"
                          data-testid={`test-account-${account.id}`}
                        >
                          <Avatar>
                            <AvatarFallback className="bg-blue-500/20 text-blue-400">
                              {account.full_name?.[0] || '?'}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium ${textClass} truncate`}>{account.full_name}</p>
                            <p className={`text-sm ${textSecondary} truncate`}>{account.email}</p>
                          </div>
                          <Badge variant="outline" className="shrink-0">{account.role}</Badge>
                          {account.is_verified && (
                            <Badge className="bg-cyan-500/20 text-cyan-400 shrink-0">Verified</Badge>
                          )}
                          {account.is_approved_pro && (
                            <Badge className="bg-purple-500/20 text-purple-400 shrink-0">Pro</Badge>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyCredentials(account)}
                            className="shrink-0"
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setSearchUserQuery('');
                              setSearchResults([]);
                              setImpersonationReason('QA testing');
                              startImpersonation(account.id);
                            }}
                            className="bg-purple-500 hover:bg-purple-600 shrink-0"
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            View As
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {/* Verification Detail Modal */}
      <Dialog open={showVerificationDetail} onOpenChange={setShowVerificationDetail}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-purple-400" />
              Verification Request
            </DialogTitle>
          </DialogHeader>
          
          {selectedVerification && (
            <div className="space-y-4">
              {/* User Info */}
              <div className="flex items-center gap-4 p-3 bg-zinc-800 rounded-lg">
                <Avatar className="w-12 h-12">
                  <AvatarImage src={getFullUrl(selectedVerification.user?.avatar_url)} />
                  <AvatarFallback>{selectedVerification.user?.full_name?.[0]}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">{selectedVerification.user?.full_name}</p>
                  <p className="text-sm text-gray-400">{selectedVerification.user?.email}</p>
                </div>
                <Badge variant="outline" className="ml-auto">
                  {selectedVerification.user?.role || 'User'}
                </Badge>
              </div>

              {/* Verification Type */}
              <div className="flex items-center gap-2">
                <Badge className={`${
                  selectedVerification.verification_type === 'pro_surfer'
                    ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                    : 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                }`}>
                  {selectedVerification.verification_type === 'pro_surfer' 
                    ? 'Pro Surfer (WSL) Verification' 
                    : 'Approved Pro Photographer Verification'}
                </Badge>
                <StatusBadge status={selectedVerification.status} />
              </div>

              {/* Pro Surfer Fields */}
              {selectedVerification.verification_type === 'pro_surfer' && (
                <div className="space-y-3">
                  <h4 className="font-medium text-cyan-400">WSL Information</h4>
                  
                  {selectedVerification.wsl_athlete_id && (
                    <div className="p-3 bg-zinc-800 rounded-lg">
                      <p className="text-xs text-gray-500">WSL Athlete ID</p>
                      <p className="text-white font-mono">{selectedVerification.wsl_athlete_id}</p>
                    </div>
                  )}
                  
                  {selectedVerification.wsl_profile_url && (
                    <a 
                      href={selectedVerification.wsl_profile_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/20 transition-colors"
                    >
                      <Globe className="w-5 h-5 text-cyan-400" />
                      <span className="text-cyan-400">View WSL Profile</span>
                      <ExternalLink className="w-4 h-4 text-cyan-400 ml-auto" />
                    </a>
                  )}
                  
                  {selectedVerification.competition_history_urls?.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Competition History</p>
                      <div className="space-y-1">
                        {selectedVerification.competition_history_urls.map((url, idx) => (
                          <a 
                            key={idx}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-blue-400 hover:underline"
                          >
                            <Link2 className="w-3 h-3" /> {url}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Pro Photographer Fields */}
              {selectedVerification.verification_type === 'approved_pro_photographer' && (
                <div className="space-y-3">
                  <h4 className="font-medium text-purple-400">Professional Information</h4>
                  
                  <div className="grid grid-cols-2 gap-2">
                    {selectedVerification.instagram_url && (
                      <a 
                        href={selectedVerification.instagram_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 p-3 bg-pink-500/10 border border-pink-500/30 rounded-lg hover:bg-pink-500/20"
                      >
                        <Instagram className="w-5 h-5 text-pink-400" />
                        <span className="text-pink-400 text-sm">Instagram</span>
                        <ExternalLink className="w-3 h-3 text-pink-400 ml-auto" />
                      </a>
                    )}
                    
                    {selectedVerification.portfolio_website && (
                      <a 
                        href={selectedVerification.portfolio_website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg hover:bg-blue-500/20"
                      >
                        <Globe className="w-5 h-5 text-blue-400" />
                        <span className="text-blue-400 text-sm">Portfolio</span>
                        <ExternalLink className="w-3 h-3 text-blue-400 ml-auto" />
                      </a>
                    )}
                  </div>
                  
                  {selectedVerification.years_experience && (
                    <div className="p-3 bg-zinc-800 rounded-lg">
                      <p className="text-xs text-gray-500">Years of Experience</p>
                      <p className="text-white">{selectedVerification.years_experience} years</p>
                    </div>
                  )}
                  
                  {selectedVerification.professional_equipment && (
                    <div className="p-3 bg-zinc-800 rounded-lg">
                      <p className="text-xs text-gray-500">Professional Equipment</p>
                      <p className="text-white text-sm">{selectedVerification.professional_equipment}</p>
                    </div>
                  )}
                  
                  {selectedVerification.media_mentions?.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Media Mentions / Features</p>
                      <div className="space-y-1">
                        {selectedVerification.media_mentions.map((url, idx) => (
                          <a 
                            key={idx}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-sm text-green-400 hover:underline"
                          >
                            <FileText className="w-3 h-3" /> {url}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {selectedVerification.sample_work_urls?.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Sample Work</p>
                      <div className="grid grid-cols-3 gap-2">
                        {selectedVerification.sample_work_urls.slice(0, 6).map((url, idx) => (
                          <a 
                            key={idx}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="aspect-square bg-zinc-800 rounded-lg overflow-hidden hover:ring-2 ring-purple-500"
                          >
                            <img src={url} alt={`Sample ${idx + 1}`} className="w-full h-full object-cover" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Photo ID */}
              {selectedVerification.photo_id_url && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Photo ID</p>
                  <a 
                    href={selectedVerification.photo_id_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 bg-zinc-800 rounded-lg hover:bg-zinc-700"
                  >
                    <FileText className="w-5 h-5 text-gray-400" />
                    <span className="text-white">View Photo ID</span>
                    <ExternalLink className="w-4 h-4 text-gray-400 ml-auto" />
                  </a>
                </div>
              )}

              {/* Additional Notes */}
              {selectedVerification.additional_notes && (
                <div className="p-3 bg-zinc-800 rounded-lg">
                  <p className="text-xs text-gray-500">Additional Notes from User</p>
                  <p className="text-white text-sm mt-1">{selectedVerification.additional_notes}</p>
                </div>
              )}

              {/* Review Form */}
              {selectedVerification.status === 'pending' && (
                <div className="border-t border-zinc-800 pt-4 space-y-3">
                  <h4 className="font-medium">Review Decision</h4>
                  
                  <Select value={reviewStatus} onValueChange={setReviewStatus}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700">
                      <SelectValue placeholder="Select decision..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="approved">Approve</SelectItem>
                      <SelectItem value="rejected">Reject</SelectItem>
                      <SelectItem value="more_info_needed">Request More Info</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  {reviewStatus === 'rejected' && (
                    <Textarea
                      placeholder="Reason for rejection (shown to user)..."
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      className="bg-zinc-800 border-zinc-700"
                    />
                  )}
                  
                  <Textarea
                    placeholder="Internal admin notes..."
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    className="bg-zinc-800 border-zinc-700"
                  />
                  
                  <Button
                    onClick={() => handleReviewVerification(selectedVerification.id)}
                    disabled={!reviewStatus || actionLoading}
                    className={`w-full ${
                      reviewStatus === 'approved' ? 'bg-green-500 hover:bg-green-600' :
                      reviewStatus === 'rejected' ? 'bg-red-500 hover:bg-red-600' :
                      'bg-blue-500 hover:bg-blue-600'
                    }`}
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {reviewStatus === 'approved' ? 'Approve Verification' :
                     reviewStatus === 'rejected' ? 'Reject Verification' :
                     reviewStatus === 'more_info_needed' ? 'Request More Info' :
                     'Submit Review'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Fraud Alert Detail Modal */}
      <Dialog open={showAlertDetail} onOpenChange={setShowAlertDetail}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              Fraud Alert Details
            </DialogTitle>
          </DialogHeader>
          
          {selectedAlert && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={selectedAlert.severity} />
                <StatusBadge status={selectedAlert.status} />
                <Badge variant="outline" className="capitalize">
                  {selectedAlert.alert_type?.replace(/_/g, ' ')}
                </Badge>
              </div>
              
              <div>
                <p className="font-medium text-lg">{selectedAlert.title}</p>
                <p className="text-gray-400 mt-1">{selectedAlert.description}</p>
              </div>
              
              <div className="flex items-center gap-3 p-3 bg-zinc-800 rounded-lg">
                <Avatar>
                  <AvatarImage src={getFullUrl(selectedAlert.user?.avatar_url)} />
                  <AvatarFallback>{selectedAlert.user?.full_name?.[0]}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">{selectedAlert.user?.full_name}</p>
                  <p className="text-sm text-gray-400">{selectedAlert.user?.email}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-sm text-gray-500">Risk Score</p>
                  <p className={`text-xl font-bold ${
                    selectedAlert.risk_score >= 80 ? 'text-red-400' :
                    selectedAlert.risk_score >= 50 ? 'text-orange-400' :
                    'text-yellow-400'
                  }`}>{selectedAlert.risk_score}</p>
                </div>
              </div>
              
              {selectedAlert.status === 'open' && (
                <div className="space-y-3 border-t border-zinc-800 pt-4">
                  <Select value={actionTaken} onValueChange={setActionTaken}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700">
                      <SelectValue placeholder="Select action..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Action</SelectItem>
                      <SelectItem value="warning">Send Warning</SelectItem>
                      <SelectItem value="suspended">Suspend User</SelectItem>
                      <SelectItem value="banned">Ban User</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <Textarea
                    placeholder="Resolution notes..."
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    className="bg-zinc-800 border-zinc-700"
                  />
                  
                  <Button
                    onClick={() => handleResolveFraudAlert(selectedAlert.id)}
                    disabled={!actionTaken || actionLoading}
                    className="w-full bg-red-500 hover:bg-red-600"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Resolve Alert
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Violation Detail Dialog */}
      <Dialog open={showViolationDetail} onOpenChange={setShowViolationDetail}>
        <DialogContent className="bg-zinc-900 border-zinc-800 max-w-lg" data-testid="violation-detail-dialog">
          {selectedViolation && (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-white">
                  <Gavel className="w-5 h-5 text-orange-400" />
                  Violation Details
                </DialogTitle>
              </DialogHeader>
              
              {/* Violation Info */}
              <div className="p-4 rounded-lg bg-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge className={`${
                    selectedViolation.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                    selectedViolation.severity === 'severe' ? 'bg-orange-500/20 text-orange-400' :
                    selectedViolation.severity === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}>
                    {selectedViolation.severity?.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-gray-400">{formatDate(selectedViolation.created_at)}</span>
                </div>
                
                <h3 className="text-lg font-semibold text-white">{selectedViolation.title}</h3>
                
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-400">Type</p>
                    <p className="text-white capitalize">{selectedViolation.violation_type?.replace(/_/g, ' ')}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Action Taken</p>
                    <p className="text-white capitalize">{selectedViolation.action_taken?.replace(/_/g, ' ')}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">User ID</p>
                    <p className="text-white font-mono text-xs">{selectedViolation.user_id}</p>
                  </div>
                  {selectedViolation.distance_discrepancy_miles && (
                    <div>
                      <p className="text-gray-400">Distance Discrepancy</p>
                      <p className="text-red-400 font-bold">{selectedViolation.distance_discrepancy_miles} miles</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Appeal Section */}
              {selectedViolation.appeal_status === 'pending' && (
                <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/30 space-y-3">
                  <div className="flex items-center gap-2">
                    <Scale className="w-5 h-5 text-orange-400" />
                    <span className="font-medium text-orange-400">Appeal Pending Review</span>
                  </div>
                  
                  <Textarea
                    placeholder="Add notes for this appeal review..."
                    value={appealNotes}
                    onChange={(e) => setAppealNotes(e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-white"
                    rows={3}
                  />
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 border-green-500 text-green-400 hover:bg-green-500/20"
                      onClick={() => handleReviewAppeal(selectedViolation.id, true)}
                      disabled={actionLoading}
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ThumbsUp className="w-4 h-4 mr-2" />}
                      Approve Appeal
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 border-red-500 text-red-400 hover:bg-red-500/20"
                      onClick={() => handleReviewAppeal(selectedViolation.id, false)}
                      disabled={actionLoading}
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ThumbsDown className="w-4 h-4 mr-2" />}
                      Deny Appeal
                    </Button>
                  </div>
                </div>
              )}

              {/* Already Reviewed */}
              {selectedViolation.appeal_status && selectedViolation.appeal_status !== 'pending' && (
                <div className={`p-4 rounded-lg ${
                  selectedViolation.appeal_status === 'approved' ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'
                }`}>
                  <p className={selectedViolation.appeal_status === 'approved' ? 'text-green-400' : 'text-red-400'}>
                    Appeal {selectedViolation.appeal_status === 'approved' ? 'Approved' : 'Denied'}
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setShowViolationDetail(false)}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminP1Dashboard;
