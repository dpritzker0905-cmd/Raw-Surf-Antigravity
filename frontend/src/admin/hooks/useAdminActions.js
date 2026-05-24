import { useState, useEffect } from 'react';
import apiClient from '../../lib/apiClient';
import { supabaseAdminClient } from '../services/supabaseAdminClient';
import { toast } from 'sonner';

export const useAdminActions = () => {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchActions = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/admin/event-dashboard/actions');
      if (res.data?.success) {
        setActions(res.data.actions || []);
      }
    } catch (err) {
      console.error('Failed to fetch actions:', err);
      setError(err.message || 'Failed to fetch actions');
    } finally {
      setLoading(false);
    }
  };

  const approveAction = async (decisionId, correlationId) => {
    try {
      toast.loading('Executing admin approval...', { id: 'admin-action' });
      const res = await apiClient.post('/admin/event-dashboard/actions/approve', {
        decision_id: decisionId,
        correlation_id: correlationId
      });
      if (res.data?.success || res.data?.status === 'executed') {
        toast.success('Action approved and executed successfully!', { id: 'admin-action' });
        // Update local state
        setActions((prev) =>
          prev.map((a) =>
            a.decision_id === decisionId ? { ...a, status: 'executed' } : a
          )
        );
        return true;
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to approve action', { id: 'admin-action' });
      return false;
    }
  };

  const rejectAction = async (decisionId, explanation, correlationId) => {
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
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to reject action', { id: 'admin-action' });
      return false;
    }
  };

  const proposeOverride = async (bookingId, newCapacity, explanation, correlationId) => {
    try {
      toast.loading('Applying capacity override...', { id: 'admin-override' });
      const res = await apiClient.post('/admin/event-dashboard/actions/override', {
        booking_id: bookingId,
        new_capacity: parseInt(newCapacity),
        explanation,
        correlation_id: correlationId
      });
      if (res.data?.success) {
        toast.success('Booking override applied successfully!', { id: 'admin-override' });
        fetchActions(); // Refresh to see the override
        return true;
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to apply override', { id: 'admin-override' });
      return false;
    }
  };

  useEffect(() => {
    fetchActions();

    // Subscribe to realtime updates for admin_actions table in Supabase
    const subscription = supabaseAdminClient.subscribeToTable('operator_decisions', () => {
      // Re-fetch historical records on any PostgreSQL change
      fetchActions();
    });

    return () => {
      if (subscription) {
        supabaseAdminClient.unsubscribe(subscription);
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
