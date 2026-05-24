import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useLocation } from 'react-router-dom';
import useAdminP1Actions from '../../hooks/useAdminP1Actions';
import {
  StatusBadge, SeverityBadge,
  VerificationDetailModal,
  FraudAlertDetailModal,
  ViolationDetailModal,
} from './p1/AdminP1Modals';
import AdminP1VerificationTab from './p1/AdminP1VerificationTab';
import AdminP1ComplianceTab from './p1/AdminP1ComplianceTab';
import AdminP1TestAccountsTab from './p1/AdminP1TestAccountsTab';
import {
  UserCheck, Eye, AlertTriangle, Search, Loader2, ChevronRight, FileText, Activity, Calendar, DollarSign,
  MessageSquare, Flag, Gavel, Users
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { getFullUrl } from '../../utils/media';

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
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-card/50 border-border';
  const textClass = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

  // ============ HANDLERS FROM useAdminP1Actions ============
  const {
    fetchVerificationQueue,
    fetchImpersonationHistory,
    fetchFraudAlerts,
    fetchComplianceData,
    handleReviewAppeal,
    handleBulkReviewAppeals,
    toggleAppealSelection,
    selectAllAppeals,
    fetchTestAccounts,
    seedAllRoleAccounts,
    cleanupOldTestAccounts,
    copyCredentials,
    searchUsers,
    handleReviewVerification,
    startImpersonation,
    endImpersonation,
    handleResolveFraudAlert,
    fetchUserJourney,
    formatDate,
  } = useAdminP1Actions({
    authStartImpersonation,
    authEndImpersonation,
    authImpersonation,
    verificationFilter,
    fraudFilter,
    selectedAppeals,
    pendingAppeals,
    activeImpersonation,
    impersonationReason,
    reviewStatus,
    adminNotes,
    rejectionReason,
    resolutionNotes,
    actionTaken,
    testAccountPassword,
    setLoading,
    setActionLoading,
    setVerificationQueue,
    setPendingVerifications,
    setImpersonationHistory,
    setFraudAlerts,
    setSeverityCounts,
    setComplianceStats,
    setRecentViolations,
    setLocationFraudMapData,
    setPendingAppeals,
    setSelectedAppeals,
    setBulkProcessing,
    setTestAccounts,
    setSeedingAccounts,
    setSearchResults,
    setShowVerificationDetail,
    setReviewStatus,
    setAdminNotes,
    setRejectionReason,
    setShowAlertDetail,
    setResolutionNotes,
    setActionTaken,
    setActiveImpersonation,
    setSearchUserQuery,
    setImpersonationReason,
    setJourneySummary,
    setJourneyUser,
    setJourneyActivities,
  });

  useEffect(() => {
    if (user?.id) {
      if (activeSubTab === 'verification') fetchVerificationQueue();
      else if (activeSubTab === 'impersonation') fetchImpersonationHistory();
      else if (activeSubTab === 'fraud') fetchFraudAlerts();
      else if (activeSubTab === 'compliance') fetchComplianceData();
      else if (activeSubTab === 'test_accounts') fetchTestAccounts();
    }
  }, [user?.id, activeSubTab, verificationFilter, fraudFilter, complianceFilter]);

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
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-200 border flex-shrink-0 ${
              activeSubTab === tab.id 
                ? 'bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-600/10' 
                : theme === 'beach'
                  ? 'bg-amber-100/50 text-amber-900 border-amber-200/60 hover:bg-amber-200/60 hover:text-amber-950'
                  : isLight
                    ? 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100 hover:text-black'
                    : 'bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:bg-zinc-800/50 hover:text-zinc-100'
            }`}
            data-testid={`p1-tab-${tab.id}`}
          >
            <tab.icon className="w-4 h-4 mr-1.5" />
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full ${
                activeSubTab === tab.id 
                  ? 'bg-white/20 text-white' 
                  : theme === 'beach' 
                    ? 'bg-amber-200 text-amber-950' 
                    : isLight 
                      ? 'bg-gray-200 text-gray-800' 
                      : 'bg-zinc-800 text-zinc-200'
              }`}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Active Impersonation Banner */}
      {activeImpersonation && (
        <Card className="bg-purple-500/20 border-purple-500/50">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Eye className="w-5 h-5 text-purple-400" />
              <div>
                <p className="text-foreground font-medium">
                  Viewing as: {activeImpersonation.target_user.full_name}
                </p>
                <p className="text-purple-300 text-xs">
                  {activeImpersonation.target_user.email} - {activeImpersonation.is_read_only ? 'Read-only' : 'Full access'}
                </p>
              </div>
            </div>
            <Button aria-label="Loader2"
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
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* VERIFICATION QUEUE TAB */}
          {activeSubTab === 'verification' && (
            <AdminP1VerificationTab
              verificationQueue={verificationQueue}
              verificationFilter={verificationFilter}
              setVerificationFilter={setVerificationFilter}
              fetchVerificationQueue={fetchVerificationQueue}
              setSelectedVerification={setSelectedVerification}
              setShowVerificationDetail={setShowVerificationDetail}
              formatDate={formatDate}
              cardBgClass={cardBgClass}
              textClass={textClass}
              textSecondary={textSecondary}
            />
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
                    <Input aria-label="Search user by name or email..."
                      placeholder="Search user by name or email..."
                      value={searchUserQuery}
                      onChange={(e) => {
                        setSearchUserQuery(e.target.value);
                        searchUsers(e.target.value);
                      }}
                      className="pl-10 bg-muted border-border"
                    />
                  </div>
                  
                  <Input aria-label="Reason for impersonation (optional)"
                    placeholder="Reason for impersonation (optional)"
                    value={impersonationReason}
                    onChange={(e) => setImpersonationReason(e.target.value)}
                    className="bg-muted border-border"
                  />
                  
                  {/* Search Results */}
                  {searchResults.length > 0 && (
                    <div className="bg-muted rounded-lg divide-y divide-zinc-700 max-h-60 overflow-y-auto">
                      {searchResults.map(u => (
                        <div 
                          key={u.id}
                          className="p-3 flex items-center justify-between hover:bg-input cursor-pointer"
                          onClick={() => startImpersonation(u.id)}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8">
                              <AvatarImage src={getFullUrl(u.avatar_url)} />
                              <AvatarFallback>{u.full_name?.[0]}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-foreground text-sm">{u.full_name}</p>
                              <p className="text-muted-foreground text-xs">{u.email}</p>
                            </div>
                          </div>
                          <Button size="sm" className="bg-purple-500 hover:bg-purple-600" aria-label="View">
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
                        <div key={session.id} className="p-2 bg-muted rounded-lg flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8">
                              <AvatarFallback>{session.target_user?.full_name?.[0]}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-foreground text-sm">{session.target_user?.full_name}</p>
                              <p className="text-muted-foreground text-xs">
                                {session.reason || 'No reason provided'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">{formatDate(session.started_at)}</p>
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
                      <p className="text-2xl font-bold text-foreground">{severityCounts[severity] || 0}</p>
                      <p className={`text-xs capitalize ${textSecondary}`}>{severity}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Filters */}
              <div className="flex gap-2">
                <Select value={fraudFilter.severity} onValueChange={(v) => setFraudFilter({ severity: v })}>
                  <SelectTrigger className="w-40 bg-muted border-border">
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
            <AdminP1ComplianceTab
              complianceStats={complianceStats}
              complianceFilter={complianceFilter}
              setComplianceFilter={setComplianceFilter}
              locationFraudMapData={locationFraudMapData}
              pendingAppeals={pendingAppeals}
              recentViolations={recentViolations}
              selectedAppeals={selectedAppeals}
              toggleAppealSelection={toggleAppealSelection}
              selectAllAppeals={selectAllAppeals}
              handleBulkReviewAppeals={handleBulkReviewAppeals}
              bulkProcessing={bulkProcessing}
              setSelectedViolation={setSelectedViolation}
              setShowViolationDetail={setShowViolationDetail}
              fetchComplianceData={fetchComplianceData}
              formatDate={formatDate}
              cardBgClass={cardBgClass}
              textClass={textClass}
              textSecondary={textSecondary}
            />
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
                    <Input aria-label="Search user by name or email..."
                      placeholder="Search user by name or email..."
                      value={searchUserQuery}
                      onChange={(e) => {
                        setSearchUserQuery(e.target.value);
                        searchUsers(e.target.value);
                      }}
                      className="pl-10 bg-muted border-border"
                    />
                  </div>
                  
                  {/* Search Results */}
                  {searchResults.length > 0 && !journeyUser && (
                    <div className="mt-2 bg-muted rounded-lg divide-y divide-zinc-700 max-h-40 overflow-y-auto">
                      {searchResults.map(u => (
                        <div 
                          key={u.id}
                          className="p-3 flex items-center justify-between hover:bg-input cursor-pointer"
                          onClick={() => { fetchUserJourney(u.id); setSearchResults([]); }}
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8">
                              <AvatarImage src={getFullUrl(u.avatar_url)} />
                              <AvatarFallback>{u.full_name?.[0]}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-foreground text-sm">{u.full_name}</p>
                              <p className="text-muted-foreground text-xs">{u.email}</p>
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
                          <div key={stat.label} className="p-2 bg-muted rounded-lg text-center">
                            <stat.icon className="w-4 h-4 mx-auto text-gray-500 mb-1" />
                            <p className="text-lg font-bold text-foreground">{stat.value}</p>
                            <p className="text-xs text-muted-foreground">{stat.label}</p>
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
                          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : journeyActivities.length === 0 ? (
                        <p className={`text-sm ${textSecondary} text-center py-4`}>No activity recorded</p>
                      ) : (
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                          {journeyActivities.map((activity, _idx) => (
                            <div key={activity.id} className="flex gap-3 p-2 hover:bg-muted rounded-lg">
                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
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
            <AdminP1TestAccountsTab
              testAccounts={testAccounts}
              testAccountPassword={testAccountPassword}
              setTestAccountPassword={setTestAccountPassword}
              seedAllRoleAccounts={seedAllRoleAccounts}
              seedingAccounts={seedingAccounts}
              cleanupOldTestAccounts={cleanupOldTestAccounts}
              actionLoading={actionLoading}
              copyCredentials={copyCredentials}
              startImpersonation={startImpersonation}
              setSearchUserQuery={setSearchUserQuery}
              setSearchResults={setSearchResults}
              setImpersonationReason={setImpersonationReason}
              cardBgClass={cardBgClass}
              textClass={textClass}
              textSecondary={textSecondary}
            />
          )}
        </>
      )}

      {/* Extracted Modals (v42) */}
      <VerificationDetailModal
        open={showVerificationDetail}
        onOpenChange={setShowVerificationDetail}
        selectedVerification={selectedVerification}
        reviewStatus={reviewStatus}
        setReviewStatus={setReviewStatus}
        adminNotes={adminNotes}
        setAdminNotes={setAdminNotes}
        rejectionReason={rejectionReason}
        setRejectionReason={setRejectionReason}
        handleReviewVerification={handleReviewVerification}
        actionLoading={actionLoading}
        formatDate={formatDate}
      />
      <FraudAlertDetailModal
        open={showAlertDetail}
        onOpenChange={setShowAlertDetail}
        selectedAlert={selectedAlert}
        actionTaken={actionTaken}
        setActionTaken={setActionTaken}
        resolutionNotes={resolutionNotes}
        setResolutionNotes={setResolutionNotes}
        handleResolveFraudAlert={handleResolveFraudAlert}
        actionLoading={actionLoading}
      />
      <ViolationDetailModal
        open={showViolationDetail}
        onOpenChange={setShowViolationDetail}
        selectedViolation={selectedViolation}
        appealNotes={appealNotes}
        setAppealNotes={setAppealNotes}
        handleReviewAppeal={handleReviewAppeal}
        actionLoading={actionLoading}
        formatDate={formatDate}
      />
    </div>
  );
};

export default AdminP1Dashboard;
