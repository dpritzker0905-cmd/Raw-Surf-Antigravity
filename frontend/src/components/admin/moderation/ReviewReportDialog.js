import React, { useState } from 'react';
import { Flag, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../ui/dialog';
import { Badge } from '../../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Textarea } from '../../ui/textarea';
import { Button } from '../../ui/button';

export const ReviewReportDialog = ({
  isOpen,
  onClose,
  selectedReport,
  handleReviewReport,
  actionLoading,
}) => {
  const [reviewAction, setReviewAction] = useState('');
  const [adminNotes, setAdminNotes] = useState('');

  if (!selectedReport) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="w-5 h-5 text-orange-400" />
            Review Report
          </DialogTitle>
        </DialogHeader>
        
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
                {[['no_action','No Action Needed'],['warning_sent','Send Warning'],['content_removed','Remove Content'],['user_suspended','Suspend User'],['user_banned','Ban User'],['escalate','Escalate to Dispute']].map(([v,l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <p className="text-sm text-muted-foreground mb-2">Admin Notes</p>
            <Textarea aria-label="Add notes about this decision..."
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="Add notes about this decision..."
              className="bg-muted border-border"
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button aria-label="Loader2"
            onClick={() => {
              handleReviewReport(selectedReport.id, {
                action_taken: reviewAction,
                admin_notes: adminNotes,
                escalate_to_dispute: reviewAction === 'escalate'
              });
              setReviewAction('');
              setAdminNotes('');
            }}
            disabled={!reviewAction || actionLoading}
            className="bg-blue-500 hover:bg-blue-600"
          >
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Submit Review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReviewReportDialog;
