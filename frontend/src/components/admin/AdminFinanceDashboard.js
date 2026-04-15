import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import axios from 'axios';
import {
  DollarSign, CreditCard, ArrowUpRight, ArrowDownRight,
  Loader2, RefreshCw, Check, X, Download, AlertTriangle,
  Receipt, Wallet, TrendingDown, FileText
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { toast } from 'sonner';
import logger from '../../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * Admin Finance Dashboard
 * - Refund processing
 * - Payout batch management
 * - Failed payment recovery
 * - Tax reporting
 */
export const AdminFinanceDashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('refunds');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  
  // Refunds
  const [refunds, setRefunds] = useState([]);
  const [refundFilter, setRefundFilter] = useState('pending');
  const [selectedRefund, setSelectedRefund] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  
  // Payouts
  const [payoutBatches, setPayoutBatches] = useState([]);
  const [pendingPayouts, setPendingPayouts] = useState(null);
  
  // Failed Payments
  const [failedPayments, setFailedPayments] = useState([]);
  
  // Tax Report
  const [taxYear, setTaxYear] = useState(new Date().getFullYear());
  const [taxReport, setTaxReport] = useState(null);

  const [actionLoading, setActionLoading] = useState(false);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';

  useEffect(() => {
    if (user?.id) {
      fetchStats();
      fetchDataForTab();
    }
  }, [user?.id, activeTab, refundFilter, taxYear]);

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API}/admin/finance/stats?admin_id=${user.id}&days=30`);
      setStats(response.data);
    } catch (error) {
      logger.error('Failed to load stats:', error);
    }
  };

  const fetchDataForTab = async () => {
    setLoading(true);
    try {
      if (activeTab === 'refunds') {
        const response = await axios.get(`${API}/admin/finance/refunds?admin_id=${user.id}&status=${refundFilter}&limit=50`);
        setRefunds(response.data.refunds || []);
      } else if (activeTab === 'payouts') {
        const [batchesRes, pendingRes] = await Promise.all([
          axios.get(`${API}/admin/finance/payouts?admin_id=${user.id}&limit=20`),
          axios.get(`${API}/admin/finance/payouts/pending?admin_id=${user.id}`)
        ]);
        setPayoutBatches(batchesRes.data.batches || []);
        setPendingPayouts(pendingRes.data);
      } else if (activeTab === 'failed') {
        const response = await axios.get(`${API}/admin/finance/failed-payments?admin_id=${user.id}&limit=50`);
        setFailedPayments(response.data.failed_payments || []);
      } else if (activeTab === 'tax') {
        const response = await axios.get(`${API}/admin/finance/tax-report?admin_id=${user.id}&year=${taxYear}`);
        setTaxReport(response.data);
      }
    } catch (error) {
      logger.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProcessRefund = async (refundId, action) => {
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/finance/refunds/${refundId}/process?admin_id=${user.id}`, {
        action,
        rejection_reason: action === 'reject' ? rejectionReason : null
      });
      toast.success(`Refund ${action}d`);
      setShowRejectDialog(false);
      setRejectionReason('');
      setSelectedRefund(null);
      fetchDataForTab();
      fetchStats();
    } catch (error) {
      toast.error(`Failed to ${action} refund`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreatePayoutBatch = async () => {
    setActionLoading(true);
    try {
      const response = await axios.post(`${API}/admin/finance/payouts/create-batch?admin_id=${user.id}`, {});
      toast.success(`Batch ${response.data.batch_number} created`);
      fetchDataForTab();
    } catch (error) {
      toast.error('Failed to create batch');
    } finally {
      setActionLoading(false);
    }
  };

  const handleProcessBatch = async (batchId) => {
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/finance/payouts/${batchId}/process?admin_id=${user.id}`);
      toast.success('Batch processed');
      fetchDataForTab();
    } catch (error) {
      toast.error('Failed to process batch');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetryPayment = async (paymentId) => {
    setActionLoading(true);
    try {
      const response = await axios.post(`${API}/admin/finance/failed-payments/${paymentId}/retry?admin_id=${user.id}`);
      toast.success(response.data.recovered ? 'Payment recovered!' : 'Retry failed');
      fetchDataForTab();
      fetchStats();
    } catch (error) {
      toast.error('Failed to retry payment');
    } finally {
      setActionLoading(false);
    }
  };

  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  const formatDate = (dateStr) => dateStr ? new Date(dateStr).toLocaleDateString() : '-';

  return (
    <div className="space-y-4" data-testid="admin-finance-dashboard">
      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className={`${cardBgClass} border-yellow-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Pending Refunds</p>
              <p className="text-xl font-bold text-yellow-400">{stats.pending_refunds.count}</p>
              <p className="text-xs text-gray-500">{formatCurrency(stats.pending_refunds.amount)}</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-green-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Processed (30d)</p>
              <p className="text-xl font-bold text-green-400">{stats.processed_refunds.count}</p>
              <p className="text-xs text-gray-500">{formatCurrency(stats.processed_refunds.amount)}</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-red-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Failed Payments</p>
              <p className="text-xl font-bold text-red-400">{stats.failed_payments.count}</p>
              <p className="text-xs text-gray-500">{formatCurrency(stats.failed_payments.amount)}</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-cyan-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Recovery Rate</p>
              <p className="text-xl font-bold text-cyan-400">{stats.recovery_rate}%</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2">
        {[
          { id: 'refunds', label: 'Refunds', icon: Receipt },
          { id: 'payouts', label: 'Payouts', icon: Wallet },
          { id: 'failed', label: 'Failed Payments', icon: TrendingDown },
          { id: 'tax', label: 'Tax Report', icon: FileText }
        ].map(tab => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? 'bg-cyan-500 hover:bg-cyan-600' : ''}
          >
            <tab.icon className="w-4 h-4 mr-1" />
            {tab.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
        </div>
      ) : (
        <>
          {/* REFUNDS TAB */}
          {activeTab === 'refunds' && (
            <Card className={cardBgClass}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className={`text-sm ${textClass}`}>Refund Requests</CardTitle>
                <Select value={refundFilter} onValueChange={setRefundFilter}>
                  <SelectTrigger className="w-32 h-8 text-xs bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                {refunds.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">No refund requests</p>
                ) : (
                  <div className="space-y-2">
                    {refunds.map(refund => (
                      <div key={refund.id} className="p-3 bg-zinc-800/50 rounded-lg">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className={`font-medium ${textClass}`}>{refund.user_name}</p>
                            <p className="text-xs text-gray-500">{refund.user_email}</p>
                            <p className="text-sm text-gray-400 mt-1">{refund.reason}</p>
                            {refund.reason_category && (
                              <Badge variant="outline" className="text-xs mt-1">{refund.reason_category}</Badge>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-white">{formatCurrency(refund.amount)}</p>
                            <Badge className={`text-xs ${
                              refund.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                              refund.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                              'bg-red-500/20 text-red-400'
                            }`}>{refund.status}</Badge>
                          </div>
                        </div>
                        {refund.status === 'pending' && (
                          <div className="flex gap-2 mt-3 pt-3 border-t border-zinc-700">
                            <Button 
                              size="sm" 
                              onClick={() => handleProcessRefund(refund.id, 'approve')}
                              disabled={actionLoading}
                              className="bg-green-500 hover:bg-green-600"
                            >
                              <Check className="w-4 h-4 mr-1" /> Approve
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => { setSelectedRefund(refund); setShowRejectDialog(true); }}
                            >
                              <X className="w-4 h-4 mr-1" /> Reject
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* PAYOUTS TAB */}
          {activeTab === 'payouts' && (
            <div className="space-y-4">
              {pendingPayouts && (
                <Card className={`${cardBgClass} border-green-500/30`}>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <CardTitle className={`text-sm ${textClass}`}>Pending Payouts</CardTitle>
                    <Button size="sm" onClick={handleCreatePayoutBatch} disabled={actionLoading} className="bg-green-500 hover:bg-green-600">
                      Create Batch
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
                      <div>
                        <p className={`text-lg font-bold ${textClass}`}>{formatCurrency(pendingPayouts.total_pending_amount)}</p>
                        <p className="text-xs text-gray-500">{pendingPayouts.total_recipients} recipients</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className={cardBgClass}>
                <CardHeader className="pb-2">
                  <CardTitle className={`text-sm ${textClass}`}>Payout Batches</CardTitle>
                </CardHeader>
                <CardContent>
                  {payoutBatches.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No payout batches</p>
                  ) : (
                    <div className="space-y-2">
                      {payoutBatches.map(batch => (
                        <div key={batch.id} className="p-3 bg-zinc-800/50 rounded-lg flex items-center justify-between">
                          <div>
                            <p className={`font-medium ${textClass}`}>{batch.batch_number}</p>
                            <p className="text-xs text-gray-500">{batch.total_recipients} recipients • {formatDate(batch.created_at)}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <p className="text-lg font-bold text-white">{formatCurrency(batch.total_amount)}</p>
                            <Badge className={`text-xs ${
                              batch.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                              batch.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-gray-500/20 text-gray-400'
                            }`}>{batch.status}</Badge>
                            {batch.status === 'pending' && (
                              <Button size="sm" onClick={() => handleProcessBatch(batch.id)} disabled={actionLoading}>
                                Process
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* FAILED PAYMENTS TAB */}
          {activeTab === 'failed' && (
            <Card className={cardBgClass}>
              <CardHeader className="pb-2">
                <CardTitle className={`text-sm ${textClass}`}>Failed Payments</CardTitle>
              </CardHeader>
              <CardContent>
                {failedPayments.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">No failed payments</p>
                ) : (
                  <div className="space-y-2">
                    {failedPayments.map(payment => (
                      <div key={payment.id} className="p-3 bg-zinc-800/50 rounded-lg">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className={`font-medium ${textClass}`}>{payment.user_name}</p>
                            <p className="text-xs text-gray-500">{payment.user_email}</p>
                            <p className="text-xs text-red-400 mt-1">{payment.failure_message}</p>
                            <Badge variant="outline" className="text-xs mt-1">{payment.payment_type}</Badge>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-white">{formatCurrency(payment.amount)}</p>
                            <p className="text-xs text-gray-500">{payment.recovery_attempts} attempts</p>
                          </div>
                        </div>
                        {!payment.recovered && (
                          <div className="mt-3 pt-3 border-t border-zinc-700">
                            <Button 
                              size="sm" 
                              onClick={() => handleRetryPayment(payment.id)}
                              disabled={actionLoading}
                            >
                              <RefreshCw className="w-4 h-4 mr-1" /> Retry Payment
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* TAX REPORT TAB */}
          {activeTab === 'tax' && (
            <Card className={cardBgClass}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className={`text-sm ${textClass}`}>Tax Report (1099 Recipients)</CardTitle>
                <Select value={taxYear.toString()} onValueChange={(v) => setTaxYear(parseInt(v))}>
                  <SelectTrigger className="w-24 h-8 text-xs bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2026">2026</SelectItem>
                    <SelectItem value="2025">2025</SelectItem>
                    <SelectItem value="2024">2024</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                {taxReport && (
                  <>
                    <div className="p-3 bg-zinc-800/50 rounded-lg mb-4">
                      <p className="text-xs text-gray-500">Earnings ≥ ${taxReport.threshold} threshold</p>
                      <p className={`text-lg font-bold ${textClass}`}>{taxReport.total_recipients} recipients</p>
                      <p className="text-sm text-gray-400">{formatCurrency(taxReport.total_reportable_amount)} total</p>
                    </div>
                    {taxReport.recipients.length === 0 ? (
                      <p className="text-center text-gray-500 py-4">No recipients above threshold</p>
                    ) : (
                      <div className="space-y-2">
                        {taxReport.recipients.map(r => (
                          <div key={r.user_id} className="p-2 bg-zinc-800/30 rounded flex items-center justify-between">
                            <div>
                              <p className={`text-sm font-medium ${textClass}`}>{r.name}</p>
                              <p className="text-xs text-gray-500">{r.email}</p>
                            </div>
                            <p className="text-sm font-bold text-green-400">{formatCurrency(r.total_earnings)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Reject Dialog */}
      <Dialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle>Reject Refund</DialogTitle>
          </DialogHeader>
          <div>
            <p className="text-sm text-gray-400 mb-2">Reason for rejection:</p>
            <Textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Explain why this refund is being rejected..."
              className="bg-zinc-800 border-zinc-700"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(false)}>Cancel</Button>
            <Button 
              onClick={() => handleProcessRefund(selectedRefund?.id, 'reject')}
              disabled={actionLoading || !rejectionReason.trim()}
              className="bg-red-500 hover:bg-red-600"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Reject Refund'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminFinanceDashboard;
