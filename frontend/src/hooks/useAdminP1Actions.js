/**
 * useAdminP1Actions.js
 * Extracted from AdminP1Dashboard.js — handler logic for admin compliance dashboard.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';

const useAdminP1Actions = ({
  selectedAppeals,
  setVerificationQueue,
  setVerificationLoading,
  setImpersonationHistory,
  setFraudAlerts,
  setComplianceStats,
  setViolationHistory,
  setSelectedAppeals,
  setTestAccounts,
  setTestAccountsLoading,
  setUserJourney,
  setUserJourneyLoading,
}) => {

  const fetchVerificationQueue = async () => {
    setVerificationLoading(true);
    try {
      const response = await apiClient.get('/admin/verification-queue');
      setVerificationQueue(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch verification queue:', error);
    } finally {
      setVerificationLoading(false);
    }
  };

  const fetchImpersonationHistory = async () => {
    try {
      const response = await apiClient.get('/admin/impersonation-history');
      setImpersonationHistory(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch impersonation history:', error);
    }
  };

  const fetchFraudAlerts = async () => {
    try {
      const response = await apiClient.get('/admin/fraud-alerts');
      setFraudAlerts(response.data?.alerts || []);
    } catch (error) {
      logger.error('Failed to fetch fraud alerts:', error);
    }
  };

  const fetchComplianceData = async () => {
    try {
      const [statsRes, violationsRes] = await Promise.allSettled([
        apiClient.get('/admin/compliance-stats'),
        apiClient.get('/admin/violation-history')
      ]);
      if (statsRes.status === 'fulfilled') setComplianceStats(statsRes.value.data);
      if (violationsRes.status === 'fulfilled') setViolationHistory(violationsRes.value.data || []);
    } catch (error) {
      logger.error('Failed to fetch compliance data:', error);
    }
  };

  const handleReviewAppeal = async (violationId, approved) => {
    try {
      await apiClient.post(`/admin/violations/${violationId}/review-appeal`, {
        approved,
        reviewer_notes: ''
      });
      toast.success(approved ? 'Appeal approved - violation removed' : 'Appeal denied');
      fetchComplianceData();
    } catch (error) {
      toast.error('Failed to review appeal');
    }
  };

  const handleBulkReviewAppeals = async (approved) => {
    if (selectedAppeals.length === 0) {
      toast.info('No appeals selected');
      return;
    }
    try {
      await Promise.all(
        selectedAppeals.map(id =>
          apiClient.post(`/admin/violations/${id}/review-appeal`, {
            approved,
            reviewer_notes: 'Bulk review'
          })
        )
      );
      toast.success(`${approved ? 'Approved' : 'Denied'} ${selectedAppeals.length} appeals`);
      setSelectedAppeals([]);
      fetchComplianceData();
    } catch (error) {
      toast.error('Failed to process bulk review');
    }
  };

  const fetchTestAccounts = async () => {
    setTestAccountsLoading(true);
    try {
      const response = await apiClient.get('/admin/test-accounts');
      setTestAccounts(response.data || []);
    } catch (error) {
      logger.error('Failed to fetch test accounts:', error);
    } finally {
      setTestAccountsLoading(false);
    }
  };

  const handleReviewVerification = async (requestId, approved, notes) => {
    try {
      await apiClient.post(`/admin/verification-queue/${requestId}/review`, {
        approved,
        reviewer_notes: notes || ''
      });
      toast.success(approved ? 'Verification approved' : 'Verification denied');
      fetchVerificationQueue();
    } catch (error) {
      toast.error('Failed to review verification');
    }
  };

  const handleResolveFraudAlert = async (alertId, resolution) => {
    try {
      await apiClient.post(`/admin/fraud-alerts/${alertId}/resolve`, {
        resolution: resolution || 'resolved'
      });
      toast.success('Fraud alert resolved');
      fetchFraudAlerts();
    } catch (error) {
      toast.error('Failed to resolve alert');
    }
  };

  const fetchUserJourney = async (userId) => {
    setUserJourneyLoading(true);
    try {
      const response = await apiClient.get(`/admin/user-journey/${userId}`);
      setUserJourney(response.data);
    } catch (error) {
      logger.error('Failed to fetch user journey:', error);
    } finally {
      setUserJourneyLoading(false);
    }
  };

  return {
    fetchVerificationQueue,
    fetchImpersonationHistory,
    fetchFraudAlerts,
    fetchComplianceData,
    handleReviewAppeal,
    handleBulkReviewAppeals,
    fetchTestAccounts,
    handleReviewVerification,
    handleResolveFraudAlert,
    fetchUserJourney,
  };
};

export default useAdminP1Actions;
