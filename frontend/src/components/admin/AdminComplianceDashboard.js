/**
 * AdminComplianceDashboard.js — Compliance tab for the Unified Admin Console.
 *
 * Shows ToS violation stats, pending appeals queue, recent violations list,
 * and provides approve/deny actions for user appeals.
 * Data comes from GET /compliance/compliance-dashboard (admin-only).
 */
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../../lib/apiClient';
import {
  Shield, AlertTriangle, Scale, Users, Ban, Clock,
  Check, X, Loader2, ChevronDown, ChevronRight,
  MapPin, Eye, RefreshCw, FileText, Gavel
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import { toast } from 'sonner';
import logger from '../../utils/logger';

// ─── Stat Card ────────────────────────────────────────────────────────────────
const StatCard = ({ icon: Icon, label, value, color = 'cyan' }) => (
  <div className={`p-3 rounded-xl bg-${color}-500/10 border border-${color}-500/20`}>
    <div className="flex items-center gap-2 mb-1">
      <Icon className={`w-4 h-4 text-${color}-400`} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
    <p className={`text-xl font-bold text-${color}-400`}>{value}</p>
  </div>
);

// ─── Severity Badge ───────────────────────────────────────────────────────────
const SeverityBadge = ({ severity }) => {
  const config = {
    minor:    { bg: 'bg-blue-500/20',   text: 'text-blue-400',   label: 'Minor' },
    moderate: { bg: 'bg-yellow-500/20',  text: 'text-yellow-400', label: 'Moderate' },
    severe:   { bg: 'bg-orange-500/20',  text: 'text-orange-400', label: 'Severe' },
    critical: { bg: 'bg-red-500/20',     text: 'text-red-400',    label: 'Critical' },
  };
  const c = config[severity] || config.minor;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
};

// ─── Appeal Status Badge ──────────────────────────────────────────────────────
const AppealBadge = ({ status }) => {
  if (!status) return null;
  const config = {
    pending:  { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: '⏳ Pending' },
    approved: { bg: 'bg-green-500/20',  text: 'text-green-400',  label: '✅ Approved' },
    denied:   { bg: 'bg-red-500/20',    text: 'text-red-400',    label: '❌ Denied' },
  };
  const c = config[status] || config.pending;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
};

// ─── Violation Type Label ─────────────────────────────────────────────────────
const violationTypeLabel = (type) => {
  const map = {
    location_fraud: '📍 Location Fraud',
    fake_reviews: '⭐ Fake Reviews',
    harassment: '🚫 Harassment',
    spam: '📧 Spam',
    impersonation: '🎭 Impersonation',
    copyright: '©️ Copyright',
    tos_violation: '📋 ToS Violation',
  };
  return map[type] || type?.replace(/_/g, ' ');
};

// ─── Action Taken Label ───────────────────────────────────────────────────────
const actionLabel = (action) => {
  const map = {
    warning: '⚠️ Warning',
    suspension_7d: '🔒 7-Day Suspension',
    suspension_30d: '🔒 30-Day Suspension',
    permanent_ban: '🚫 Permanent Ban',
  };
  return map[action] || action?.replace(/_/g, ' ');
};

/**
 * @param {Object} props
 * @param {string} props.cardBgClass
 * @param {string} props.textClass
 * @param {string} props.textSecondary
 * @param {boolean} props.isLight
 */
export const AdminComplianceDashboard = ({ cardBgClass, textClass, textSecondary, isLight }) => {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [expandedViolation, setExpandedViolation] = useState(null);

  // Use fallback classes if not provided (standalone usage)
  const card = cardBgClass || 'bg-card border-border';
  const text = textClass || 'text-foreground';
  const textSec = textSecondary || 'text-muted-foreground';

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/compliance/dashboard');
      setDashboard(res.data);
    } catch (err) {
      logger.error('Failed to fetch compliance dashboard:', err);
      toast.error('Failed to load compliance data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // ─── Appeal Review Handlers ───────────────────────────────────────────────
  const handleReviewAppeal = async (violationId, approved) => {
    setReviewLoading(true);
    try {
      await apiClient.put(`/compliance/violations/${violationId}/appeal/review`, {
        approved,
        notes: reviewNotes || null,
      });
      toast.success(approved ? 'Appeal approved — strike removed' : 'Appeal denied');
      setReviewingId(null);
      setReviewNotes('');
      fetchDashboard(); // Refresh stats
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to review appeal');
    } finally {
      setReviewLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
        <span className={`ml-2 text-sm ${textSec}`}>Loading compliance data...</span>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <Card className={card}>
        <CardContent className="py-8 text-center">
          <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className={textSec}>Unable to load compliance dashboard</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={fetchDashboard}>
            <RefreshCw className="w-4 h-4 mr-2" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { stats, recent_violations, location_fraud_map_data } = dashboard;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-cyan-400" />
          <h2 className={`text-lg font-bold ${text}`}>Compliance & Safety</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchDashboard} className={textSec}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={AlertTriangle} label="Total Violations" value={stats.total_violations} color="red" />
        <StatCard icon={Clock} label="This Week" value={stats.violations_this_week} color="yellow" />
        <StatCard icon={MapPin} label="Location Fraud" value={stats.location_fraud_count} color="orange" />
        <StatCard icon={Gavel} label="Pending Appeals" value={stats.pending_appeals} color="purple" />
        <StatCard icon={Ban} label="Suspended" value={stats.suspended_users} color="red" />
        <StatCard icon={Users} label="Banned" value={stats.banned_users} color="red" />
      </div>

      {/* Pending Appeals Queue */}
      {stats.pending_appeals > 0 && (
        <Card className={`${card} border-yellow-500/30`}>
          <CardHeader>
            <CardTitle className={`${text} text-sm flex items-center gap-2`}>
              <Gavel className="w-4 h-4 text-yellow-400" />
              Pending Appeals
              <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">{stats.pending_appeals}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recent_violations
              .filter(v => v.appeal_status === 'pending')
              .map(v => (
                <div key={v.id} className={`p-3 rounded-lg border ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-muted/30 border-border'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${text}`}>{v.title}</span>
                        <SeverityBadge severity={v.severity} />
                      </div>
                      <p className={`text-xs ${textSec} mt-1`}>
                        {violationTypeLabel(v.violation_type)} • {new Date(v.created_at).toLocaleDateString()}
                      </p>
                      <p className={`text-xs ${textSec} mt-0.5`}>
                        User: <span className="font-mono text-xs">{v.user_id?.slice(0, 8)}...</span>
                      </p>
                    </div>
                    <AppealBadge status={v.appeal_status} />
                  </div>

                  {/* Review Panel */}
                  {reviewingId === v.id ? (
                    <div className="mt-3 space-y-2 pt-3 border-t border-border">
                      <Textarea
                        placeholder="Review notes (optional)..."
                        value={reviewNotes}
                        onChange={(e) => setReviewNotes(e.target.value)}
                        className="bg-card border-input text-foreground text-sm h-20"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleReviewAppeal(v.id, true)}
                          disabled={reviewLoading}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        >
                          {reviewLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Check className="w-3 h-3 mr-1" />}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleReviewAppeal(v.id, false)}
                          disabled={reviewLoading}
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                        >
                          {reviewLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <X className="w-3 h-3 mr-1" />}
                          Deny
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setReviewingId(null); setReviewNotes(''); }}
                          className="border-border"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10"
                      onClick={() => setReviewingId(v.id)}
                    >
                      <Eye className="w-3 h-3 mr-1" /> Review Appeal
                    </Button>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Recent Violations */}
      <Card className={card}>
        <CardHeader>
          <CardTitle className={`${text} text-sm flex items-center gap-2`}>
            <FileText className="w-4 h-4 text-muted-foreground" />
            Recent Violations
            <Badge className="bg-muted text-muted-foreground text-xs">{recent_violations.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recent_violations.length === 0 ? (
            <div className="py-8 text-center">
              <Shield className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <p className={`text-sm ${textSec}`}>No violations recorded yet</p>
              <p className="text-xs text-green-400 mt-1">Community is clean 🤙</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recent_violations.map(v => (
                <div
                  key={v.id}
                  className={`rounded-lg border transition-colors cursor-pointer ${
                    isLight ? 'bg-gray-50 border-gray-200 hover:bg-gray-100' : 'bg-muted/20 border-border hover:bg-muted/40'
                  }`}
                >
                  <button
                    className="w-full p-3 text-left"
                    onClick={() => setExpandedViolation(expandedViolation === v.id ? null : v.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                        <span className={`text-sm font-medium ${text} truncate`}>{v.title}</span>
                        <SeverityBadge severity={v.severity} />
                        {v.appeal_status && <AppealBadge status={v.appeal_status} />}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className={`text-xs ${textSec}`}>
                          {new Date(v.created_at).toLocaleDateString()}
                        </span>
                        {expandedViolation === v.id
                          ? <ChevronDown className={`w-4 h-4 ${textSec}`} />
                          : <ChevronRight className={`w-4 h-4 ${textSec}`} />}
                      </div>
                    </div>
                  </button>

                  {/* Expanded Detail */}
                  {expandedViolation === v.id && (
                    <div className={`px-3 pb-3 pt-1 text-sm border-t ${isLight ? 'border-gray-200' : 'border-border'}`}>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className={textSec}>Type</span>
                          <p className={text}>{violationTypeLabel(v.violation_type)}</p>
                        </div>
                        <div>
                          <span className={textSec}>Action</span>
                          <p className={text}>{actionLabel(v.action_taken)}</p>
                        </div>
                        <div>
                          <span className={textSec}>User ID</span>
                          <p className="font-mono text-xs text-cyan-400">{v.user_id?.slice(0, 12)}...</p>
                        </div>
                        {v.distance_discrepancy_miles && (
                          <div>
                            <span className={textSec}>Distance Gap</span>
                            <p className="text-orange-400">{v.distance_discrepancy_miles.toFixed(1)} mi</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Location Fraud Map Data */}
      {location_fraud_map_data?.length > 0 && (
        <Card className={card}>
          <CardHeader>
            <CardTitle className={`${text} text-sm flex items-center gap-2`}>
              <MapPin className="w-4 h-4 text-orange-400" />
              Location Fraud Hotspots
              <Badge className="bg-orange-500/20 text-orange-400 text-xs">{location_fraud_map_data.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {location_fraud_map_data.slice(0, 10).map(f => (
                <div key={f.id} className={`flex items-center justify-between p-2 rounded-lg ${isLight ? 'bg-gray-50' : 'bg-muted/20'}`}>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-orange-400" />
                    <div>
                      <p className={`text-xs ${text}`}>
                        Claimed: {f.claimed[0]?.toFixed(3)}, {f.claimed[1]?.toFixed(3)}
                      </p>
                      <p className={`text-xs ${textSec}`}>
                        Actual: {f.actual[0]?.toFixed(3)}, {f.actual[1]?.toFixed(3)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-orange-400">{f.distance_miles?.toFixed(1)} mi</p>
                    <SeverityBadge severity={f.severity} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AdminComplianceDashboard;
