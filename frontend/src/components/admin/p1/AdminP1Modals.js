/**
 * AdminP1Modals.js
 * Extracted from AdminP1Dashboard.js (v42)
 * Contains: VerificationDetailModal, FraudAlertDetailModal, ViolationDetailModal
 */
import React from 'react';
import {
  UserCheck, AlertTriangle, ExternalLink, Instagram, Globe,
  FileText, Link2, Loader2,
  Gavel, Scale, ThumbsUp, ThumbsDown
} from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Textarea } from '../../ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '../../ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../../ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '../../ui/avatar';
import { getFullUrl } from '../../../utils/media';

// --- Shared badge sub-components ---

const StatusBadge = ({ status }) => {
  const styles = {
    pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    under_review: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    approved: 'bg-green-500/20 text-green-400 border-green-500/30',
    rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
    more_info_needed: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    open: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    investigating: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    resolved: 'bg-green-500/20 text-green-400 border-green-500/30',
    false_positive: 'bg-gray-500/20 text-muted-foreground border-gray-500/30',
  };
  return (
    <Badge className={`text-xs ${styles[status] || 'bg-zinc-500/20 text-zinc-400'}`}>
      {status?.replace(/_/g, ' ')}
    </Badge>
  );
};

const SeverityBadge = ({ severity }) => {
  const styles = {
    low: 'bg-gray-500/20 text-muted-foreground',
    medium: 'bg-yellow-500/20 text-yellow-400',
    high: 'bg-orange-500/20 text-orange-400',
    critical: 'bg-red-500/20 text-red-400 animate-pulse',
  };
  return <Badge className={`text-xs ${styles[severity] || styles.medium}`}>{severity}</Badge>;
};

// Re-export for parent usage
export { StatusBadge, SeverityBadge };

