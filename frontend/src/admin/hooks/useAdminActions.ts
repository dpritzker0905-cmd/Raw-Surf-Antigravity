import { useState, useEffect } from 'react';
import apiClient from '../../lib/apiClient';
import { supabaseAdmin } from '../lib/supabase';
import { toast } from 'sonner';

export interface AdminAction {
  decision_id: string;
  type: string;
  spot_name?: string;
  proposed_value?: any;
  status: string; // 'pending_approval', 'executed', 'rejected'
  explanation?: string;
  reasoning?: string;
  timestamp: string;
  caller_role?: string;
  execution_timestamp?: string;
  execution_result?: any;
  correlation_id?: string;
  recommendation_type?: string;
  supporting_event_trace?: string;
  expected_outcome?: string;
  risk_level?: string;
  confidence_score?: number;
}

export const useAdminActions = () => {
  const [actions, setActions] = useState<AdminAction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActions = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/event-dashboard/actions');
      if (res.data?.success) {
        setActions(res.data.actions || []);
      }
    } catch (err: any) {
      console.error('Failed to fetch actions:', err);
      setError(err.message || 'Failed to fetch actions');
    } finally {
      setLoading(false);
    }
  };

  const approveAction = async (decisionId: string, correlationId?: string) => {
    try {
      toast.loading('Executing admin approval...', { id: 'admin-action' });
      const res = await apiClient.post('/admin/event-dashboard/actions/approve', {
        decision_id: decisionId,
        correlation_id: correlationId
      });
      if (res.data?.success || res.data?.status === 'executed') {
        toast.success('Action approved and executed successfully!', { id: 'admin-action' });
        setActions((prev) =>
          prev.map((a) =>
            a.decision_id === decisionId ? { ...a, status: 'executed' } : a
          )
        );
        return true;
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to approve action', { id: 'admin-action' });
      return false;
    }
    return false;
  };

  const rejectAction = async (decisionId: string, explanation: string, correlationId?: string) => {
    try {
      toast.loading('Rejecting action...', { id: 'admin-action' });
      const res = await apiClient.post('/admin/event-dashboard/actions/reject', {
        decision_id: decisionId,
        explanation,
        correlation_id: correlationId
      });
      if (res.data?.success || res.data?.status === 'rejected') {
        toast.success('Action successfully rejected!', { id: 'admin-action' });
        setActions((prev) =>
          prev.map((a) =>
            a.decision_id === decisionId ? { ...a, status: 'rejected', explanation } : a
          )
        );
        return true;
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to reject action', { id: 'admin-action' });
      return false;
    }
    return false;
  };

  const proposeOverride = async (bookingId: string, newCapacity: number, explanation: string, correlationId?: string) => {
    try {
      toast.loading('Applying capacity override...', { id: 'admin-override' });
      const res = await apiClient.post('/admin/event-dashboard/actions/override', {
        booking_id: bookingId,
        new_capacity: newCapacity,
        explanation,
        correlation_id: correlationId
      });
      if (res.data?.success) {
        toast.success('Booking override applied successfully!', { id: 'admin-override' });
        fetchActions();
        return true;
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to apply override', { id: 'admin-override' });
      return false;
    }
    return false;
  };

  useEffect(() => {
    fetchActions();

    const subscription = supabaseAdmin.subscribeTable('operator_decisions', () => {
      fetchActions();
    });

    return () => {
      if (subscription) {
        supabaseAdmin.unsubscribeTable(subscription);
      }
    };
  }, []);

  return {
    actions,
    loading,
    error,
    refresh: fetchActions,
    approveAction,
    rejectAction,
    proposeOverride
  };
};

export default useAdminActions;
