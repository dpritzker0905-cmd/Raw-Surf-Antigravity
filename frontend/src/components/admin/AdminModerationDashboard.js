import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import apiClient from '../../lib/apiClient';
import { MessageSquare, FileText, Loader2, RefreshCw, Flag, Scale, Wallet, Send } from 'lucide-react';
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
import DisputeDetailDialog from './moderation/DisputeDetailDialog';
import ReviewReportDialog from './moderation/ReviewReportDialog';

const STATUS_STYLES = {
  open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  under_review: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  awaiting_response: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  resolved_refund: 'bg-green-500/20 text-green-400 border-green-500/30',
  resolved_no_action: 'bg-gray-500/20 text-muted-foreground border-gray-500/30',
  resolved_partial: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  escalated: 'bg-red-500/20 text-red-400 border-red-500/30',
  closed: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  action_taken: 'bg-green-500/20 text-green-400 border-green-500/30',
  no_violation: 'bg-gray-500/20 text-muted-foreground border-gray-500/30',
  dismissed: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};
const PRIORITY_STYLES = { low: 'bg-gray-500/20 text-muted-foreground', normal: 'bg-blue-500/20 text-blue-400', high: 'bg-orange-500/20 text-orange-400', urgent: 'bg-red-500/20 text-red-400 animate-pulse' };
const StatusBadge = ({ status }) => <Badge className={`text-xs ${STATUS_STYLES[status] || 'bg-zinc-500/20 text-zinc-400'}`}>{status?.replace(/_/g, ' ')}</Badge>;
const PriorityBadge = ({ priority }) => <Badge className={`text-xs ${PRIORITY_STYLES[priority] || PRIORITY_STYLES.normal}`}>{priority}</Badge>;

