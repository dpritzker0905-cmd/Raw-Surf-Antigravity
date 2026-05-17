/**
 * SpotHubConditionsTab - Condition Reports + Surf Reports tab content
 * Extracted from SpotHub.js for modularization (v70)
 */
import React from 'react';
import { Camera, Users, Waves, Wind, CloudRain, MessageCircle, Star, Flag } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { getFullUrl } from '../../utils/media';

var conditionColors = {
  "Flat": { bg: "bg-gray-500" }, "Ankle High": { bg: "bg-blue-400" },
  "Knee High": { bg: "bg-blue-500" }, "Waist High": { bg: "bg-emerald-400" },
  "Chest High": { bg: "bg-emerald-500" }, "Head High": { bg: "bg-yellow-400" },
  "Overhead": { bg: "bg-orange-400" }, "Double Overhead": { bg: "bg-orange-500" },
  "Triple Overhead+": { bg: "bg-red-500" }
};

var SpotHubConditionsTab = ({
  conditionReports, surfReports, spot,
  isLight, textPrimary, textSecondary,
  onReportConditionReport, onLightboxOpen,
}) => (
  <div className="space-y-3">
    {/* Photographer Condition Reports */}
    {conditionReports.length > 0 && (
      <div className="space-y-2">
        <p className={`text-[10px] font-medium ${textSecondary} uppercase tracking-wider flex items-center gap-1`}>
          <Camera className="w-3 h-3 text-cyan-400" /> Live Condition Reports
        </p>
        {conditionReports.map((report) => (
          <div key={report.id} className={`p-2.5 rounded-lg border ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-900/50 border-zinc-800'}`}>
            <div className="flex items-center gap-2">
              <Avatar className="w-8 h-8 ring-2 ring-cyan-500">
                <AvatarImage src={getFullUrl(report.photographer_avatar)} />
                <AvatarFallback className="text-xs">{report.photographer_name?.[0]}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${textPrimary}`}>{report.photographer_name}</p>
                <p className={`text-[10px] ${textSecondary}`}>{report.time_ago}</p>
              </div>
              {report.conditions_label && (
                <Badge className={`text-[10px] ${conditionColors[report.conditions_label]?.bg || 'bg-gray-500'}`}>
                  {report.conditions_label}
                </Badge>
              )}
              <button aria-label="Report"
                onClick={(e) => { e.stopPropagation(); onReportConditionReport(report.id); }}
                className={`p-1.5 rounded-full transition-colors ${isLight ? 'hover:bg-red-50 text-gray-400 hover:text-red-500' : 'hover:bg-red-500/10 text-gray-600 hover:text-red-400'}`}
                title="Report this content"
                data-testid={`report-cr-${report.id}`}
              >
                <Flag className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className={`text-xs mt-1.5 ${textSecondary}`}>
              Captured {new Date(report.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {new Date(report.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })} - {report.spot_name || spot?.name || 'Unknown Spot'}
            </p>
            <div className="flex items-center gap-3 mt-1.5">
              {report.wave_height_ft && (
                <span className="text-xs flex items-center gap-1">
                  <Waves className="w-3 h-3 text-cyan-400" />
                  <span className={textPrimary}>{report.wave_height_ft}ft</span>
                </span>
              )}
              {report.wind_conditions && (
                <span className="text-xs flex items-center gap-1">
                  <Wind className="w-3 h-3 text-emerald-400" />
                  <span className={textPrimary}>{report.wind_conditions}</span>
                </span>
              )}
              {report.crowd_level && (
                <span className="text-xs flex items-center gap-1">
                  <Users className="w-3 h-3 text-purple-400" />
                  <span className={textPrimary}>{report.crowd_level}</span>
                </span>
              )}
            </div>
            {(() => {
              const candidateUrls = [report.media_url, report.thumbnail_url]
                .filter(url => url && url.trim() && !url.startsWith('/api/uploads/'));
              const primaryUrl = candidateUrls[0];
              const fallbackUrl = candidateUrls[1];
              if (!primaryUrl) return null;
              return (
                <img loading="lazy" decoding="async"
                  src={getFullUrl(primaryUrl)} alt=""
                  className="mt-2 w-full h-56 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => onLightboxOpen(getFullUrl(primaryUrl))}
                  onError={(e) => {
                    if (fallbackUrl && e.target.src !== getFullUrl(fallbackUrl)) {
                      e.target.src = getFullUrl(fallbackUrl);
                    } else { e.target.style.display = 'none'; }
                  }}
                />
              );
            })()}
          </div>
        ))}
      </div>
    )}

    {/* Community Surf Reports */}
    {surfReports.length > 0 && (
      <div className="space-y-2">
        <p className={`text-[10px] font-medium ${textSecondary} uppercase tracking-wider flex items-center gap-1`}>
          <CloudRain className="w-3 h-3 text-emerald-400" /> Community Surf Reports
        </p>
        {surfReports.map((report) => (
          <div key={report.id} className={`p-2.5 rounded-lg border ${isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-900/50 border-zinc-800'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 flex-wrap">
                {report.conditions && (
                  <Badge className={`text-[10px] ${conditionColors[report.conditions]?.bg || 'bg-emerald-500'}`}>{report.conditions}</Badge>
                )}
                {report.wave_height && (
                  <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-400/30">
                    <Waves className="w-2.5 h-2.5 mr-0.5" />{report.wave_height}
                  </Badge>
                )}
                {report.crowd_level && (
                  <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/30">
                    <Users className="w-2.5 h-2.5 mr-0.5" />{report.crowd_level}
                  </Badge>
                )}
                {report.wind_direction && (
                  <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">
                    <Wind className="w-2.5 h-2.5 mr-0.5" />{report.wind_direction}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {report.rating && (
                  <div className="flex items-center gap-0.5 text-yellow-400">
                    <Star className="w-3 h-3 fill-current" />
                    <span className="text-xs font-bold">{report.rating}</span>
                  </div>
                )}
              </div>
            </div>
            {report.notes && <p className={`text-xs mt-1.5 ${textSecondary}`}>{report.notes}</p>}
            {report.created_at && (
              <p className={`text-[10px] mt-1 ${textSecondary}`}>
                {new Date(report.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        ))}
      </div>
    )}

    {/* Empty state */}
    {conditionReports.length === 0 && surfReports.length === 0 && (
      <div className="text-center py-8 text-gray-400">
        <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No condition reports yet</p>
        <p className="text-xs">Photographers will post when they start shooting</p>
      </div>
    )}
  </div>
);

export default SpotHubConditionsTab;
