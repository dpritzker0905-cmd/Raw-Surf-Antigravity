import React, { useState, useEffect } from 'react';
import { FileText, Clock, Check, Loader2, Shield, ChevronDown, AlertTriangle, Scale } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import apiClient from '../../lib/apiClient';
import { CURRENT_TOS_VERSION } from '../../constants/tos';
import DeleteAccountSection from './DeleteAccountSection';

/**
 * LegalSection GÇö Extracted from Settings.js
 * Handles Terms of Service viewing, acceptance history,
 * privacy policy, violation history, and account deletion.
 */
export const LegalSection = ({
  userId,
  textPrimaryClass,
  textSecondaryClass,
  borderClass,
  cardBgClass,
  expandedSections,
  toggleSection,
}) => {
  // ToS / Legal state
  const [tosStatus, setTosStatus] = useState({ loading: true, acknowledged: false, acknowledged_at: null });
  const [showTosFullText, setShowTosFullText] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [acceptanceHistory, setAcceptanceHistory] = useState({ loading: true, data: [] });
  const [tosContent, setTosContent] = useState({ sections: [], version: '', effective_date: '' });
  const [privacyContent, setPrivacyContent] = useState({ sections: [], effective_date: '' });

  // Violation history state
  const [violationHistory, setViolationHistory] = useState({ loading: true, data: null });
  const [showViolations, setShowViolations] = useState(false);

  useEffect(() => {
    if (userId) {
      apiClient.get(`/compliance/tos-status/${userId}?current_version=${CURRENT_TOS_VERSION}`)
        .then(res => setTosStatus({ loading: false, acknowledged: res.data.acknowledged, acknowledged_at: res.data.acknowledged_at }))
        .catch(() => setTosStatus({ loading: false, acknowledged: false, acknowledged_at: null }));
      
      apiClient.get(`/compliance/acceptance-history/${userId}`)
        .then(res => setAcceptanceHistory({ loading: false, data: res.data.history || [] }))
        .catch(() => setAcceptanceHistory({ loading: false, data: [] }));

      apiClient.get(`/compliance/violations/user/${userId}`)
        .then(res => setViolationHistory({ loading: false, data: res.data }))
        .catch(() => setViolationHistory({ loading: false, data: null }));
    }

    // Fetch content (no auth required)
    apiClient.get('/compliance/tos-content/current?doc_type=tos')
      .then(res => setTosContent(res.data))
      .catch(() => {});
    apiClient.get('/compliance/tos-content/current?doc_type=privacy')
      .then(res => setPrivacyContent(res.data))
      .catch(() => {});
  }, [userId]);

  return (
    <Card className={`${cardBgClass} mb-4 transition-colors duration-300`} data-testid="legal-settings-card">
      <CardHeader className="cursor-pointer" onClick={() => toggleSection('legal')}>
        <div className="flex items-center justify-between">
          <CardTitle className={`${textPrimaryClass} flex items-center gap-2`}>
            <Scale className="w-5 h-5 text-cyan-400" />
            Legal
          </CardTitle>
          <ChevronDown className={`w-5 h-5 ${textSecondaryClass} transition-transform ${expandedSections.legal ? 'rotate-180' : ''}`} />
        </div>
      </CardHeader>
      {expandedSections.legal && (
        <CardContent className="space-y-4">
          {/* ToS Acceptance Status */}
          <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <div>
                <span className={textPrimaryClass}>Terms of Service</span>
                <p className={`text-xs ${textSecondaryClass}`}>Version {CURRENT_TOS_VERSION}</p>
              </div>
            </div>
            <div className="text-right">
              {tosStatus.loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : tosStatus.acknowledged ? (
                <div className="flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs text-emerald-400">Accepted</span>
                </div>
              ) : (
                <span className="text-xs text-orange-400">Not accepted</span>
              )}
            </div>
          </div>

          {/* Accepted Date */}
          {tosStatus.acknowledged && tosStatus.acknowledged_at && (
            <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className={textPrimaryClass}>Accepted On</span>
              </div>
              <span className={`text-sm ${textSecondaryClass}`}>
                {new Date(tosStatus.acknowledged_at).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric'
                })}
              </span>
            </div>
          )}

          {/* View Full Terms Button */}
          <Button aria-label="File Text"
            aria-expanded={showTosFullText} onClick={() => setShowTosFullText(!showTosFullText)}
            variant="outline"
            className={`w-full ${borderClass} text-cyan-400 hover:bg-cyan-500/10`}
            data-testid="view-tos-button"
          >
            <FileText className="w-4 h-4 mr-2" />
            {showTosFullText ? 'Hide Terms' : 'View Full Terms of Service'}
          </Button>

          {/* Full ToS Text (Expandable) */}
          {showTosFullText && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground space-y-3 max-h-[50vh] overflow-y-auto" data-testid="tos-full-text">
              <p className={`text-xs ${textSecondaryClass} uppercase tracking-wider`}>Version {tosContent.version || CURRENT_TOS_VERSION} - Effective {tosContent.effective_date || 'May 2026'}</p>
              {(tosContent.sections || []).map((section, idx) => (
                <React.Fragment key={idx}>
                  <h4 className={`${textPrimaryClass} font-semibold`}>{section.title}</h4>
                  <p>{section.body}</p>
                </React.Fragment>
              ))}
              {(!tosContent.sections || tosContent.sections.length === 0) && (
                <p className={`${textSecondaryClass}`}>Loading terms...</p>
              )}
            </div>
          )}

          {/* Privacy Policy */}
          <Button aria-label="Shield"
            aria-expanded={showPrivacyPolicy} onClick={() => setShowPrivacyPolicy(!showPrivacyPolicy)}
            variant="outline"
            className={`w-full ${borderClass} text-cyan-400 hover:bg-cyan-500/10`}
            data-testid="view-privacy-button"
          >
            <Shield className="w-4 h-4 mr-2" />
            {showPrivacyPolicy ? 'Hide Privacy Policy' : 'View Privacy Policy'}
          </Button>

          {showPrivacyPolicy && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground space-y-3 max-h-[50vh] overflow-y-auto" data-testid="privacy-full-text">
              <p className={`text-xs ${textSecondaryClass} uppercase tracking-wider`}>Privacy Policy - Effective {privacyContent.effective_date || 'May 2026'}</p>
              {(privacyContent.sections || []).map((section, idx) => (
                <React.Fragment key={idx}>
                  <h4 className={`${textPrimaryClass} font-semibold`}>{section.title}</h4>
                  <p>{section.body}</p>
                </React.Fragment>
              ))}
              {(!privacyContent.sections || privacyContent.sections.length === 0) && (
                <p className={`${textSecondaryClass}`}>Loading privacy policy...</p>
              )}
            </div>
          )}

          {/* Acceptance History */}
          <div className={`py-2 border-b ${borderClass}`}>
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className={`${textPrimaryClass} text-sm font-medium`}>Acceptance History</span>
            </div>
            {acceptanceHistory.loading ? (
              <div className="flex justify-center py-3">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : acceptanceHistory.data.length === 0 ? (
              <p className={`text-xs ${textSecondaryClass} py-2`}>No acceptance records found.</p>
            ) : (
              <div className="space-y-2">
                {acceptanceHistory.data.map((record, idx) => (
                  <div key={idx} className="p-3 rounded-lg border border-border bg-muted/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span className={`text-sm font-medium ${textPrimaryClass}`}>
                          Version {record.version}
                        </span>
                        {idx === 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">Latest</span>
                        )}
                      </div>
                    </div>
                    <div className={`mt-1.5 text-xs ${textSecondaryClass} space-y-0.5`}>
                      {record.accepted_at && (
                        <p>Accepted: {new Date(record.accepted_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                      )}
                      {record.ip_address && <p>IP: {record.ip_address}</p>}
                      {record.user_agent && (
                        <p>Device: {record.user_agent.length > 60 ? record.user_agent.substring(0, 60) + '-' : record.user_agent}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Violation History */}
          <div className={`py-2 border-b ${borderClass}`}>
            <button aria-label="Alert Triangle"
              aria-expanded={showViolations} onClick={() => setShowViolations(!showViolations)}
              className="w-full flex items-center justify-between"
              data-testid="violation-history-toggle"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                <div className="text-left">
                  <span className={textPrimaryClass}>Violation History</span>
                  <p className={`text-xs ${textSecondaryClass}`}>
                    {violationHistory.loading
                      ? 'Loading...'
                      : violationHistory.data?.violations?.length
                      ? `${violationHistory.data.violations.length} record${violationHistory.data.violations.length !== 1 ? 's' : ''} - ${violationHistory.data.total_strikes || 0} strike${(violationHistory.data.total_strikes || 0) !== 1 ? 's' : ''}`
                      : 'No violations - clean record ?'}
                  </p>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 ${textSecondaryClass} transition-transform ${showViolations ? 'rotate-180' : ''}`} />
            </button>

            {showViolations && violationHistory.data && (
              <div className="mt-3 space-y-2">
                {violationHistory.data.violations?.length === 0 ? (
                  <div className="py-4 text-center">
                    <Check className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
                    <p className={`text-sm ${textSecondaryClass}`}>No violations on your account</p>
                  </div>
                ) : (
                  violationHistory.data.violations.map(v => (
                    <div key={v.id} className={`p-3 rounded-lg border border-border bg-muted/20`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${textPrimaryClass}`}>{v.title}</p>
                          <p className={`text-xs ${textSecondaryClass} mt-0.5`}>
                            {v.violation_type?.replace(/_/g, ' ')} - {v.severity} - {new Date(v.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex-shrink-0">
                          {v.appeal_status === 'pending' && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">Under Review</span>
                          )}
                          {v.appeal_status === 'approved' && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Overturned</span>
                          )}
                          {v.appeal_status === 'denied' && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">Denied</span>
                          )}
                          {v.status === 'active' && !v.is_appealed && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-400">Active</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Data Deletion Request */}
          <DeleteAccountSection />
        </CardContent>
      )}
    </Card>
  );
};
