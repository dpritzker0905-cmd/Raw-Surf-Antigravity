import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import apiClient from '../../lib/apiClient';
import { Send, AlertTriangle,
  Loader2, RefreshCw, Search
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { toast } from 'sonner';
import logger from '../../utils/logger';
import { newSupportRequestId } from '../support/supportRoutes';

const EMPTY_DRAFT = { text: '', isInternalNote: false };
const TICKET_PAGE_SIZE = 50;
const INITIAL_TICKET_QUERY = { offset: 0, status: 'all', priority: 'all', search: '' };

/**
 * Admin Support Dashboard - Ticketing System
 * - Centralized ticket management
 * - Ticket routing, prioritization, SLA tracking
 * - Response time metrics and CSAT tracking
 */
export const AdminSupportDashboard = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState([]);
  const [ticketTotal, setTicketTotal] = useState(null);
  const [listError, setListError] = useState(null);
  const [ticketQuery, setTicketQuery] = useState(INITIAL_TICKET_QUERY);
  const listContext = useRef({ query: INITIAL_TICKET_QUERY, request: 0, pending: false });
  const [metrics, setMetrics] = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState(null);
  const metricsRequest = useRef(0);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const ticketContext = useRef({ selected: null, request: 0, account: 0, actionPending: false });
  
  // Filters
  const statusFilter = ticketQuery.status;
  const priorityFilter = ticketQuery.priority;
  const [searchQuery, setSearchQuery] = useState('');
  
  // Reply
  const [replyDrafts, setReplyDrafts] = useState({});
  const replyRequestIds = useRef(new WeakMap());
  const [actionTicket, setActionTicket] = useState(null);
  const replyDraft = replyDrafts[selectedTicket] || EMPTY_DRAFT;
  const replyText = replyDraft.text;
  const isInternalNote = replyDraft.isInternalNote;
  const actionLoading = actionTicket !== null;
  const selectedActionLoading = actionLoading && actionTicket === selectedTicket;

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-card/50 border-border';
  const textClass = isLight ? 'text-gray-900' : 'text-foreground';
  const _textSecondary = isLight ? 'text-gray-600' : 'text-muted-foreground';

  useEffect(() => {
    const context = ticketContext.current;
    context.account += 1;
    context.selected = null;
    context.request += 1;
    context.actionPending = false;
    setSelectedTicket(null);
    setTicketDetail(null);
    setDetailLoading(false);
    setDetailError(null);
    setReplyDrafts({});
    setActionTicket(null);
    listContext.current.query = INITIAL_TICKET_QUERY;
    listContext.current.request += 1;
    listContext.current.pending = false;
    setTicketQuery(INITIAL_TICKET_QUERY);
    setSearchQuery('');
    setTickets([]);
    setTicketTotal(null);
    setListError(null);
    setLoading(Boolean(user?.id));
    metricsRequest.current += 1;
    setMetrics(null);
    setMetricsError(null);
    setMetricsLoading(Boolean(user?.id));
    return () => {
      // Invalidate both detail reads and mutation callbacks on exit/account change.
      context.account += 1;
      context.selected = null;
      context.request += 1;
      context.actionPending = false;
      listContext.current.request += 1;
      listContext.current.pending = false;
      metricsRequest.current += 1;
    };
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      fetchTickets();
      fetchMetrics();
    }
  }, [user?.id]);

  const fetchTickets = async (query = listContext.current.query) => {
    if (!user?.id) return;
    const context = listContext.current;
    const account = ticketContext.current.account;
    const request = ++context.request;
    const isCurrent = () => ticketContext.current.account === account && context.request === request;
    context.query = query;
    context.pending = true;
    setTicketQuery(query);
    setLoading(true);
    setListError(null);
    setTickets([]);
    setTicketTotal(null);
    try {
      const params = new URLSearchParams({ limit: String(TICKET_PAGE_SIZE), offset: String(query.offset) });
      if (query.status !== 'all') params.set('status', query.status);
      if (query.priority !== 'all') params.set('priority', query.priority);
      if (query.search) params.set('search', query.search);
      const response = await apiClient.get(`/admin/support/tickets?${params}`);
      if (!isCurrent()) return;
      const { tickets: rows, total } = response.data;
      if (!Array.isArray(rows) || !Number.isInteger(total) || total < 0) throw new Error('Invalid ticket page');
      // A refresh/update may remove the last matching rows. Read the last valid page.
      const lastOffset = Math.max(0, Math.ceil(total / TICKET_PAGE_SIZE) - 1) * TICKET_PAGE_SIZE;
      if (query.offset > lastOffset) return fetchTickets({ ...query, offset: lastOffset });
      setTickets(rows);
      setTicketTotal(total);
    } catch (error) {
      if (isCurrent()) {
        setListError('Failed to load tickets');
        logger.error('Failed to load tickets:', error);
      }
    } finally {
      if (isCurrent()) {
        context.pending = false;
        setLoading(false);
      }
    }
  };

  const changeTicketFilter = (field, value) => {
    fetchTickets({ ...listContext.current.query, [field]: value, offset: 0 });
  };

  const searchTickets = () => changeTicketFilter('search', searchQuery.trim());

  const changeTicketPage = (direction) => {
    const context = listContext.current;
    if (context.pending || listError || ticketTotal === null) return;
    const offset = context.query.offset + direction * TICKET_PAGE_SIZE;
    if (offset < 0 || offset >= ticketTotal) return;
    fetchTickets({ ...context.query, offset });
  };

  const fetchMetrics = async () => {
    if (!user?.id) return;
    const account = ticketContext.current.account;
    const request = ++metricsRequest.current;
    const isCurrent = () => ticketContext.current.account === account && metricsRequest.current === request;
    setMetrics(null);
    setMetricsError(null);
    setMetricsLoading(true);
    try {
      const response = await apiClient.get(`/admin/support/metrics?days=30`);
      if (isCurrent()) setMetrics(response.data);
    } catch (error) {
      if (isCurrent()) {
        setMetricsError('Failed to load support metrics');
        logger.error('Failed to load metrics:', error);
      }
    } finally {
      if (isCurrent()) setMetricsLoading(false);
    }
  };

  const fetchTicketDetail = async (ticketId) => {
    const context = ticketContext.current;
    if (context.selected !== ticketId) return;
    const account = context.account;
    const request = ++context.request;
    const isCurrent = () => context.account === account
      && context.selected === ticketId && context.request === request;
    setTicketDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const response = await apiClient.get(`/admin/support/tickets/${ticketId}`);
      if (!isCurrent()) return;
      if (response.data?.id !== ticketId) throw new Error('Ticket detail identity mismatch');
      setTicketDetail(response.data);
    } catch (error) {
      if (isCurrent()) setDetailError('Failed to load ticket details');
    } finally {
      if (isCurrent()) setDetailLoading(false);
    }
  };

  const selectTicket = (ticketId) => {
    // The ref changes synchronously, before any older request can settle.
    ticketContext.current.selected = ticketId;
    setSelectedTicket(ticketId);
    fetchTicketDetail(ticketId);
  };

  const updateReplyDraft = (changes) => {
    if (ticketContext.current.selected !== selectedTicket) return;
    setReplyDrafts(drafts => ({
      ...drafts, [selectedTicket]: { ...(drafts[selectedTicket] || EMPTY_DRAFT), ...changes }
    }));
  };

  const handleUpdateTicket = async (ticketId, updates) => {
    const context = ticketContext.current;
    if (context.selected !== ticketId || ticketDetail?.id !== ticketId || context.actionPending) return;
    const account = context.account;
    context.actionPending = true;
    setActionTicket(ticketId);
    try {
      await apiClient.put(`/admin/support/tickets/${ticketId}`, updates);
      if (context.account !== account) return;
      toast.success('Ticket updated');
      fetchMetrics();
      fetchTickets();
      fetchTicketDetail(ticketId);
    } catch (error) {
      if (context.account === account) toast.error('Failed to update ticket');
    } finally {
      if (context.account === account) {
        context.actionPending = false;
        setActionTicket(null);
      }
    }
  };

  const handleReply = async () => {
    const context = ticketContext.current;
    if (!replyText.trim() || !ticketDetail || ticketDetail.id !== context.selected || context.actionPending) return;
    const ticketId = ticketDetail.id;
    const account = context.account;
    const submittedDraft = replyDraft;
    const requestId = replyRequestIds.current.get(submittedDraft) || newSupportRequestId();
    replyRequestIds.current.set(submittedDraft, requestId);
    context.actionPending = true;
    setActionTicket(ticketId);
    try {
      await apiClient.post(`/admin/support/tickets/${ticketId}/reply`, {
        message: submittedDraft.text,
        is_internal_note: submittedDraft.isInternalNote,
        client_message_id: requestId,
      });
      if (context.account !== account) return;
      toast.success(submittedDraft.isInternalNote ? 'Note added' : 'Reply sent');
      fetchMetrics();
      setReplyDrafts(drafts => {
        // Clear only the submitted version, never another ticket or a newer draft.
        if (drafts[ticketId] !== submittedDraft) return drafts;
        const remaining = { ...drafts };
        delete remaining[ticketId];
        return remaining;
      });
      fetchTicketDetail(ticketId);
    } catch (error) {
      if (context.account === account) toast.error('Failed to send reply');
    } finally {
      if (context.account === account) {
        context.actionPending = false;
        setActionTicket(null);
      }
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/50';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      case 'low': return 'bg-green-500/20 text-green-400 border-green-500/50';
      default: return 'bg-gray-500/20 text-muted-foreground border-gray-500/50';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'open': return 'bg-blue-500/20 text-blue-400';
      case 'in_progress': return 'bg-purple-500/20 text-purple-400';
      case 'waiting_user': return 'bg-yellow-500/20 text-yellow-400';
      case 'resolved': return 'bg-green-500/20 text-green-400';
      case 'closed': return 'bg-gray-500/20 text-muted-foreground';
      default: return 'bg-gray-500/20 text-muted-foreground';
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
    });
  };

  return (
    <div className="space-y-4" data-testid="admin-support-dashboard">
      {/* Metrics Row */}
      <section aria-label="Support metrics" aria-busy={metricsLoading}>
      {metricsLoading ? (
        <p className="text-sm text-muted-foreground py-3" aria-live="polite">Loading support metrics...</p>
      ) : metricsError ? (
        <div className="flex flex-wrap items-center gap-2 py-3">
          <p role="alert" className="text-sm text-muted-foreground">{metricsError}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => fetchMetrics()}>Retry support metrics</Button>
        </div>
      ) : !metrics ? (
        <p className="text-sm text-muted-foreground py-3">Support metrics are not available</p>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card className={`${cardBgClass} border-blue-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Open Tickets</p>
              <p className="text-2xl font-bold text-blue-400">{metrics.open_tickets}</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-green-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Resolved / closed</p>
              <p className="text-2xl font-bold text-green-400">{metrics.resolved_tickets}</p>
              <p className="text-[10px] text-muted-foreground">Tickets created in last 30 days</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-cyan-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Avg Response</p>
              <p className="text-2xl font-bold text-cyan-400">
                {metrics.first_response_sample_count === 0 ? '—' : `${metrics.avg_first_response_hours}h`}
              </p>
              {Number.isInteger(metrics.first_response_sample_count) && (
                <p className="text-[10px] text-muted-foreground">
                  {metrics.first_response_sample_count === 0 ? 'No response measurements'
                    : `${metrics.first_response_sample_count} response measurement${metrics.first_response_sample_count === 1 ? '' : 's'}`}
                </p>
              )}
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-purple-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Avg Resolution</p>
              <p className="text-2xl font-bold text-purple-400">
                {metrics.resolution_sample_count === 0 ? '—' : `${metrics.avg_resolution_hours}h`}
              </p>
              {Number.isInteger(metrics.resolution_sample_count) && (
                <p className="text-[10px] text-muted-foreground">
                  {metrics.resolution_sample_count === 0 ? 'No resolution measurements'
                    : `${metrics.resolution_sample_count} resolution measurement${metrics.resolution_sample_count === 1 ? '' : 's'}`}
                </p>
              )}
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} ${metrics.sla_breached_count > 0 ? 'border-red-500/30' : 'border-green-500/30'}`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">SLA Breached</p>
              <p className={`text-2xl font-bold ${metrics.sla_breached_count > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {metrics.sla_breached_count}
              </p>
              <p className="text-[10px] text-muted-foreground">Unresolved tickets created in last 30 days</p>
            </CardContent>
          </Card>
        </div>
      )}
      </section>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input aria-label="Search tickets..."
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); searchTickets(); }
              }}
              className="pl-9 bg-muted border-border"
            />
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={searchTickets}>Search tickets</Button>
        <Select value={statusFilter} onValueChange={(value) => changeTicketFilter('status', value)}>
          <SelectTrigger aria-label="Filter ticket status" className="w-40 bg-muted border-border">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent avoidCollisions>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="waiting_user">Waiting User</SelectItem>
            <SelectItem value="waiting_internal">Waiting Internal</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={(value) => changeTicketFilter('priority', value)}>
          <SelectTrigger aria-label="Filter ticket priority" className="w-32 bg-muted border-border">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent avoidCollisions>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" size="sm" variant="outline" onClick={() => { fetchTickets(); fetchMetrics(); }} aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Ticket List & Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ticket List */}
        <Card className={cardBgClass}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-sm ${textClass}`}>
              Tickets{ticketTotal !== null ? ` (${ticketTotal})` : ''}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto" aria-busy={loading}>
            {loading ? (
              <p role="status" className="text-center text-muted-foreground py-8">Loading tickets...</p>
            ) : listError ? (
              <div className="space-y-2 text-center py-8">
                <p role="alert" className="text-muted-foreground">{listError}</p>
                <Button type="button" variant="outline" onClick={() => fetchTickets()}>Retry ticket list</Button>
              </div>
            ) : ticketTotal === null ? (
              <p className="text-center text-muted-foreground py-8">Tickets are not loaded</p>
            ) : tickets.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No tickets found</p>
            ) : (
              <div className="space-y-2">
                {tickets.map(ticket => (
                  <button
                    key={ticket.id}
                    type="button"
                    aria-pressed={selectedTicket === ticket.id}
                    onClick={() => selectTicket(ticket.id)}
                    className={`w-full text-left p-3 rounded-lg cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selectedTicket === ticket.id 
                        ? 'bg-cyan-500/10 border border-cyan-500/50' 
                        : 'bg-muted/50 hover:bg-muted border border-transparent'
                    }`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-gray-500 font-mono">{ticket.ticket_number}</span>
                          <span className={`inline-flex rounded-md border px-2.5 py-0.5 text-[10px] ${getPriorityColor(ticket.priority)}`}>
                            {ticket.priority}
                          </span>
                          {ticket.is_sla_breached && (
                            <AlertTriangle aria-label="SLA breached" role="img" className="w-3 h-3 text-red-400" />
                          )}
                        </span>
                        <span className={`block text-sm font-medium ${textClass} truncate`}>{ticket.subject}</span>
                        <span className="block text-xs text-gray-500 truncate">{ticket.user_name} ? {ticket.user_email}</span>
                      </span>
                      <span className={`inline-flex rounded-md px-2.5 py-0.5 text-[10px] ${getStatusColor(ticket.status)}`}>
                        {ticket.status?.replace('_', ' ')}
                      </span>
                    </span>
                    <span className="block text-[10px] text-gray-500 mt-1">{formatDate(ticket.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
          <nav aria-label="Ticket pagination" className="border-t border-border p-4 space-y-2">
            {!loading && !listError && ticketTotal !== null && (
              <div className="text-xs text-muted-foreground space-y-1" aria-live="polite">
                <p>Showing {tickets.length ? ticketQuery.offset + 1 : 0}–{tickets.length ? ticketQuery.offset + tickets.length : 0} of {ticketTotal} tickets</p>
                <p>Page {Math.floor(ticketQuery.offset / TICKET_PAGE_SIZE) + 1} of {Math.max(1, Math.ceil(ticketTotal / TICKET_PAGE_SIZE))}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" aria-label="Previous ticket page"
                disabled={loading || Boolean(listError) || ticketTotal === null || ticketQuery.offset === 0}
                onClick={() => changeTicketPage(-1)}>Previous</Button>
              <Button type="button" size="sm" variant="outline" aria-label="Next ticket page"
                disabled={loading || Boolean(listError) || ticketTotal === null || ticketQuery.offset + TICKET_PAGE_SIZE >= ticketTotal}
                onClick={() => changeTicketPage(1)}>Next</Button>
            </div>
          </nav>
        </Card>

        {/* Ticket Detail */}
        <Card className={cardBgClass}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-sm ${textClass}`}>
              {ticketDetail ? `Ticket: ${ticketDetail.ticket_number}` : 'Select a Ticket'}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto" aria-busy={detailLoading}>
            {detailLoading ? (
              <p role="status" className="text-center text-muted-foreground py-8">Loading ticket details...</p>
            ) : detailError ? (
              <div className="space-y-2 py-8 text-center">
                <p role="alert" className="text-muted-foreground">{detailError}</p>
                <Button type="button" variant="outline" onClick={() => fetchTicketDetail(selectedTicket)}>
                  Retry ticket details
                </Button>
              </div>
            ) : !ticketDetail ? (
              <p className="text-center text-gray-500 py-8">Select a ticket to view details</p>
            ) : (
              <div className="space-y-4">
                {/* Ticket Info */}
                <div className="p-3 bg-muted/50 rounded-lg">
                  <h4 className={`font-medium ${textClass}`}>{ticketDetail.subject}</h4>
                  <p className="text-sm text-muted-foreground mt-1">{ticketDetail.description}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge className={getPriorityColor(ticketDetail.priority)}>{ticketDetail.priority}</Badge>
                    <Badge className={getStatusColor(ticketDetail.status)}>{ticketDetail.status?.replace('_', ' ')}</Badge>
                    <Badge variant="outline" className="text-xs">{ticketDetail.category}</Badge>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="flex flex-wrap gap-2">
                  <Select
                    value={ticketDetail.status}
                    disabled={actionLoading}
                    onValueChange={(v) => handleUpdateTicket(ticketDetail.id, { status: v })}
                  >
                    <SelectTrigger aria-label="Ticket status" className="w-40 h-8 text-xs bg-muted border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent avoidCollisions>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="waiting_user">Waiting User</SelectItem>
                      <SelectItem value="waiting_internal">Waiting Internal</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={ticketDetail.priority}
                    disabled={actionLoading}
                    onValueChange={(v) => handleUpdateTicket(ticketDetail.id, { priority: v })}
                  >
                    <SelectTrigger aria-label="Ticket priority" className="w-24 h-8 text-xs bg-muted border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent avoidCollisions>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Messages */}
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">Conversation</p>
                  {ticketDetail.messages?.map(msg => (
                    <div
                      key={msg.id}
                      className={`p-2 rounded-lg ${
                        msg.is_internal_note 
                          ? 'bg-yellow-500/10 border border-yellow-500/30' 
                          : msg.sender_id === ticketDetail.user?.id
                            ? 'bg-muted'
                            : 'bg-cyan-500/10'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-foreground">{msg.sender_name}</span>
                        {msg.is_internal_note && <Badge className="text-[10px] bg-yellow-500/20 text-yellow-400">Internal</Badge>}
                        <span className="text-[10px] text-gray-500">{formatDate(msg.created_at)}</span>
                      </div>
                      <p className="text-sm text-gray-300">{msg.message}</p>
                    </div>
                  ))}
                </div>

                {/* Reply */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <Textarea aria-label="Type your reply..."
                    placeholder="Type your reply..."
                    value={replyText}
                    onChange={(e) => updateReplyDraft({ text: e.target.value })}
                    disabled={selectedActionLoading}
                    className="bg-muted border-border min-h-[80px]"
                  />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label="Internal note"
                        checked={isInternalNote}
                        onChange={(e) => updateReplyDraft({ isInternalNote: e.target.checked })}
                        disabled={selectedActionLoading}
                        className="rounded border-input"
                      />
                      Internal note
                    </label>
                    <Button type="button"
                      size="sm"
                      onClick={handleReply}
                      disabled={actionLoading || !replyText.trim()}
                      className="bg-cyan-500 hover:bg-cyan-600"
                    >
                      {selectedActionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
                      {isInternalNote ? 'Add Note' : 'Send Reply'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminSupportDashboard;