// === Verification Detail Modal ===
export const VerificationDetailModal = ({
  open, onOpenChange,
  selectedVerification,
  reviewStatus, setReviewStatus,
  adminNotes, setAdminNotes,
  rejectionReason, setRejectionReason,
  handleReviewVerification,
  actionLoading,
  formatDate,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="bg-card border-border text-foreground max-w-2xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-purple-400" />
          Verification Request
        </DialogTitle>
      </DialogHeader>

      {selectedVerification && (
        <div className="space-y-4">
          {/* User Info */}
          <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
            <Avatar className="w-12 h-12">
              <AvatarImage src={getFullUrl(selectedVerification.user?.avatar_url)} />
              <AvatarFallback>{selectedVerification.user?.full_name?.[0]}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{selectedVerification.user?.full_name}</p>
              <p className="text-sm text-muted-foreground">{selectedVerification.user?.email}</p>
            </div>
            <Badge variant="outline" className="ml-auto">
              {selectedVerification.user?.role || 'User'}
            </Badge>
          </div>

          {/* Verification Type */}
          <div className="flex items-center gap-2">
            <Badge className={`${
              selectedVerification.verification_type === 'pro_surfer'
                ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                : 'bg-purple-500/20 text-purple-400 border-purple-500/30'
            }`}>
              {selectedVerification.verification_type === 'pro_surfer'
                ? 'Pro Surfer (WSL) Verification'
                : 'Approved Pro Photographer Verification'}
            </Badge>
            <StatusBadge status={selectedVerification.status} />
          </div>

          {/* Pro Surfer Fields */}
          {selectedVerification.verification_type === 'pro_surfer' && (
            <div className="space-y-3">
              <h4 className="font-medium text-cyan-400">WSL Information</h4>

              {selectedVerification.wsl_athlete_id && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-gray-500">WSL Athlete ID</p>
                  <p className="text-foreground font-mono">{selectedVerification.wsl_athlete_id}</p>
                </div>
              )}

              {selectedVerification.wsl_profile_url && (
                <a
                  href={selectedVerification.wsl_profile_url}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/20 transition-colors"
                >
                  <Globe className="w-5 h-5 text-cyan-400" />
                  <span className="text-cyan-400">View WSL Profile</span>
                  <ExternalLink className="w-4 h-4 text-cyan-400 ml-auto" />
                </a>
              )}

              {selectedVerification.competition_history_urls?.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Competition History</p>
                  <div className="space-y-1">
                    {selectedVerification.competition_history_urls.map((url, idx) => (
                      <a
                        key={idx} href={url}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-blue-400 hover:underline"
                      >
                        <Link2 className="w-3 h-3" /> {url}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pro Photographer Fields */}
          {selectedVerification.verification_type === 'approved_pro_photographer' && (
            <div className="space-y-3">
              <h4 className="font-medium text-purple-400">Professional Information</h4>

              <div className="grid grid-cols-2 gap-2">
                {selectedVerification.instagram_url && (
                  <a
                    href={selectedVerification.instagram_url}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 bg-pink-500/10 border border-pink-500/30 rounded-lg hover:bg-pink-500/20"
                  >
                    <Instagram className="w-5 h-5 text-pink-400" />
                    <span className="text-pink-400 text-sm">Instagram</span>
                    <ExternalLink className="w-3 h-3 text-pink-400 ml-auto" />
                  </a>
                )}

                {selectedVerification.portfolio_website && (
                  <a
                    href={selectedVerification.portfolio_website}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg hover:bg-blue-500/20"
                  >
                    <Globe className="w-5 h-5 text-blue-400" />
                    <span className="text-blue-400 text-sm">Portfolio</span>
                    <ExternalLink className="w-3 h-3 text-blue-400 ml-auto" />
                  </a>
                )}
              </div>

              {selectedVerification.years_experience && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-gray-500">Years of Experience</p>
                  <p className="text-foreground">{selectedVerification.years_experience} years</p>
                </div>
              )}

              {selectedVerification.professional_equipment && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-gray-500">Professional Equipment</p>
                  <p className="text-foreground text-sm">{selectedVerification.professional_equipment}</p>
                </div>
              )}

              {selectedVerification.media_mentions?.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Media Mentions / Features</p>
                  <div className="space-y-1">
                    {selectedVerification.media_mentions.map((url, idx) => (
                      <a
                        key={idx} href={url}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-green-400 hover:underline"
                      >
                        <FileText className="w-3 h-3" /> {url}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {selectedVerification.sample_work_urls?.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Sample Work</p>
                  <div className="grid grid-cols-3 gap-2">
                    {selectedVerification.sample_work_urls.slice(0, 6).map((url, idx) => (
                      <a
                        key={idx} href={url}
                        target="_blank" rel="noopener noreferrer"
                        className="aspect-square bg-muted rounded-lg overflow-hidden hover:ring-2 ring-purple-500"
                      >
                        <img loading="lazy" decoding="async" src={url} alt={`Sample ${idx + 1}`} className="w-full h-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Photo ID */}
          {selectedVerification.photo_id_url && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Photo ID</p>
              <a
                href={selectedVerification.photo_id_url}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 p-3 bg-muted rounded-lg hover:bg-input"
              >
                <FileText className="w-5 h-5 text-muted-foreground" />
                <span className="text-foreground">View Photo ID</span>
                <ExternalLink className="w-4 h-4 text-muted-foreground ml-auto" />
              </a>
            </div>
          )}

          {/* Additional Notes */}
          {selectedVerification.additional_notes && (
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-xs text-gray-500">Additional Notes from User</p>
              <p className="text-foreground text-sm mt-1">{selectedVerification.additional_notes}</p>
            </div>
          )}

          {/* Review Form */}
          {selectedVerification.status === 'pending' && (
            <div className="border-t border-border pt-4 space-y-3">
              <h4 className="font-medium">Review Decision</h4>

              <Select value={reviewStatus} onValueChange={setReviewStatus}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Select decision..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">Approve</SelectItem>
                  <SelectItem value="rejected">Reject</SelectItem>
                  <SelectItem value="more_info_needed">Request More Info</SelectItem>
                </SelectContent>
              </Select>

              {reviewStatus === 'rejected' && (
                <Textarea aria-label="Reason for rejection (shown to user)..."
                  placeholder="Reason for rejection (shown to user)..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="bg-muted border-border"
                />
              )}

              <Textarea aria-label="Internal admin notes..."
                placeholder="Internal admin notes..."
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                className="bg-muted border-border"
              />

              <Button aria-label="Submit review"
                onClick={() => handleReviewVerification(selectedVerification.id)}
                disabled={!reviewStatus || actionLoading}
                className={`w-full ${
                  reviewStatus === 'approved' ? 'bg-green-500 hover:bg-green-600' :
                  reviewStatus === 'rejected' ? 'bg-red-500 hover:bg-red-600' :
                  'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {reviewStatus === 'approved' ? 'Approve Verification' :
                 reviewStatus === 'rejected' ? 'Reject Verification' :
                 reviewStatus === 'more_info_needed' ? 'Request More Info' :
                 'Submit Review'}
              </Button>
            </div>
          )}
        </div>
      )}
    </DialogContent>
  </Dialog>
);

// === Fraud Alert Detail Modal ===
export const FraudAlertDetailModal = ({
  open, onOpenChange,
  selectedAlert,
  actionTaken, setActionTaken,
  resolutionNotes, setResolutionNotes,
  handleResolveFraudAlert,
  actionLoading,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="bg-card border-border text-foreground max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          Fraud Alert Details
        </DialogTitle>
      </DialogHeader>

      {selectedAlert && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={selectedAlert.severity} />
            <StatusBadge status={selectedAlert.status} />
            <Badge variant="outline" className="capitalize">
              {selectedAlert.alert_type?.replace(/_/g, ' ')}
            </Badge>
          </div>

          <div>
            <p className="font-medium text-lg">{selectedAlert.title}</p>
            <p className="text-muted-foreground mt-1">{selectedAlert.description}</p>
          </div>

          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <Avatar>
              <AvatarImage src={getFullUrl(selectedAlert.user?.avatar_url)} />
              <AvatarFallback>{selectedAlert.user?.full_name?.[0]}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{selectedAlert.user?.full_name}</p>
              <p className="text-sm text-muted-foreground">{selectedAlert.user?.email}</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-sm text-gray-500">Risk Score</p>
              <p className={`text-xl font-bold ${
                selectedAlert.risk_score >= 80 ? 'text-red-400' :
                selectedAlert.risk_score >= 50 ? 'text-orange-400' :
                'text-yellow-400'
              }`}>{selectedAlert.risk_score}</p>
            </div>
          </div>

          {selectedAlert.status === 'open' && (
            <div className="space-y-3 border-t border-border pt-4">
              <Select value={actionTaken} onValueChange={setActionTaken}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Select action..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Action</SelectItem>
                  <SelectItem value="warning">Send Warning</SelectItem>
                  <SelectItem value="suspended">Suspend User</SelectItem>
                  <SelectItem value="banned">Ban User</SelectItem>
                </SelectContent>
              </Select>

              <Textarea aria-label="Resolution notes..."
                placeholder="Resolution notes..."
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                className="bg-muted border-border"
              />

              <Button aria-label="Resolve alert"
                onClick={() => handleResolveFraudAlert(selectedAlert.id)}
                disabled={!actionTaken || actionLoading}
                className="w-full bg-red-500 hover:bg-red-600"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Resolve Alert
              </Button>
            </div>
          )}
        </div>
      )}
    </DialogContent>
  </Dialog>
);

// === Violation Detail Dialog ===
export const ViolationDetailModal = ({
  open, onOpenChange,
  selectedViolation,
  appealNotes, setAppealNotes,
  handleReviewAppeal,
  actionLoading,
  formatDate,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="bg-card border-border max-w-lg" data-testid="violation-detail-dialog">
      {selectedViolation && (
        <div className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Gavel className="w-5 h-5 text-orange-400" />
              Violation Details
            </DialogTitle>
          </DialogHeader>

          {/* Violation Info */}
          <div className="p-4 rounded-lg bg-muted space-y-3">
            <div className="flex items-center justify-between">
              <Badge className={`${
                selectedViolation.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                selectedViolation.severity === 'severe' ? 'bg-orange-500/20 text-orange-400' :
                selectedViolation.severity === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-gray-500/20 text-muted-foreground'
              }`}>
                {selectedViolation.severity?.toUpperCase()}
              </Badge>
              <span className="text-xs text-muted-foreground">{formatDate(selectedViolation.created_at)}</span>
            </div>

            <h3 className="text-lg font-semibold text-foreground">{selectedViolation.title}</h3>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Type</p>
                <p className="text-foreground capitalize">{selectedViolation.violation_type?.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Action Taken</p>
                <p className="text-foreground capitalize">{selectedViolation.action_taken?.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <p className="text-muted-foreground">User ID</p>
                <p className="text-foreground font-mono text-xs">{selectedViolation.user_id}</p>
              </div>
              {selectedViolation.distance_discrepancy_miles && (
                <div>
                  <p className="text-muted-foreground">Distance Discrepancy</p>
                  <p className="text-red-400 font-bold">{selectedViolation.distance_discrepancy_miles} miles</p>
                </div>
              )}
            </div>
          </div>

          {/* Appeal Section */}
          {selectedViolation.appeal_status === 'pending' && (
            <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/30 space-y-3">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-orange-400" />
                <span className="font-medium text-orange-400">Appeal Pending Review</span>
              </div>

              <Textarea aria-label="Add notes for this appeal review..."
                placeholder="Add notes for this appeal review..."
                value={appealNotes}
                onChange={(e) => setAppealNotes(e.target.value)}
                className="bg-muted border-border text-foreground"
                rows={3}
              />

              <div className="flex gap-2">
                <Button aria-label="Approve appeal"
                  variant="outline"
                  className="flex-1 border-green-500 text-green-400 hover:bg-green-500/20"
                  onClick={() => handleReviewAppeal(selectedViolation.id, true)}
                  disabled={actionLoading}
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ThumbsUp className="w-4 h-4 mr-2" />}
                  Approve Appeal
                </Button>
                <Button aria-label="Deny appeal"
                  variant="outline"
                  className="flex-1 border-red-500 text-red-400 hover:bg-red-500/20"
                  onClick={() => handleReviewAppeal(selectedViolation.id, false)}
                  disabled={actionLoading}
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ThumbsDown className="w-4 h-4 mr-2" />}
                  Deny Appeal
                </Button>
              </div>
            </div>
          )}

          {/* Already Reviewed */}
          {selectedViolation.appeal_status && selectedViolation.appeal_status !== 'pending' && (
            <div className={`p-4 rounded-lg ${
              selectedViolation.appeal_status === 'approved' ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'
            }`}>
              <p className={selectedViolation.appeal_status === 'approved' ? 'text-green-400' : 'text-red-400'}>
                Appeal {selectedViolation.appeal_status === 'approved' ? 'Approved' : 'Denied'}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </div>
      )}
    </DialogContent>
  </Dialog>
);
