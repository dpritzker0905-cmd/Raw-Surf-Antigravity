import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Flag, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';

const ReportPostModal = ({ post, open, onClose, isLight }) => {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const reportReasons = [
    'Spam or scam',
    'Nudity or sexual content',
    'Hate speech or symbols',
    'Violence or dangerous content',
    'Bullying or harassment',
    'False information',
    'Intellectual property violation',
    'Other'
  ];

  const handleReport = async () => {
    if (!reason) {
      toast.error('Please select a reason');
      return;
    }
    
    setLoading(true);
    try {
      await apiClient.post(`/posts/${post.id}/report`, {
        reporter_id: user?.id,
        reason,
        description
      });
      toast.success('Report submitted. We\'ll review this post.');
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} max-w-md`} aria-describedby="report-post-description">
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>
            <Flag className="w-5 h-5 text-red-500" />
            Report Post
          </DialogTitle>
          <DialogDescription id="report-post-description" className={isLight ? 'text-gray-600' : 'text-gray-400'}>
            Why are you reporting this post?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 max-h-[400px] overflow-y-auto">
          <div className="space-y-2">
            {reportReasons.map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                  reason === r
                    ? 'border-red-500 bg-red-500/10 text-red-500'
                    : isLight 
                      ? 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      : 'border-zinc-700 hover:bg-zinc-800 text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          
          {reason === 'Other' && (
            <div>
              <Label className={isLight ? 'text-gray-700' : 'text-gray-300'}>
                Additional details
              </Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Please describe the issue..."
                className={`mt-1 ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800 border-zinc-700'}`}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button aria-label="Loader2" 
            variant="destructive"
            onClick={handleReport} 
            disabled={loading || !reason}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Submit Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReportPostModal;
