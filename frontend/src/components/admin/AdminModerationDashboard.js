import React, { useState, useEffect } from 'react';

import { useAuth } from '../../contexts/AuthContext';

import { useTheme } from '../../contexts/ThemeContext';

import apiClient from '../../lib/apiClient';

import { MessageSquare, FileText,

  Loader2, RefreshCw, Flag, Scale, Wallet,
  Send
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';

import { Button } from '../ui/button';

import { Input } from '../ui/input';

import { Textarea } from '../ui/textarea';

import { Badge } from '../ui/badge';

import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

import { toast } from 'sonner';
import { getFullUrl } from '../../utils/media';



// Status badge component
const StatusBadge = ({ status }) => {
  const statusStyles = {
    // Disputes
    open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    under_review: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    awaiting_response: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    resolved_refund: 'bg-green-500/20 text-green-400 border-green-500/30',
    resolved_no_action: 'bg-gray-500/20 text-muted-foreground border-gray-500/30',
    resolved_partial: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
    escalated: 'bg-red-500/20 text-red-400 border-red-500/30',
    closed: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
    // Reports
    pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    action_taken: 'bg-green-500/20 text-green-400 border-green-500/30',
    no_violation: 'bg-gray-500/20 text-muted-foreground border-gray-500/30',
    dismissed: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  };

  return (
    <Badge className={`text-xs ${statusStyles[status] || 'bg-zinc-500/20 text-zinc-400'}`}>
      {status?.replace(/_/g, ' ')}
    </Badge>
  );
};

// Priority badge
const PriorityBadge = ({ priority }) => {
  const styles = {
    low: 'bg-gray-500/20 text-muted-foreground',
    normal: 'bg-blue-500/20 text-blue-400',
    high: 'bg-orange-500/20 text-orange-400',
    urgent: 'bg-red-500/20 text-red-400 animate-pulse',
  };
  return <Badge className={`text-xs ${styles[priority] || styles.normal}`}>{priority}</Badge>;
};

export const AdminModerationDashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeSubTab, setActiveSubTab] = useState('disputes');
  const [loading, setLoading] = useState(true);
  
  // Disputes state
  const [disputes, setDisputes] = useState([]);
  const [disputesTotal, setDisputesTotal] = useState(0);
  const [selectedDispute, setSelectedDispute] = useState(null);
  const [showDisputeDetail, setShowDisputeDetail] = useState(false);
  const [disputeFilter, setDisputeFilter] = useState({ status: '', type: '' });
  
  // Reports state
  const [reports, setReports] = useState([]);
  const [pendingReportsCount, setPendingReportsCount] = useState(0);
  const [selectedReport, setSelectedReport] = useState(null);
  const [showReportReview, setShowReportReview] = useState(false);
  const [reportFilter, setReportFilter] = useState({ status: '', reason: '' });
  
  // Payout Holds state
  const [payoutHolds, setPayoutHolds] = useState([]);
  const [totalHeldAmount, setTotalHeldAmount] = useState(0);
  const [_showCreateHold, setShowCreateHold] = useState(false);
  
  // Audit Logs state
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditFilter, setAuditFilter] = useState({ category: '' });
  
  // Form states
  const [newMessage, setNewMessage] = useState('');
  const [reviewAction, setReviewAction] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-card/50 border-border';
  const textClass = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

  // Fetch data based on active tab
  useEffect(() => {
    if (user?.id) {
      if (activeSubTab === 'disputes') fetchDisputes();
      else if (activeSubTab === 'reports') fetchReports();
      else if (activeSubTab === 'holds') fetchPayoutHolds();
      else if (activeSubTab === 'audit') fetchAuditLogs();
    }
  }, [user?.id, activeSubTab, disputeFilter, reportFilter, auditFilter]);

  const fetchDisputes = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (disputeFilter.status) params.append('status', disputeFilter.status);
      if (disputeFilter.type) params.append('dispute_type', disputeFilter.type);
      
      const response = await apiClient.get(`/admin/disputes?${params}`);
      setDisputes(response.data.disputes || []);
      setDisputesTotal(response.data.total || 0);
    } catch (error) {
      toast.error('Failed to load disputes');
    } finally {
      setLoading(false);
    }
  };

  const fetchReports = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (reportFilter.status) params.append('status', reportFilter.status);
      if (reportFilter.reason) params.append('reason', reportFilter.reason);
      
      const response = await apiClient.get(`/admin/reports?${params}`);
      setReports(response.data.reports || []);
      setPendingReportsCount(response.data.pending_count || 0);
    } catch (error) {
      toast.error('Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  const fetchPayoutHolds = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/admin/payout-holds`);
      setPayoutHolds(response.data.holds || []);
      setTotalHeldAmount(response.data.total_held_amount || 0);
    } catch (error) {
      toast.error('Failed to load payout holds');
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (auditFilter.category) params.append('category', auditFilter.category);
      
      const response = await apiClient.get(`/admin/audit-logs?${params}`);
      setAuditLogs(response.data.logs || []);
    } catch (error) {
      toast.error('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  const fetchDisputeDetail = async (disputeId) => {
    try {
      const response = await apiClient.get(`/admin/disputes/${disputeId}`);
      setSelectedDispute(response.data);
      setShowDisputeDetail(true);
    } catch (error) {
      toast.error('Failed to load dispute details');
    }
  };

  const handleUpdateDispute = async (disputeId, updates) => {
    setActionLoading(true);
    try {
      await apiClient.put(`/admin/disputes/${disputeId}`, updates);
      toast.success('Dispute updated');
      fetchDisputes();
      if (selectedDispute?.id === disputeId) {
        fetchDisputeDetail(disputeId);
      }
    } catch (error) {
      toast.error('Failed to update dispute');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddDisputeMessage = async (disputeId) => {
    if (!newMessage.trim()) return;
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/disputes/${disputeId}/messages`, {
        message: newMessage,
        is_internal: false
      });
      toast.success('Message sent');
      setNewMessage('');
      fetchDisputeDetail(disputeId);
    } catch (error) {
      toast.error('Failed to send message');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReviewReport = async (reportId) => {
    if (!reviewAction) {
      toast.error('Please select an action');
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.put(`/admin/reports/${reportId}/review`, {
        action_taken: reviewAction,
        admin_notes: adminNotes,
        escalate_to_dispute: reviewAction === 'escalate'
      });
      toast.success('Report reviewed');
      setShowReportReview(false);
      setReviewAction('');
      setAdminNotes('');
      fetchReports();
    } catch (error) {
      toast.error('Failed to review report');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReleaseHold = async (holdId) => {
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/payout-holds/${holdId}/release`, {
        release_notes: 'Admin released hold'
      });
      toast.success('Hold released');
      fetchPayoutHolds();
    } catch (error) {
      toast.error('Failed to release hold');
    } finally {
      setActionLoading(false);
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
    <div className="space-y-4" data-testid="admin-moderation-dashboard">
      {/* Sub-tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
          { id: 'disputes', label: 'Disputes', icon: Scale, count: disputesTotal },
          { id: 'reports', label: 'Reports', icon: Flag, count: pendingReportsCount },
          { id: 'holds', label: 'Payout Holds', icon: Wallet, count: payoutHolds.filter(h => h.is_active).length },
          { id: 'audit', label: 'Audit Logs', icon: FileText },
        ].map(tab => (
          <Button
            key={tab.id}
            variant={activeSubTab === tab.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveSubTab(tab.id)}
            className={activeSubTab === tab.id ? 'bg-red-500 hover:bg-red-600' : ''}
            data-testid={`moderation-tab-${tab.id}`}
          >
            <tab.icon className="w-4 h-4 mr-1.5" />
            {tab.label}
            {tab.count > 0 && (
              <Badge className="ml-1.5 bg-white/20 text-foreground">{tab.count}</Badge>
            )}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* DISPUTES TAB */}
          {activeSubTab === 'disputes' && (
            <div className="space-y-3">
              {/* Filters */}
              <div className="flex gap-2 flex-wrap">
                <Select value={disputeFilter.status || "all"} onValueChange={(v) => setDisputeFilter(f => ({ ...f, status: v === "all" ? "" : v }))}>
                  <SelectTrigger className="w-40 bg-muted border-border">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="under_review">Under Review</SelectItem>
                    <SelectItem value="escalated">Escalated</SelectItem>
                    <SelectItem value="resolved_refund">Resolved (Refund)</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={disputeFilter.type || "all"} onValueChange={(v) => setDisputeFilter(f => ({ ...f, type: v === "all" ? "" : v }))}>
                  <SelectTrigger className="w-40 bg-muted border-border">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="payment">Payment</SelectItem>
                    <SelectItem value="service_quality">Service Quality</SelectItem>
                    <SelectItem value="no_show">No Show</SelectItem>
                    <SelectItem value="harassment">Harassment</SelectItem>
                    <SelectItem value="fraud">Fraud</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={fetchDisputes}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>

              {/* Disputes List */}
              {disputes.length === 0 ? (
                <Card className={cardBgClass}>
                  <CardContent className="py-12 text-center">
                    <Scale className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                    <p className={textSecondary}>No disputes found</p>
                  </CardContent>
                </Card>
              ) : (
                disputes.map(dispute => (
                  <Card 
                    key={dispute.id} 
                    className={`${cardBgClass} cursor-pointer hover:border-input transition-colors`}
                    onClick={() => fetchDisputeDetail(dispute.id)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <StatusBadge status={dispute.status} />
                            <PriorityBadge priority={dispute.priority} />
                            <Badge variant="outline" className="text-xs">
                              {dispute.dispute_type?.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          <h4 className={`font-medium ${textClass} truncate`}>{dispute.subject}</h4>
                          <p className={`text-sm ${textSecondary} line-clamp-2 mt-1`}>{dispute.description}</p>
                          
                          <div className="flex items-center gap-4 mt-3 text-xs">
                            <div className="flex items-center gap-1.5">
                              <Avatar className="w-5 h-5">
                                <AvatarImage src={getFullUrl(dispute.complainant?.avatar_url)} />
                                <AvatarFallback className="text-xs">{dispute.complainant?.full_name?.[0]}</AvatarFallback>
                              </Avatar>
                              <span className={textSecondary}>{dispute.complainant?.full_name}</span>
                              <span className="text-gray-600">vs</span>
                              <Avatar className="w-5 h-5">
                                <AvatarImage src={getFullUrl(dispute.respondent?.avatar_url)} />
                                <AvatarFallback className="text-xs">{dispute.respondent?.full_name?.[0]}</AvatarFallback>
                              </Avatar>
                              <span className={textSecondary}>{dispute.respondent?.full_name}</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="text-right shrink-0">
                          {dispute.amount_disputed && (
                            <p className="text-lg font-bold text-red-400">${dispute.amount_disputed}</p>
                          )}
                          <p className={`text-xs ${textSecondary}`}>{formatDate(dispute.created_at)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* REPORTS TAB */}
          {activeSubTab === 'reports' && (
            <div className="space-y-3">
              {/* Filters */}
              <div className="flex gap-2 flex-wrap">
                <Select value={reportFilter.status || "all"} onValueChange={(v) => setReportFilter(f => ({ ...f, status: v === "all" ? "" : v }))}>
                  <SelectTrigger className="w-40 bg-muted border-border">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="under_review">Under Review</SelectItem>
                    <SelectItem value="action_taken">Action Taken</SelectItem>
                    <SelectItem value="no_violation">No Violation</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={reportFilter.reason || "all"} onValueChange={(v) => setReportFilter(f => ({ ...f, reason: v === "all" ? "" : v }))}>
                  <SelectTrigger className="w-40 bg-muted border-border">
                    <SelectValue placeholder="Reason" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Reasons</SelectItem>
                    <SelectItem value="spam">Spam</SelectItem>
                    <SelectItem value="inappropriate_content">Inappropriate</SelectItem>
                    <SelectItem value="harassment">Harassment</SelectItem>
                    <SelectItem value="fraud">Fraud</SelectItem>
                    <SelectItem value="fake_profile">Fake Profile</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Reports List */}
              {reports.length === 0 ? (
                <Card className={cardBgClass}>
                  <CardContent className="py-12 text-center">
                    <Flag className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                    <p className={textSecondary}>No reports found</p>
                  </CardContent>
                </Card>
              ) : (
                reports.map(report => (
                  <Card key={report.id} className={`${cardBgClass}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <StatusBadge status={report.status} />
                            <PriorityBadge priority={report.priority} />
                            <Badge variant="outline" className="text-xs capitalize">
                              {report.report_type}
                            </Badge>
                          </div>
                          
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-sm ${textSecondary}`}>Reason:</span>
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 capitalize">
                              {report.reason?.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          
                          {report.description && (
                            <p className={`text-sm ${textSecondary} line-clamp-2`}>{report.description}</p>
                          )}
                          
                          <div className="flex items-center gap-4 mt-3 text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="text-gray-500">Reporter:</span>
                              <Avatar className="w-5 h-5">
                                <AvatarImage src={getFullUrl(report.reporter?.avatar_url)} />
                                <AvatarFallback>{report.reporter?.full_name?.[0]}</AvatarFallback>
                              </Avatar>
                              <span className={textSecondary}>{report.reporter?.full_name}</span>
                            </div>
                            {report.reported_user && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-gray-500">Reported:</span>
                                <Avatar className="w-5 h-5">
                                  <AvatarImage src={getFullUrl(report.reported_user?.avatar_url)} />
                                  <AvatarFallback>{report.reported_user?.full_name?.[0]}</AvatarFallback>
                                </Avatar>
                                <span className={textSecondary}>{report.reported_user?.full_name}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="shrink-0 flex flex-col gap-2 items-end">
                          <p className={`text-xs ${textSecondary}`}>{formatDate(report.created_at)}</p>
                          {report.status === 'pending' && (
                            <Button
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedReport(report);
                                setShowReportReview(true);
                              }}
                              className="bg-blue-500 hover:bg-blue-600"
                            >
                              Review
                            </Button>
                          )}
                          {report.action_taken && (
                            <Badge className="bg-green-500/20 text-green-400 text-xs capitalize">
                              {report.action_taken?.replace(/_/g, ' ')}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* PAYOUT HOLDS TAB */}
          {activeSubTab === 'holds' && (
            <div className="space-y-3">
              {/* Summary Card */}
              <Card className={`${cardBgClass} border-orange-500/30`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-orange-500/20 rounded-lg">
                        <Wallet className="w-6 h-6 text-orange-400" />
                      </div>
                      <div>
                        <p className={textSecondary}>Total Amount Held</p>
                        <p className="text-2xl font-bold text-orange-400">${totalHeldAmount.toFixed(2)}</p>
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setShowCreateHold(true)} className="bg-orange-500 hover:bg-orange-600">
                      Create Hold
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Holds List */}
              {payoutHolds.length === 0 ? (
                <Card className={cardBgClass}>
                  <CardContent className="py-12 text-center">
                    <Wallet className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                    <p className={textSecondary}>No active payout holds</p>
                  </CardContent>
                </Card>
              ) : (
                payoutHolds.map(hold => (
                  <Card key={hold.id} className={`${cardBgClass} ${hold.is_active ? 'border-orange-500/30' : ''}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={getFullUrl(hold.photographer?.avatar_url)} />
                            <AvatarFallback>{hold.photographer?.full_name?.[0]}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className={`font-medium ${textClass}`}>{hold.photographer?.full_name}</p>
                            <p className={`text-sm ${textSecondary}`}>{hold.photographer?.email}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge 
                                className={hold.is_active ? 'bg-orange-500/20 text-orange-400' : 'bg-gray-500/20 text-muted-foreground'}
                              >
                                {hold.is_active ? 'Active' : 'Released'}
                              </Badge>
                              <Badge variant="outline" className="capitalize text-xs">
                                {hold.reason?.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        
                        <div className="text-right">
                          <p className="text-xl font-bold text-orange-400">${hold.amount}</p>
                          <p className={`text-xs ${textSecondary}`}>{formatDate(hold.created_at)}</p>
                          {hold.is_active && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleReleaseHold(hold.id)}
                              disabled={actionLoading}
                              className="mt-2 border-green-500 text-green-400 hover:bg-green-500/10"
                            >
                              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Release'}
                            </Button>
                          )}
                        </div>
                      </div>
                      {hold.description && (
                        <p className={`text-sm ${textSecondary} mt-2 pl-12`}>{hold.description}</p>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* AUDIT LOGS TAB */}
          {activeSubTab === 'audit' && (
            <div className="space-y-3">
              {/* Filters */}
              <div className="flex gap-2">
                <Select value={auditFilter.category || "all"} onValueChange={(v) => setAuditFilter(f => ({ ...f, category: v === "all" ? "" : v }))}>
                  <SelectTrigger className="w-40 bg-muted border-border">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    <SelectItem value="auth">Auth</SelectItem>
                    <SelectItem value="user_mgmt">User Management</SelectItem>
                    <SelectItem value="financial">Financial</SelectItem>
                    <SelectItem value="content">Content</SelectItem>
                    <SelectItem value="dispute">Dispute</SelectItem>
                    <SelectItem value="report">Report</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={fetchAuditLogs}>
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>

              {/* Logs List */}
              {auditLogs.length === 0 ? (
                <Card className={cardBgClass}>
                  <CardContent className="py-12 text-center">
                    <FileText className="w-12 h-12 mx-auto text-gray-500 mb-3" />
                    <p className={textSecondary}>No audit logs found</p>
                  </CardContent>
                </Card>
              ) : (
                <Card className={cardBgClass}>
                  <CardContent className="p-0">
                    <div className="divide-y divide-zinc-800">
                      {auditLogs.map(log => (
                        <div key={log.id} className="p-3 hover:bg-muted/50 transition-colors">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge 
                                  className={`text-xs ${
                                    log.is_admin_action ? 'bg-red-500/20 text-red-400' : 
                                    log.is_system_action ? 'bg-blue-500/20 text-blue-400' : 
                                    'bg-gray-500/20 text-muted-foreground'
                                  }`}
                                >
                                  {log.is_admin_action ? 'Admin' : log.is_system_action ? 'System' : 'User'}
                                </Badge>
                                <Badge variant="outline" className="text-xs capitalize">
                                  {log.category}
                                </Badge>
                              </div>
                              <p className={`font-medium ${textClass}`}>{log.action?.replace(/_/g, ' ')}</p>
                              {log.description && (
                                <p className={`text-sm ${textSecondary}`}>{log.description}</p>
                              )}
                              <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                                {log.actor && (
                                  <span>By: {log.actor?.full_name || log.actor_email}</span>
                                )}
                                {log.target_email && (
                                  <span>• Target: {log.target_email}</span>
                                )}
                              </div>
                            </div>
                            <p className={`text-xs ${textSecondary} shrink-0`}>{formatDate(log.created_at)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      {/* Dispute Detail Modal */}
      <Dialog open={showDisputeDetail} onOpenChange={setShowDisputeDetail}>
        <DialogContent className="bg-card border-border text-foreground max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="w-5 h-5 text-red-400" />
              Dispute Details
            </DialogTitle>
          </DialogHeader>
          
          {selectedDispute && (
            <div className="space-y-4">
              {/* Status & Actions */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedDispute.status} />
                  <PriorityBadge priority={selectedDispute.priority} />
                </div>
                <div className="flex gap-2">
                  <Select
                    value={selectedDispute.status}
                    onValueChange={(v) => handleUpdateDispute(selectedDispute.id, { status: v })}
                  >
                    <SelectTrigger className="w-40 bg-muted border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="under_review">Under Review</SelectItem>
                      <SelectItem value="awaiting_response">Awaiting Response</SelectItem>
                      <SelectItem value="escalated">Escalate</SelectItem>
                      <SelectItem value="resolved_refund">Resolve (Refund)</SelectItem>
                      <SelectItem value="resolved_no_action">Resolve (No Action)</SelectItem>
                      <SelectItem value="closed">Close</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Subject & Description */}
              <div>
                <h3 className="font-semibold text-lg">{selectedDispute.subject}</h3>
                <p className="text-muted-foreground mt-1">{selectedDispute.description}</p>
              </div>

              {/* Parties */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-gray-500 mb-2">Complainant</p>
                  <div className="flex items-center gap-2">
                    <Avatar>
                      <AvatarImage src={getFullUrl(selectedDispute.complainant?.avatar_url)} />
                      <AvatarFallback>{selectedDispute.complainant?.full_name?.[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{selectedDispute.complainant?.full_name}</p>
                      <p className="text-xs text-muted-foreground">{selectedDispute.complainant?.email}</p>
                    </div>
                  </div>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-gray-500 mb-2">Respondent</p>
                  <div className="flex items-center gap-2">
                    <Avatar>
                      <AvatarImage src={getFullUrl(selectedDispute.respondent?.avatar_url)} />
                      <AvatarFallback>{selectedDispute.respondent?.full_name?.[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{selectedDispute.respondent?.full_name}</p>
                      <p className="text-xs text-muted-foreground">{selectedDispute.respondent?.email}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Amount */}
              {selectedDispute.amount_disputed && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Amount Disputed</span>
                    <span className="text-xl font-bold text-red-400">${selectedDispute.amount_disputed}</span>
                  </div>
                  {selectedDispute.amount_refunded && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-red-500/20">
                      <span className="text-muted-foreground">Amount Refunded (Credit)</span>
                      <span className="text-green-400">${selectedDispute.amount_refunded}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Refund Input */}
              {['open', 'under_review', 'escalated'].includes(selectedDispute.status) && selectedDispute.amount_disputed && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="Refund amount"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    className="bg-muted border-border w-32"
                  />
                  <Button
                    onClick={() => handleUpdateDispute(selectedDispute.id, {
                      status: 'resolved_refund',
                      amount_refunded: parseFloat(refundAmount)
                    })}
                    disabled={!refundAmount || actionLoading}
                    className="bg-green-500 hover:bg-green-600"
                  >
                    Issue Credit Refund
                  </Button>
                </div>
              )}

              {/* Messages Thread */}
              <div>
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Messages ({selectedDispute.messages?.length || 0})
                </h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {selectedDispute.messages?.map(msg => (
                    <div 
                      key={msg.id} 
                      className={`p-2 rounded-lg ${msg.is_admin ? 'bg-red-500/10 border border-red-500/30' : 'bg-muted'}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Avatar className="w-5 h-5">
                          <AvatarImage src={getFullUrl(msg.sender?.avatar_url)} />
                          <AvatarFallback className="text-xs">{msg.sender?.full_name?.[0]}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium">{msg.sender?.full_name}</span>
                        {msg.is_admin && <Badge className="text-xs bg-red-500/20 text-red-400">Admin</Badge>}
                        <span className="text-xs text-gray-500">{formatDate(msg.created_at)}</span>
                      </div>
                      <p className="text-sm text-gray-300">{msg.message}</p>
                    </div>
                  ))}
                </div>
                
                {/* New Message */}
                <div className="flex gap-2 mt-3">
                  <Input
                    placeholder="Type a message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    className="bg-muted border-border"
                    onKeyPress={(e) => e.key === 'Enter' && handleAddDisputeMessage(selectedDispute.id)}
                  />
                  <Button
                    onClick={() => handleAddDisputeMessage(selectedDispute.id)}
                    disabled={!newMessage.trim() || actionLoading}
                    className="bg-blue-500 hover:bg-blue-600"
                  >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Report Review Modal */}
      <Dialog open={showReportReview} onOpenChange={setShowReportReview}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="w-5 h-5 text-orange-400" />
              Review Report
            </DialogTitle>
          </DialogHeader>
          
          {selectedReport && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Report Type</p>
                <Badge variant="outline" className="capitalize">{selectedReport.report_type}</Badge>
              </div>
              
              <div>
                <p className="text-sm text-muted-foreground mb-1">Reason</p>
                <Badge className="bg-red-500/20 text-red-400 capitalize">
                  {selectedReport.reason?.replace(/_/g, ' ')}
                </Badge>
              </div>
              
              {selectedReport.description && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Description</p>
                  <p className="text-foreground">{selectedReport.description}</p>
                </div>
              )}
              
              <div>
                <p className="text-sm text-muted-foreground mb-2">Take Action</p>
                <Select value={reviewAction} onValueChange={setReviewAction}>
                  <SelectTrigger className="bg-muted border-border">
                    <SelectValue placeholder="Select action..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no_action">No Action Needed</SelectItem>
                    <SelectItem value="warning_sent">Send Warning</SelectItem>
                    <SelectItem value="content_removed">Remove Content</SelectItem>
                    <SelectItem value="user_suspended">Suspend User</SelectItem>
                    <SelectItem value="user_banned">Ban User</SelectItem>
                    <SelectItem value="escalate">Escalate to Dispute</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <p className="text-sm text-muted-foreground mb-2">Admin Notes</p>
                <Textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="Add notes about this decision..."
                  className="bg-muted border-border"
                />
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReportReview(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleReviewReport(selectedReport?.id)}
              disabled={!reviewAction || actionLoading}
              className="bg-blue-500 hover:bg-blue-600"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Submit Review
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminModerationDashboard;
