import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { Input } from '../ui/input';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import { getFullUrl } from '../../utils/media';
import {
  ShoppingCart, CheckCircle, XCircle, Clock, DollarSign,
  Loader2, Camera, Package, CreditCard, RefreshCw
} from 'lucide-react';
import logger from '../../utils/logger';

/**
 * PurchaseRequestsPanel - GromHQ sub-component
 * Shows pending purchase requests from linked Groms for parent approval/denial.
 */
export const PurchaseRequestsPanel = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const readGeneration = useRef(0);
  const [filter, setFilter] = useState('pending'); // pending | approved | denied | all
  const inFlightDecisions = useRef(new Set());
  const [processingIds, setProcessingIds] = useState(() => new Set());
  const [denyReasons, setDenyReasons] = useState({});
  const [showDenyInput, setShowDenyInput] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Theme tokens
  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-zinc-400';
  const borderColor = isLight ? 'border-gray-200' : 'border-zinc-800';

  const ITEM_TYPE_ICONS = {
    gallery_photo: Camera,
    credit_pack: CreditCard,
    gear_item: Package
  };

  const ITEM_TYPE_LABELS = {
    gallery_photo: 'Photo',
    credit_pack: 'Credits',
    gear_item: 'Gear'
  };

  const fetchRequests = useCallback(async () => {
    if (!user?.id) return;
    const generation = ++readGeneration.current;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await apiClient.get(`/grom-hq/purchase-requests/${user.id}?status=${filter}`);
      if (generation !== readGeneration.current) return;
      setRequests(res.data.requests || []);
      setPendingCount(res.data.pending_count || 0);
    } catch (err) {
      if (generation !== readGeneration.current) return;
      logger.error('Failed to fetch purchase requests:', err);
      setLoadError(true);
    } finally {
      if (generation === readGeneration.current) setLoading(false);
    }
  }, [user?.id, filter]);

  useEffect(() => {
    fetchRequests();
    return () => { readGeneration.current += 1; };
  }, [fetchRequests]);

  const beginDecision = (requestId) => {
    if (inFlightDecisions.current.has(requestId)) return false;
    inFlightDecisions.current.add(requestId);
    setProcessingIds(new Set(inFlightDecisions.current));
    return true;
  };

  const finishDecision = (requestId) => {
    inFlightDecisions.current.delete(requestId);
    setProcessingIds(new Set(inFlightDecisions.current));
  };

  const clearDenyDraft = (requestId) => {
    setShowDenyInput(current => current === requestId ? null : current);
    setDenyReasons(prev => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
  };

  const handleApprove = async (requestId) => {
    if (!beginDecision(requestId)) return;
    try {
      const res = await apiClient.post(
        `/grom-hq/purchase-requests/${requestId}/approve?parent_id=${user.id}`
      );
      toast.success(res.data.message || 'Approved!');
      // Remove from list
      setRequests(prev => prev.filter(r => r.id !== requestId));
      setPendingCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to approve');
    } finally {
      finishDecision(requestId);
    }
  };

  const handleDeny = async (requestId) => {
    if (!beginDecision(requestId)) return;
    try {
      const res = await apiClient.post(
        `/grom-hq/purchase-requests/${requestId}/deny?parent_id=${user.id}&reason=${encodeURIComponent(denyReasons[requestId] || '')}`
      );
      toast.success(res.data.message || 'Denied');
      setRequests(prev => prev.filter(r => r.id !== requestId));
      setPendingCount(prev => Math.max(0, prev - 1));
      clearDenyDraft(requestId);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to deny');
    } finally {
      finishDecision(requestId);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-0"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'approved':
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-0"><CheckCircle className="w-3 h-3 mr-1" /> Approved</Badge>;
      case 'denied':
        return <Badge className="bg-red-500/20 text-red-400 border-0"><XCircle className="w-3 h-3 mr-1" /> Denied</Badge>;
      default:
        return null;
    }
  };

  return (
    <Card className={`${cardBg} border-2 border-amber-500/30`} data-testid="purchase-requests-panel">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className={`${textPrimary} flex items-center gap-2 text-base`}>
            <ShoppingCart className="w-5 h-5 text-amber-400" />
            Purchase Requests
            {!loading && !loadError && pendingCount > 0 && (
              <Badge className="ml-2 bg-amber-500/20 text-amber-400 border-0 animate-pulse">
                {pendingCount} PENDING
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              aria-label="Refresh purchase requests"
              disabled={loading}
              variant="ghost"
              size="sm"
              onClick={fetchRequests}
              className="text-amber-400 hover:text-amber-300"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {/* Filter dropdown */}
            <select
              aria-label="Purchase request status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className={`text-xs rounded-md px-2 py-1 ${isLight ? 'bg-gray-100 text-gray-700' : 'bg-zinc-800 text-zinc-300'} border ${borderColor}`}
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div role="status" aria-label="Loading purchase requests" className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
          </div>
        ) : loadError ? (
          <div role="alert" className="rounded-lg border border-border bg-muted p-4 text-foreground">
            <p className="text-sm">Purchase requests could not be loaded. Try again to check the selected status.</p>
            <Button type="button" variant="outline" className="mt-3" onClick={fetchRequests}>Retry purchase requests</Button>
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-8">
            <ShoppingCart className={`w-10 h-10 mx-auto mb-2 ${isLight ? 'text-gray-300' : 'text-zinc-700'}`} />
            <p className={`text-sm ${textSecondary}`}>
              {filter === 'pending' ? 'No pending requests' : `No ${filter} requests`}
            </p>
            <p className={`text-xs ${textSecondary} mt-1`}>
              When your Grom tries to buy something, it will appear here for your approval.
            </p>
          </div>
        ) : (
          requests.map((req) => {
            const Icon = ITEM_TYPE_ICONS[req.item_type] || Package;
            const typeLabel = ITEM_TYPE_LABELS[req.item_type] || req.item_type;
            const isProcessing = processingIds.has(req.id);
            const decisionLabel = `${req.item_name || 'purchase request'} for ${req.grom_name || 'your Grom'}`;

            return (
              <div
                key={req.id}
                className={`p-4 rounded-xl transition-all ${
                  isLight ? 'bg-gray-50' : 'bg-zinc-800/50'
                } ${req.status === 'pending' ? `border-l-4 border-amber-500` : ''}`}
                data-testid={`purchase-request-${req.id}`}
              >
                {/* Header row */}
                <div className="flex items-center gap-3 mb-3">
                  <Avatar className="w-10 h-10 border border-amber-500/30">
                    <AvatarImage src={getFullUrl(req.grom_avatar)} />
                    <AvatarFallback className="bg-amber-500/20 text-amber-400">
                      {req.grom_name?.[0] || 'G'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm ${textPrimary}`}>{req.grom_name}</p>
                    <p className={`text-xs ${textSecondary}`}>
                      {req.created_at ? new Date(req.created_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                      }) : ''}
                    </p>
                  </div>
                  {getStatusBadge(req.status)}
                </div>

                {/* Item details */}
                <div className={`flex items-center gap-3 p-3 rounded-lg ${isLight ? 'bg-white' : 'bg-zinc-900'} mb-3`}>
                  <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm ${textPrimary} truncate`}>{req.item_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-xs ${textSecondary}`}>{typeLabel}</span>
                      {req.quality_tier && (
                        <Badge variant="outline" className={`text-xs ${borderColor} ${textSecondary}`}>
                          {req.quality_tier}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-amber-400 flex items-center gap-1">
                      <DollarSign className="w-4 h-4" />
                      {req.amount?.toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Action buttons (only for pending) */}
                {req.status === 'pending' && (
                  <>
                    {showDenyInput === req.id ? (
                      <div className="space-y-2">
                        <Input aria-label={`Reason (optional) for denying ${decisionLabel}`}
                          placeholder="Reason (optional)..."
                          value={denyReasons[req.id] || ''}
                          onChange={(e) => setDenyReasons(prev => ({ ...prev, [req.id]: e.target.value }))}
                          disabled={isProcessing}
                          className={`${isLight ? 'bg-white' : 'bg-zinc-800'} ${borderColor} text-sm`}
                        />
                        <div className="flex gap-2">
                          <Button type="button" aria-label={`Confirm Deny ${decisionLabel}`}
                            aria-busy={isProcessing}
                            size="sm"
                            className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                            onClick={() => handleDeny(req.id)}
                            disabled={isProcessing}
                          >
                            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm Deny'}
                          </Button>
                          <Button
                            type="button"
                            aria-label={`Cancel denial of ${decisionLabel}`}
                            size="sm"
                            variant="outline"
                            className={`${borderColor} ${textSecondary}`}
                            onClick={() => clearDenyDraft(req.id)}
                            disabled={isProcessing}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button type="button" aria-label={`Approve ${decisionLabel}`}
                          aria-busy={isProcessing}
                          size="sm"
                          className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white"
                          onClick={() => handleApprove(req.id)}
                          disabled={isProcessing}
                          data-testid={`approve-request-${req.id}`}
                        >
                          {isProcessing ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          ) : (
                            <CheckCircle className="w-4 h-4 mr-1" />
                          )}
                          Approve
                        </Button>
                        <Button type="button" aria-label={`Deny ${decisionLabel}`}
                          size="sm"
                          variant="outline"
                          className="flex-1 border-red-500/50 text-red-400 hover:bg-red-500/10"
                          onClick={() => setShowDenyInput(req.id)}
                          disabled={isProcessing}
                          data-testid={`deny-request-${req.id}`}
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          Deny
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
};

export default PurchaseRequestsPanel;
