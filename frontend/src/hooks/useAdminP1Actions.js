/**
 * useAdminP1Actions.js
 * Extracted from AdminP1Dashboard.js -- handler logic for admin compliance dashboard.
 * v33: Rewritten to exactly match AdminP1Dashboard.js handler implementations.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

const useAdminP1Actions = ({
  // Auth context
  authStartImpersonation,
  authEndImpersonation,
  authImpersonation,
  // Filters (read-only)
  verificationFilter,
  fraudFilter,
  // State
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
  // Setters
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
}) => {

  const fetchVerificationQueue = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
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
      const params = new URLSearchParams();
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
        notes: `Appeal ${approved ? 'approved' : 'denied'} by admin`
      });
      toast.success(approved ? 'Appeal approved' : 'Appeal denied');
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

  return {
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
  };
};

export default useAdminP1Actions;
