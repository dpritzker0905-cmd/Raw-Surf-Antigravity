/**
 * AdminP1ComplianceTab - ToS Violations & Compliance tab panel
 * Extracted from AdminP1Dashboard.js for modularization (v74)
 */
import React from 'react';
import {
  AlertTriangle, Flag, MapPin, Scale, Ban, Calendar, RefreshCw,
  Loader2, ThumbsUp, ThumbsDown,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';

const AdminP1ComplianceTab = ({
  complianceStats, complianceFilter, setComplianceFilter,
  locationFraudMapData, pendingAppeals, recentViolations,
  selectedAppeals, toggleAppealSelection, selectAllAppeals,
  handleBulkReviewAppeals, bulkProcessing,
  setSelectedViolation, setShowViolationDetail,
  fetchComplianceData, formatDate,
  cardBgClass, textClass, textSecondary,
}) => (
  <div className="space-y-4" data-testid="compliance-tab">
    {/* Stats Cards */}
    {complianceStats && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className={`${cardBgClass} border`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/20">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <p className={`text-2xl font-bold ${textClass}`}>{complianceStats.total_violations}</p>
                <p className={`text-xs ${textSecondary}`}>Total Violations</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className={`${cardBgClass} border`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/20">
                <MapPin className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className={`text-2xl font-bold ${textClass}`}>{complianceStats.location_fraud_count}</p>
                <p className={`text-xs ${textSecondary}`}>Location Fraud</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className={`${cardBgClass} border`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-500/20">
                <Scale className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <p className={`text-2xl font-bold ${textClass}`}>{complianceStats.pending_appeals}</p>
                <p className={`text-xs ${textSecondary}`}>Pending Appeals</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className={`${cardBgClass} border`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/20">
                <Ban className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className={`text-2xl font-bold ${textClass}`}>{complianceStats.suspended_users + complianceStats.banned_users}</p>
                <p className={`text-xs ${textSecondary}`}>Suspended/Banned</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    )}

    {/* Week Summary */}
    {complianceStats && (
      <Card className={`${cardBgClass} border border-blue-500/30`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-blue-400" />
              <span className={textClass}>This Week: <strong>{complianceStats.violations_this_week}</strong> new violations</span>
            </div>
            <Button aria-label="Refresh"
              size="sm"
              variant="outline"
              onClick={fetchComplianceData}
              className="gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>
    )}

    {/* Location Fraud Map Visualization */}
    {locationFraudMapData.length > 0 && (
      <Card className={`${cardBgClass} border border-red-500/30`}>
        <CardHeader className="pb-2">
          <CardTitle className={`text-sm ${textClass} flex items-center gap-2`}>
            <MapPin className="w-4 h-4 text-red-400" />
            Location Fraud Map ({locationFraudMapData.length} incidents)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {/* Legend */}
            <div className="flex gap-4 text-xs">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                <span className={textSecondary}>Claimed Location</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span className={textSecondary}>Actual Location</span>
              </div>
            </div>
            
            {/* Fraud Incidents List */}
            <div className="max-h-60 overflow-y-auto space-y-2">
              {locationFraudMapData.map((fraud, _idx) => (
                <div 
                  key={fraud.id}
                  className="p-3 rounded-lg bg-muted/50 border border-border"
                >
                  <div className="flex items-center justify-between mb-2">
                    <Badge className={`text-[10px] ${
                      fraud.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                      fraud.severity === 'severe' ? 'bg-orange-500/20 text-orange-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {fraud.severity} - {fraud.distance_miles?.toFixed(1)} mi
                    </Badge>
                    <span className={`text-[10px] ${textSecondary}`}>
                      {formatDate(fraud.created_at)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                      <span className={textSecondary}>
                        Claimed: {fraud.claimed[0]?.toFixed(4)}, {fraud.claimed[1]?.toFixed(4)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-red-500"></div>
                      <span className={textSecondary}>
                        Actual: {fraud.actual[0]?.toFixed(4)}, {fraud.actual[1]?.toFixed(4)}
                      </span>
                    </div>
                  </div>
                  {/* Visual Distance Bar */}
                  <div className="mt-2 h-1.5 bg-input rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${
                        fraud.distance_miles > 50 ? 'bg-red-500' :
                        fraud.distance_miles > 10 ? 'bg-orange-500' :
                        'bg-yellow-500'
                      }`}
                      style={{ width: `${Math.min((fraud.distance_miles / 100) * 100, 100)}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    )}

    {/* Pending Appeals Section with Bulk Actions */}
    {pendingAppeals.length > 0 && (
      <Card className={`${cardBgClass} border border-orange-500/30`}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className={`text-sm ${textClass} flex items-center gap-2`}>
              <Scale className="w-4 h-4 text-orange-400" />
              Pending Appeals ({pendingAppeals.length})
            </CardTitle>
            
            {/* Bulk Actions */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={selectAllAppeals}
                className="h-7 text-xs"
              >
                {selectedAppeals.size === pendingAppeals.length ? 'Deselect All' : 'Select All'}
              </Button>
              
              {selectedAppeals.size > 0 && (
                <>
                  <Button aria-label="Loader2"
                    size="sm"
                    variant="outline"
                    onClick={() => handleBulkReviewAppeals(true)}
                    disabled={bulkProcessing}
                    className="h-7 text-xs border-green-500 text-green-400 hover:bg-green-500/20"
                  >
                    {bulkProcessing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ThumbsUp className="w-3 h-3 mr-1" />}
                    Approve ({selectedAppeals.size})
                  </Button>
                  <Button aria-label="Loader2"
                    size="sm"
                    variant="outline"
                    onClick={() => handleBulkReviewAppeals(false)}
                    disabled={bulkProcessing}
                    className="h-7 text-xs border-red-500 text-red-400 hover:bg-red-500/20"
                  >
                    {bulkProcessing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <ThumbsDown className="w-3 h-3 mr-1" />}
                    Deny ({selectedAppeals.size})
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {pendingAppeals.map(violation => (
            <div
              key={violation.id}
              className={`p-3 rounded-lg border transition-colors ${
                selectedAppeals.has(violation.id) 
                  ? 'bg-orange-500/20 border-orange-500' 
                  : 'bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20'
              }`}
              data-testid={`appeal-${violation.id}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <input aria-label="Checkbox"
                    type="checkbox"
                    checked={selectedAppeals.has(violation.id)}
                    onChange={() => toggleAppealSelection(violation.id)}
                    className="w-4 h-4 rounded border-orange-500 bg-muted text-orange-500 focus:ring-orange-500"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div 
                    className="cursor-pointer"
                    onClick={() => {
                      setSelectedViolation(violation);
                      setShowViolationDetail(true);
                    }}
                  >
                    <p className={`font-medium ${textClass}`}>{violation.title}</p>
                    <p className={`text-xs ${textSecondary}`}>
                      {violation.violation_type.replace(/_/g, ' ')} - User: {violation.user_id.slice(0, 8)}...
                    </p>
                  </div>
                </div>
                <Badge className="bg-orange-500/20 text-orange-400">Appeal Pending</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    )}

    {/* Recent Violations List */}
    <Card className={cardBgClass}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className={`text-sm ${textClass}`}>
            <Flag className="w-4 h-4 inline mr-2" />
            Recent Violations
          </CardTitle>
          <Select value={complianceFilter.type} onValueChange={(v) => setComplianceFilter({ type: v })}>
            <SelectTrigger className="w-[140px] h-8 bg-muted border-border">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="location_fraud">Location Fraud</SelectItem>
              <SelectItem value="harassment">Harassment</SelectItem>
              <SelectItem value="scam">Scam</SelectItem>
              <SelectItem value="spam">Spam</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {recentViolations.length === 0 ? (
          <p className={`text-center py-8 ${textSecondary}`}>No violations recorded</p>
        ) : (
          recentViolations
            .filter(v => complianceFilter.type === 'all' || v.violation_type === complianceFilter.type)
            .map(violation => (
              <div
                key={violation.id}
                className={`p-3 rounded-lg ${cardBgClass} border cursor-pointer hover:bg-muted/50 transition-colors`}
                onClick={() => {
                  setSelectedViolation(violation);
                  setShowViolationDetail(true);
                }}
                data-testid={`violation-${violation.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-full ${
                      violation.severity === 'critical' ? 'bg-red-500/20' :
                      violation.severity === 'severe' ? 'bg-orange-500/20' :
                      violation.severity === 'moderate' ? 'bg-yellow-500/20' :
                      'bg-gray-500/20'
                    }`}>
                      {violation.violation_type === 'location_fraud' ? (
                        <MapPin className={`w-4 h-4 ${
                          violation.severity === 'critical' ? 'text-red-400' :
                          violation.severity === 'severe' ? 'text-orange-400' :
                          'text-yellow-400'
                        }`} />
                      ) : (
                        <Flag className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <p className={`font-medium ${textClass}`}>{violation.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge className={`text-[10px] ${
                          violation.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                          violation.severity === 'severe' ? 'bg-orange-500/20 text-orange-400' :
                          violation.severity === 'moderate' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-gray-500/20 text-muted-foreground'
                        }`}>
                          {violation.severity}
                        </Badge>
                        <span className={`text-xs ${textSecondary}`}>
                          {violation.action_taken.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs ${textSecondary}`}>{formatDate(violation.created_at)}</p>
                    {violation.appeal_status && (
                      <Badge className={`mt-1 text-[10px] ${
                        violation.appeal_status === 'pending' ? 'bg-orange-500/20 text-orange-400' :
                        violation.appeal_status === 'approved' ? 'bg-green-500/20 text-green-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        Appeal: {violation.appeal_status}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))
        )}
      </CardContent>
    </Card>
  </div>
);

export default AdminP1ComplianceTab;
