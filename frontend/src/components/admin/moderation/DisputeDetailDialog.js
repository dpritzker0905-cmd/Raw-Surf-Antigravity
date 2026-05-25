import React, { useState } from 'react';
import { MessageSquare, Loader2, Send, Scale } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../../ui/avatar';
import { Badge } from '../../ui/badge';
import { getFullUrl } from '../../../utils/media';

const STATUS_STYLES = {
  open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  under_review: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  awaiting_response: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  resolved_refund: 'bg-green-500/20 text-green-400 border-green-500/30',
  resolved_no_action: 'bg-gray-500/20 text-muted-foreground border-gray-500/30',
  resolved_partial: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
  escalated: 'bg-red-500/20 text-red-400 border-red-500/30',
  closed: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
};

const PRIORITY_STYLES = { 
  low: 'bg-gray-500/20 text-muted-foreground', 
  normal: 'bg-blue-500/20 text-blue-400', 
  high: 'bg-orange-500/20 text-orange-400', 
  urgent: 'bg-red-500/20 text-red-400 animate-pulse' 
};

const StatusBadge = ({ status }) => (
  <Badge className={`text-xs ${STATUS_STYLES[status] || 'bg-zinc-500/20 text-zinc-400'}`}>
    {status?.replace(/_/g, ' ')}
  </Badge>
);

const PriorityBadge = ({ priority }) => (
  <Badge className={`text-xs ${PRIORITY_STYLES[priority] || PRIORITY_STYLES.normal}`}>
    {priority}
  </Badge>
);

export const DisputeDetailDialog = ({
  isOpen,
  onClose,
  selectedDispute,
  handleUpdateDispute,
  handleAddDisputeMessage,
  actionLoading,
  formatDate,
}) => {
  const [refundAmount, setRefundAmount] = useState('');
  const [newMessage, setNewMessage] = useState('');

  if (!selectedDispute) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-red-400" />
            Dispute Details
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
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
                  {[['open','Open'],['under_review','Under Review'],['awaiting_response','Awaiting Response'],['escalated','Escalate'],['resolved_refund','Resolve (Refund)'],['resolved_no_action','Resolve (No Action)'],['closed','Close']].map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-lg">{selectedDispute.subject}</h3>
            <p className="text-muted-foreground mt-1">{selectedDispute.description}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[['Complainant', selectedDispute.complainant], ['Respondent', selectedDispute.respondent]].map(([label, person]) => (
              <div key={label} className="p-3 bg-muted rounded-lg">
                <p className="text-xs text-gray-500 mb-2">{label}</p>
                <div className="flex items-center gap-2">
                  <Avatar>
                    <AvatarImage src={getFullUrl(person?.avatar_url)} />
                    <AvatarFallback>{person?.full_name?.[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium">{person?.full_name}</p>
                    <p className="text-xs text-muted-foreground">{person?.email}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

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

          {['open', 'under_review', 'escalated'].includes(selectedDispute.status) && selectedDispute.amount_disputed && (
            <div className="flex items-center gap-2">
              <Input aria-label="Refund amount"
                type="number"
                placeholder="Refund amount"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="bg-muted border-border w-32"
              />
              <Button
                onClick={() => {
                  handleUpdateDispute(selectedDispute.id, {
                    status: 'resolved_refund',
                    amount_refunded: parseFloat(refundAmount)
                  });
                  setRefundAmount('');
                }}
                disabled={!refundAmount || actionLoading}
                className="bg-green-500 hover:bg-green-600"
              >
                Issue Credit Refund
              </Button>
            </div>
          )}

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
            
            <div className="flex gap-2 mt-3">
              <Input aria-label="Type a message..."
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="bg-muted border-border"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && newMessage.trim()) {
                    handleAddDisputeMessage(selectedDispute.id, newMessage);
                    setNewMessage('');
                  }
                }}
              />
              <Button aria-label="Loader2"
                onClick={() => {
                  if (newMessage.trim()) {
                    handleAddDisputeMessage(selectedDispute.id, newMessage);
                    setNewMessage('');
                  }
                }}
                disabled={!newMessage.trim() || actionLoading}
                className="bg-blue-500 hover:bg-blue-600"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DisputeDetailDialog;