export const AdminModerationDashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [activeSubTab, setActiveSubTab] = useState('disputes');
  const [loading, setLoading] = useState(true);
  
  const [disputes, setDisputes] = useState([]);
  const [disputesTotal, setDisputesTotal] = useState(0);
  const [selectedDispute, setSelectedDispute] = useState(null);
  const [showDisputeDetail, setShowDisputeDetail] = useState(false);
  const [disputeFilter, setDisputeFilter] = useState({ status: '', type: '' });
  
  const [reports, setReports] = useState([]);
  const [pendingReportsCount, setPendingReportsCount] = useState(0);
  const [selectedReport, setSelectedReport] = useState(null);
  const [showReportReview, setShowReportReview] = useState(false);
  const [reportFilter, setReportFilter] = useState({ status: '', reason: '' });
  
  const [payoutHolds, setPayoutHolds] = useState([]);
  const [totalHeldAmount, setTotalHeldAmount] = useState(0);
  const [showCreateHold, setShowCreateHold] = useState(false);
  
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditFilter, setAuditFilter] = useState({ category: '' });
  
  const [newMessage, setNewMessage] = useState('');
  const [reviewAction, setReviewAction] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-card/50 border-border';
  const textClass = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

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
      const p = new URLSearchParams();
      if (disputeFilter.status) p.append('status', disputeFilter.status);
      if (disputeFilter.type) p.append('dispute_type', disputeFilter.type);
      const r = await apiClient.get(`/admin/disputes?${p}`);
      setDisputes(r.data.disputes || []); setDisputesTotal(r.data.total || 0);
    } catch (e) { toast.error('Failed to load disputes'); } finally { setLoading(false); }
  };

  const fetchReports = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (reportFilter.status) p.append('status', reportFilter.status);
      if (reportFilter.reason) p.append('reason', reportFilter.reason);
      const r = await apiClient.get(`/admin/reports?${p}`);
      setReports(r.data.reports || []); setPendingReportsCount(r.data.pending_count || 0);
    } catch (e) { toast.error('Failed to load reports'); } finally { setLoading(false); }
  };

  const fetchPayoutHolds = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/admin/payout-holds`);
      setPayoutHolds(response.data.holds || []); setTotalHeldAmount(response.data.total_held_amount || 0);
    } catch (error) { toast.error('Failed to load payout holds'); } finally { setLoading(false); }
  };

  const fetchAuditLogs = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: '100' });
      if (auditFilter.category) p.append('category', auditFilter.category);
      const r = await apiClient.get(`/admin/audit-logs?${p}`);
      setAuditLogs(r.data.logs || []);
    } catch (e) { toast.error('Failed to load audit logs'); } finally { setLoading(false); }
  };

  const fetchDisputeDetail = async (disputeId) => {
    try {
      const response = await apiClient.get(`/admin/disputes/${disputeId}`);
      setSelectedDispute(response.data); setShowDisputeDetail(true);
    } catch (error) { toast.error('Failed to load dispute details'); }
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

  const handleAddDisputeMessage = async (disputeId, messageText) => {
    setActionLoading(true);
    try {
      await apiClient.post(`/admin/disputes/${disputeId}/messages`, {
        message: messageText,
        is_internal: false
      });
      toast.success('Message sent');
      fetchDisputeDetail(disputeId);
    } catch (error) {
      toast.error('Failed to send message');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReviewReport = async (reportId, payload) => {
    setActionLoading(true);
    try {
      await apiClient.put(`/admin/reports/${reportId}/review`, payload);
      toast.success('Report reviewed');
      setShowReportReview(false);
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
      await apiClient.post(`/admin/payout-holds/${holdId}/release`, { release_notes: 'Admin released hold' });
      toast.success('Hold released'); fetchPayoutHolds();
    } catch (error) { toast.error('Failed to release hold'); } finally { setActionLoading(false); }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-4" data-testid="admin-moderation-dashboard">
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
          { id: 'disputes', label: 'Disputes', icon: Scale, count: disputesTotal },
          { id: 'reports', label: 'Reports', icon: Flag, count: pendingReportsCount },
          { id: 'holds', label: 'Payout Holds', icon: Wallet, count: payoutHolds.filter(h => h.is_active).length },
          { id: 'audit', label: 'Audit Logs', icon: FileText },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-200 border flex-shrink-0 ${
              activeSubTab === tab.id 
                ? 'bg-red-600 text-white border-red-600 shadow-md shadow-red-600/10' 
                : theme === 'beach'
                  ? 'bg-amber-100/50 text-amber-900 border-amber-200/60 hover:bg-amber-200/60 hover:text-amber-950'
                  : isLight
                    ? 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100 hover:text-black'
                    : 'bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:bg-zinc-800/50 hover:text-zinc-100'
            }`}
            data-testid={`moderation-tab-${tab.id}`}
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

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {activeSubTab === 'disputes' && (
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <Select value={disputeFilter.status || "all"} onValueChange={(v) => setDisputeFilter(f => ({ ...f, status: v === "all" ? "" : v }))}>
                  <SelectTrigger className="w-40 bg-muted border-border">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {[['all','All Status'],['open','Open'],['under_review','Under Review'],['escalated','Escalated'],['resolved_refund','Resolved (Refund)'],['closed','Closed']].map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={disputeFilter.type || "all"} onValueChange={(v) => setDisputeFilter(f => ({ ...f, type: v === "all" ? "" : v }))}>
                  <SelectTrigger className="w-40 bg-muted border-border">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {[['all','All Types'],['payment','Payment'],['service_quality','Service Quality'],['no_show','No Show'],['harassment','Harassment'],['fraud','Fraud']].map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={fetchDisputes} aria-label="Refresh">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>

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

          {activeSubTab === 'reports' && (
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <Select value={reportFilter.status || "all"} onValueChange={(v) => setReportFilter(f => ({ ...f, status: v === "all" ? "" : v }))}>
                  <SelectTrigger className="w-40 bg-muted border-border">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    {[['all','All Status'],['pending','Pending'],['under_review','Under Review'],['action_taken','Action Taken'],['no_violation','No Violation']].map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={reportFilter.reason || "all"} onValueChange={(v) => setReportFilter(f => ({ ...f, reason: v === "all" ? "" : v }))}>
                  <SelectTrigger className="w-40 bg-muted border-border">
                    <SelectValue placeholder="Reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {[['all','All Reasons'],['spam','Spam'],['inappropriate_content','Inappropriate'],['harassment','Harassment'],['fraud','Fraud'],['fake_profile','Fake Profile']].map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

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

          {activeSubTab === 'holds' && (
            <div className="space-y-3">
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
                            <Button aria-label="Loader2"
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

          {activeSubTab === 'audit' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Select value={auditFilter.category || "all"} onValueChange={(v) => setAuditFilter(f => ({ ...f, category: v === "all" ? "" : v }))}>
                  <SelectTrigger className="w-40 bg-muted border-border">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {[['all','All Categories'],['auth','Auth'],['user_mgmt','User Management'],['financial','Financial'],['content','Content'],['dispute','Dispute'],['report','Report'],['admin','Admin']].map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={fetchAuditLogs} aria-label="Refresh">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>

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
                                  <span>- Target: {log.target_email}</span>
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

      <DisputeDetailDialog
        isOpen={showDisputeDetail}
        onClose={() => setShowDisputeDetail(false)}
        selectedDispute={selectedDispute}
        handleUpdateDispute={handleUpdateDispute}
        handleAddDisputeMessage={handleAddDisputeMessage}
        actionLoading={actionLoading}
        formatDate={formatDate}
      />

      <ReviewReportDialog
        isOpen={showReportReview}
        onClose={() => setShowReportReview(false)}
        selectedReport={selectedReport}
        handleReviewReport={handleReviewReport}
        actionLoading={actionLoading}
      />
    </div>
  );
};

export default AdminModerationDashboard;
