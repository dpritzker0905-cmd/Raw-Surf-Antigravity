/**
 * AdminComplianceDashboard.js — Compliance tab for the Unified Admin Console.
 *
 * Shows ToS violation stats, pending appeals queue, recent violations list,
 * and provides approve/deny actions for user appeals.
 * Data comes from GET /compliance/compliance-dashboard (admin-only).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../lib/apiClient';
import {
  Shield, AlertTriangle, Scale, Users, Ban, Clock,
  Check, X, Loader2, ChevronDown, ChevronRight,
  MapPin, Eye, RefreshCw, FileText, Gavel, ExternalLink, MessageSquare,
  Plus, Trash2, Save, Edit3, ScrollText, Download, Upload, Database
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
  const navigate = useNavigate();

  // Use fallback classes if not provided (standalone usage)
  const card = cardBgClass || 'bg-card border-border';
  const text = textClass || 'text-foreground';
  const textSec = textSecondary || 'text-muted-foreground';

  // ── ToS Content Editor state ──────────────────────────────────
  const [tosEditorOpen, setTosEditorOpen] = useState(false);
  const [editingDocType, setEditingDocType] = useState('tos');
  const [editVersion, setEditVersion] = useState('');
  const [editEffectiveDate, setEditEffectiveDate] = useState('');
  const [editSections, setEditSections] = useState([]);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);

  const loadTosContent = useCallback(async (docType) => {
    setEditorLoading(true);
    try {
      const res = await apiClient.get(`/compliance/tos-content/current?doc_type=${docType}`);
      setEditVersion(res.data.version || '1.0');
      setEditEffectiveDate(res.data.effective_date || '');
      setEditSections(res.data.sections || []);
    } catch {
      toast.error('Failed to load content');
    } finally {
      setEditorLoading(false);
    }
  }, []);

  const saveTosContent = async () => {
    if (!editSections.length) return toast.error('Add at least one section');
    setEditorSaving(true);
    try {
      await apiClient.put('/compliance/tos-content', {
        doc_type: editingDocType,
        version: editVersion,
        sections: editSections,
        effective_date: editEffectiveDate,
        set_active: true
      });
      toast.success(`${editingDocType === 'tos' ? 'Terms of Service' : 'Privacy Policy'} published!`);
    } catch {
      toast.error('Failed to save content');
    } finally {
      setEditorSaving(false);
    }
  };

  const addSection = () => {
    setEditSections(prev => [...prev, { title: `${prev.length + 1}. New Section`, body: '' }]);
  };

  const removeSection = (idx) => {
    setEditSections(prev => prev.filter((_, i) => i !== idx));
  };

  const updateSection = (idx, field, value) => {
    setEditSections(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  // ── ToS Import/Export helpers ──────────────────────────────────
  const exportAsJson = () => {
    const payload = {
      doc_type: editingDocType,
      version: editVersion,
      effective_date: editEffectiveDate,
      sections: editSections,
      exported_at: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editingDocType}_v${editVersion}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported as JSON');
  };

  const exportAsCsv = () => {
    const escCsv = (str) => `"${(str || '').replace(/"/g, '""')}"`;
    const header = 'Section Number,Title,Body';
    const rows = editSections.map((s, i) => `${i + 1},${escCsv(s.title)},${escCsv(s.body)}`);
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editingDocType}_v${editVersion}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported as CSV (spreadsheet)');
  };

  const handleImport = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(text);
          if (data.sections && Array.isArray(data.sections)) {
            setEditSections(data.sections);
            if (data.version) setEditVersion(data.version);
            if (data.effective_date) setEditEffectiveDate(data.effective_date);
            toast.success(`Imported ${data.sections.length} sections from JSON`);
          } else {
            toast.error('Invalid JSON: must contain a "sections" array');
          }
        } else if (file.name.endsWith('.csv')) {
          // Parse CSV: expects columns Title, Body (with optional Section Number)
          const lines = text.split('\n').filter(l => l.trim());
          const sections = [];
          for (let i = 1; i < lines.length; i++) { // Skip header
            const match = lines[i].match(/(?:"([^"]*(?:""[^"]*)*)"|([^,]*))/g);
            if (match && match.length >= 2) {
              const clean = (s) => (s || '').replace(/^"|"$/g, '').replace(/""/g, '"').trim();
              // If 3 columns: number, title, body. If 2: title, body
              const title = match.length >= 3 ? clean(match[1]) : clean(match[0]);
              const body = match.length >= 3 ? clean(match[2]) : clean(match[1]);
              if (title) sections.push({ title, body });
            }
          }
          if (sections.length > 0) {
            setEditSections(sections);
            toast.success(`Imported ${sections.length} sections from CSV`);
          } else {
            toast.error('No valid sections found in CSV');
          }
        } else {
          toast.error('Unsupported file type. Use .json or .csv');
        }
      } catch (err) {
        toast.error('Failed to parse file: ' + err.message);
      }
    };
    reader.readAsText(file);
  };

  // ── Data Management state ──────────────────────────────────
  const [dataManagementOpen, setDataManagementOpen] = useState(false);
  const [exportUserId, setExportUserId] = useState('');
  const [exportLoading, setExportLoading] = useState(false);

  const handleDataExport = async () => {
    if (!exportUserId.trim()) return toast.error('Enter a user ID');
    setExportLoading(true);
    try {
      const res = await apiClient.post(`/compliance/data-export/${exportUserId.trim()}`);
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `user_data_export_${exportUserId.trim().slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported data for user: ${res.data.summary?.total_posts || 0} posts, ${res.data.summary?.total_messages || 0} messages`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Export failed');
    } finally {
      setExportLoading(false);
    }
  };

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
                        User:{' '}
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/profile/${v.user_id}`); }}
                          className="font-mono text-xs text-cyan-400 hover:text-cyan-300 hover:underline inline-flex items-center gap-1 transition-colors"
                          title="View user profile"
                        >
                          {v.user_id?.slice(0, 8)}...
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </p>
                    </div>
                    <AppealBadge status={v.appeal_status} />
                  </div>

                  {/* User's Appeal Message */}
                  {v.appeal_text && (
                    <div className={`mt-3 p-3 rounded-lg border-l-4 border-yellow-400 ${
                      isLight ? 'bg-yellow-50' : 'bg-yellow-500/5'
                    }`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <MessageSquare className="w-3.5 h-3.5 text-yellow-400" />
                        <span className={`text-xs font-medium ${isLight ? 'text-yellow-700' : 'text-yellow-400'}`}>User's Appeal</span>
                      </div>
                      <p className={`text-sm ${isLight ? 'text-gray-700' : 'text-gray-300'}`}>
                        "{v.appeal_text}"
                      </p>
                    </div>
                  )}

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
                          <span className={textSec}>User</span>
                          <button
                            onClick={() => navigate(`/profile/${v.user_id}`)}
                            className="font-mono text-xs text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1 transition-colors mt-0.5"
                            title="View user profile"
                          >
                            {v.user_id?.slice(0, 12)}...
                            <ExternalLink className="w-3 h-3" />
                          </button>
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

      {/* ── ToS & Privacy Content Editor ─────────────────────── */}
      <Card className={`${card} mt-6`}>
        <CardHeader className="cursor-pointer" onClick={() => {
          if (!tosEditorOpen) {
            loadTosContent(editingDocType);
          }
          setTosEditorOpen(!tosEditorOpen);
        }}>
          <div className="flex items-center justify-between">
            <CardTitle className={`${text} flex items-center gap-2`}>
              <ScrollText className="w-5 h-5 text-cyan-400" />
              ToS & Privacy Content Editor
            </CardTitle>
            <ChevronDown className={`w-5 h-5 ${textSec} transition-transform ${tosEditorOpen ? 'rotate-180' : ''}`} />
          </div>
        </CardHeader>

        {tosEditorOpen && (
          <CardContent className="space-y-4">
            {/* Document type toggle */}
            <div className="flex gap-2">
              {['tos', 'privacy'].map(dt => (
                <Button
                  key={dt}
                  variant={editingDocType === dt ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setEditingDocType(dt); loadTosContent(dt); }}
                  className={editingDocType === dt
                    ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
                    : `${isLight ? 'border-gray-300' : 'border-zinc-700'}`}
                >
                  {dt === 'tos' ? '📄 Terms of Service' : '🛡️ Privacy Policy'}
                </Button>
              ))}
            </div>

            {/* Version + Effective Date */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={`text-xs ${textSec} block mb-1`}>Version</label>
                <input
                  value={editVersion}
                  onChange={e => setEditVersion(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-zinc-800 border-zinc-700 text-white'}`}
                  placeholder="e.g. 1.0, 2.0"
                />
              </div>
              <div className="flex-1">
                <label className={`text-xs ${textSec} block mb-1`}>Effective Date</label>
                <input
                  value={editEffectiveDate}
                  onChange={e => setEditEffectiveDate(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border text-sm ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-zinc-800 border-zinc-700 text-white'}`}
                  placeholder="e.g. May 2026"
                />
              </div>
            </div>

            {editorLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Sections editor */}
                <div className="space-y-3">
                  {editSections.map((section, idx) => (
                    <div key={idx} className={`p-3 rounded-lg border ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/50 border-zinc-700'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs font-mono ${textSec}`}>§{idx + 1}</span>
                        <input
                          value={section.title}
                          onChange={e => updateSection(idx, 'title', e.target.value)}
                          className={`flex-1 px-2 py-1 rounded border text-sm font-medium ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-zinc-900 border-zinc-600 text-white'}`}
                        />
                        <button
                          onClick={() => removeSection(idx)}
                          className="p-1 text-red-400 hover:text-red-300 transition-colors"
                          title="Remove section"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <Textarea
                        value={section.body}
                        onChange={e => updateSection(idx, 'body', e.target.value)}
                        rows={3}
                        className={`w-full text-sm ${isLight ? 'bg-white border-gray-300' : 'bg-zinc-900 border-zinc-600'}`}
                        placeholder="Section content..."
                      />
                    </div>
                  ))}
                </div>

                {/* Import/Export + Add section + Publish */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={addSection} className="flex items-center gap-1.5">
                    <Plus className="w-4 h-4" /> Add Section
                  </Button>

                  <div className="flex items-center gap-1 border-l border-zinc-700 pl-2 ml-1">
                    <Button variant="outline" size="sm" onClick={exportAsJson} className="flex items-center gap-1" title="Export as JSON">
                      <Download className="w-3.5 h-3.5" /> JSON
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportAsCsv} className="flex items-center gap-1" title="Export as CSV (spreadsheet)">
                      <Download className="w-3.5 h-3.5" /> CSV
                    </Button>
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept=".json,.csv"
                        className="hidden"
                        onChange={(e) => { handleImport(e.target.files[0]); e.target.value = ''; }}
                      />
                      <span className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border transition-colors hover:bg-muted/50 cursor-pointer ${
                        isLight ? 'border-gray-300 text-gray-700' : 'border-zinc-700 text-zinc-300'
                      }`}>
                        <Upload className="w-3.5 h-3.5" /> Import
                      </span>
                    </label>
                  </div>

                  <Button
                    onClick={saveTosContent}
                    disabled={editorSaving}
                    className="flex-1 min-w-[200px] bg-gradient-to-r from-emerald-500 via-yellow-500 to-orange-500 text-black font-bold hover:opacity-90"
                  >
                    {editorSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    {editorSaving ? 'Publishing...' : `Publish ${editingDocType === 'tos' ? 'ToS' : 'Privacy Policy'} v${editVersion}`}
                  </Button>
                </div>

                <p className={`text-xs ${textSec}`}>
                  Publishing activates this version and deactivates all previous versions. All users will see the updated content immediately.
                  {editingDocType === 'tos' && ' To trigger re-acceptance, update the version in constants/tos.js to match.'}
                </p>
              </>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── Data Management (Export / Deletion) ─────────────────────── */}
      <Card className={`${card} mt-6`}>
        <CardHeader className="cursor-pointer" onClick={() => setDataManagementOpen(!dataManagementOpen)}>
          <div className="flex items-center justify-between">
            <CardTitle className={`${text} flex items-center gap-2`}>
              <Database className="w-5 h-5 text-emerald-400" />
              User Data Management (GDPR)
            </CardTitle>
            <ChevronDown className={`w-5 h-5 ${textSec} transition-transform ${dataManagementOpen ? 'rotate-180' : ''}`} />
          </div>
        </CardHeader>

        {dataManagementOpen && (
          <CardContent className="space-y-6">
            {/* ── Data Export ── */}
            <div className={`p-4 rounded-xl border ${isLight ? 'bg-emerald-50/50 border-emerald-200' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Download className="w-5 h-5 text-emerald-400" />
                <h3 className={`${text} font-semibold`}>Data Export (GDPR Art. 20)</h3>
              </div>
              <p className={`text-xs ${textSec} mb-3`}>
                Export all user data as a structured JSON file. Includes profile, posts, messages, bookings, payments, and more.
              </p>
              <div className="flex gap-2">
                <input
                  value={exportUserId}
                  onChange={e => setExportUserId(e.target.value)}
                  placeholder="User ID (e.g. abc123...)"
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm ${isLight ? 'bg-white border-gray-300 text-gray-900' : 'bg-zinc-800 border-zinc-700 text-white'}`}
                />
                <Button
                  onClick={handleDataExport}
                  disabled={exportLoading || !exportUserId.trim()}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  {exportLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Download className="w-4 h-4 mr-1.5" />}
                  {exportLoading ? 'Exporting...' : 'Export'}
                </Button>
              </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
};

export default AdminComplianceDashboard;
