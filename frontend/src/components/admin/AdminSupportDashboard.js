import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import axios from 'axios';
import {
  Headphones, MessageSquare, Send, Clock, AlertTriangle,
  Loader2, Plus, RefreshCw, Check, X, User, Mail,
  Tag, ChevronRight, Filter, Search
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { toast } from 'sonner';
import logger from '../../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

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
  const [metrics, setMetrics] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);
  
  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Reply
  const [replyText, setReplyText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const isLight = theme === 'light';
  const cardBgClass = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-800';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';

  useEffect(() => {
    if (user?.id) {
      fetchTickets();
      fetchMetrics();
    }
  }, [user?.id, statusFilter, priorityFilter]);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      let url = `${API}/admin/support/tickets?admin_id=${user.id}&limit=50`;
      if (statusFilter) url += `&status=${statusFilter}`;
      if (priorityFilter) url += `&priority=${priorityFilter}`;
      if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
      
      const response = await axios.get(url);
      setTickets(response.data.tickets || []);
    } catch (error) {
      logger.error('Failed to load tickets:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMetrics = async () => {
    try {
      const response = await axios.get(`${API}/admin/support/metrics?admin_id=${user.id}&days=30`);
      setMetrics(response.data);
    } catch (error) {
      logger.error('Failed to load metrics:', error);
    }
  };

  const fetchTicketDetail = async (ticketId) => {
    try {
      const response = await axios.get(`${API}/admin/support/tickets/${ticketId}?admin_id=${user.id}`);
      setTicketDetail(response.data);
    } catch (error) {
      toast.error('Failed to load ticket details');
    }
  };

  const handleUpdateTicket = async (ticketId, updates) => {
    setActionLoading(true);
    try {
      await axios.put(`${API}/admin/support/tickets/${ticketId}?admin_id=${user.id}`, updates);
      toast.success('Ticket updated');
      fetchTickets();
      if (ticketDetail?.id === ticketId) {
        fetchTicketDetail(ticketId);
      }
    } catch (error) {
      toast.error('Failed to update ticket');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim() || !ticketDetail) return;
    setActionLoading(true);
    try {
      await axios.post(`${API}/admin/support/tickets/${ticketDetail.id}/reply?admin_id=${user.id}`, {
        message: replyText,
        is_internal_note: isInternalNote
      });
      toast.success(isInternalNote ? 'Note added' : 'Reply sent');
      setReplyText('');
      setIsInternalNote(false);
      fetchTicketDetail(ticketDetail.id);
    } catch (error) {
      toast.error('Failed to send reply');
    } finally {
      setActionLoading(false);
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/50';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
      case 'low': return 'bg-green-500/20 text-green-400 border-green-500/50';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/50';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'open': return 'bg-blue-500/20 text-blue-400';
      case 'in_progress': return 'bg-purple-500/20 text-purple-400';
      case 'waiting_user': return 'bg-yellow-500/20 text-yellow-400';
      case 'resolved': return 'bg-green-500/20 text-green-400';
      case 'closed': return 'bg-gray-500/20 text-gray-400';
      default: return 'bg-gray-500/20 text-gray-400';
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
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card className={`${cardBgClass} border-blue-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Open Tickets</p>
              <p className="text-2xl font-bold text-blue-400">{metrics.open_tickets}</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-green-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Resolved ({`30d`})</p>
              <p className="text-2xl font-bold text-green-400">{metrics.resolved_tickets}</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-cyan-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Avg Response</p>
              <p className="text-2xl font-bold text-cyan-400">{metrics.avg_first_response_hours}h</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} border-purple-500/30`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">Avg Resolution</p>
              <p className="text-2xl font-bold text-purple-400">{metrics.avg_resolution_hours}h</p>
            </CardContent>
          </Card>
          <Card className={`${cardBgClass} ${metrics.sla_breached_count > 0 ? 'border-red-500/30' : 'border-green-500/30'}`}>
            <CardContent className="p-3">
              <p className="text-xs text-gray-500">SLA Breached</p>
              <p className={`text-2xl font-bold ${metrics.sla_breached_count > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {metrics.sla_breached_count}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input
              placeholder="Search tickets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchTickets()}
              className="pl-9 bg-zinc-800 border-zinc-700"
            />
          </div>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32 bg-zinc-800 border-zinc-700">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="waiting_user">Waiting User</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-32 bg-zinc-800 border-zinc-700">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={fetchTickets}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Ticket List & Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ticket List */}
        <Card className={cardBgClass}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-sm ${textClass}`}>
              Tickets ({tickets.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : tickets.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No tickets found</p>
            ) : (
              <div className="space-y-2">
                {tickets.map(ticket => (
                  <div
                    key={ticket.id}
                    onClick={() => { setSelectedTicket(ticket.id); fetchTicketDetail(ticket.id); }}
                    className={`p-3 rounded-lg cursor-pointer transition-all ${
                      selectedTicket === ticket.id 
                        ? 'bg-cyan-500/10 border border-cyan-500/50' 
                        : 'bg-zinc-800/50 hover:bg-zinc-800 border border-transparent'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-gray-500 font-mono">{ticket.ticket_number}</span>
                          <Badge className={`text-[10px] ${getPriorityColor(ticket.priority)}`}>
                            {ticket.priority}
                          </Badge>
                          {ticket.is_sla_breached && (
                            <AlertTriangle className="w-3 h-3 text-red-400" />
                          )}
                        </div>
                        <p className={`text-sm font-medium ${textClass} truncate`}>{ticket.subject}</p>
                        <p className="text-xs text-gray-500 truncate">{ticket.user_name} • {ticket.user_email}</p>
                      </div>
                      <Badge className={`text-[10px] ${getStatusColor(ticket.status)}`}>
                        {ticket.status?.replace('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">{formatDate(ticket.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ticket Detail */}
        <Card className={cardBgClass}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-sm ${textClass}`}>
              {ticketDetail ? `Ticket: ${ticketDetail.ticket_number}` : 'Select a Ticket'}
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto">
            {!ticketDetail ? (
              <p className="text-center text-gray-500 py-8">Select a ticket to view details</p>
            ) : (
              <div className="space-y-4">
                {/* Ticket Info */}
                <div className="p-3 bg-zinc-800/50 rounded-lg">
                  <h4 className={`font-medium ${textClass}`}>{ticketDetail.subject}</h4>
                  <p className="text-sm text-gray-400 mt-1">{ticketDetail.description}</p>
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
                    onValueChange={(v) => handleUpdateTicket(ticketDetail.id, { status: v })}
                  >
                    <SelectTrigger className="w-28 h-8 text-xs bg-zinc-800 border-zinc-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="waiting_user">Waiting User</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={ticketDetail.priority}
                    onValueChange={(v) => handleUpdateTicket(ticketDetail.id, { priority: v })}
                  >
                    <SelectTrigger className="w-24 h-8 text-xs bg-zinc-800 border-zinc-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
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
                            ? 'bg-zinc-800'
                            : 'bg-cyan-500/10'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-white">{msg.sender_name}</span>
                        {msg.is_internal_note && <Badge className="text-[10px] bg-yellow-500/20 text-yellow-400">Internal</Badge>}
                        <span className="text-[10px] text-gray-500">{formatDate(msg.created_at)}</span>
                      </div>
                      <p className="text-sm text-gray-300">{msg.message}</p>
                    </div>
                  ))}
                </div>

                {/* Reply */}
                <div className="space-y-2 pt-2 border-t border-zinc-700">
                  <Textarea
                    placeholder="Type your reply..."
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    className="bg-zinc-800 border-zinc-700 min-h-[80px]"
                  />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isInternalNote}
                        onChange={(e) => setIsInternalNote(e.target.checked)}
                        className="rounded border-zinc-600"
                      />
                      Internal note
                    </label>
                    <Button
                      size="sm"
                      onClick={handleReply}
                      disabled={actionLoading || !replyText.trim()}
                      className="bg-cyan-500 hover:bg-cyan-600"
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
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
