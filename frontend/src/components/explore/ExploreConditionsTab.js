/**
 * ExploreConditionsTab.js
 * Extracted from Explore.js — Conditions/Reports tab with 3 sub-tabs:
 * Today / Yesterday / Archives
 *
 * Includes: hierarchical location picker, nearby mode toggle,
 * archive date carousel, gallery cards, and condition report cards.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Radio, Clock, Archive, Waves, Globe, MapPin, Compass,
  ChevronDown, ChevronRight, X, Camera, FolderOpen, Navigation
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { getCountryFlag } from '../../utils/countryFlags';

const ExploreConditionsTab = ({
  // Sub-tab state
  conditionsSubTab,
  handleConditionsSubTabChange,
  // Report data
  conditionReports,
  conditionsLoading,
  // Location mode
  conditionsLocMode,
  setConditionsLocMode,
  userLocation,
  setUserLocation,
  // Location hierarchy
  conditionsCountry,
  conditionsState,
  conditionsCity,
  conditionsCountryOptions,
  conditionsStateOptions,
  conditionsCityOptions,
  handleConditionsCountryChange,
  handleConditionsStateChange,
  handleConditionsCityChange,
  clearConditionsLocation,
  jumpToConditionsLocation,
  getReportsNearby,
  // Archive state
  archiveDates,
  archiveDate,
  archiveGalleries,
  archiveGalleriesLoading,
  handleArchiveDateSelect,
  // Popular destinations
  popularLocations,
  // Theme classes
  isLight,
  dropdownBg,
  dropdownBorder,
  dropdownText,
  dropdownFocus,
  labelClass,
  chipBg,
  breadcrumbText,
}) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-4" data-testid="conditions-explorer-tab">
      {/* Sub-tab navigation pills */}
      <div className="flex items-center gap-1 bg-muted/50 rounded-xl p-1">
        {[
          { id: 'today', label: 'Today', icon: Radio },
          { id: 'yesterday', label: 'Yesterday', icon: Clock },
          { id: 'archives', label: 'Archives', icon: Archive },
        ].map(({ id, label, icon: Icon }) => (
          <button aria-label={label}
            key={id}
            onClick={() => handleConditionsSubTabChange(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-sm font-medium transition-all ${
              conditionsSubTab === id
                ? 'bg-cyan-500/20 text-cyan-400 shadow-sm'
                : 'text-gray-400 hover:text-gray-200 hover:bg-zinc-700/50'
            }`}
            data-testid={`conditions-subtab-${id}`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {id === 'today' && conditionsSubTab === 'today' && conditionReports.some(r => r.is_photographer_live) && (
              <span className="ml-0.5 w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Header row with title + report count */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Waves className="w-5 h-5 text-cyan-400" />
          <h2 className="font-bold text-foreground">
            {conditionsSubTab === 'today' ? "Today's Reports" 
              : conditionsSubTab === 'yesterday' ? "Yesterday's Reports" 
              : "Session Archives"}
          </h2>
          {conditionsSubTab !== 'archives' && (
            <Badge className="bg-cyan-500/20 text-cyan-400 text-xs">
              {conditionReports.length} reports
            </Badge>
          )}
        </div>
      </div>
      
      {/* Browse / Nearby Toggle */}
      <div className="flex gap-2 p-1 bg-zinc-900 rounded-xl border border-zinc-800">
        <button aria-label="Browse locations"
          onClick={() => { setConditionsLocMode('browse'); setUserLocation(null); }}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
            conditionsLocMode === 'browse'
              ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/20'
              : 'text-gray-400 hover:text-gray-200 hover:bg-zinc-800'
          }`}
          data-testid="conditions-browse-btn"
        >
          <Globe className="w-4 h-4" />
          Browse
        </button>
        <button aria-label="Find nearby reports"
          onClick={getReportsNearby}
          className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
            conditionsLocMode === 'nearby'
              ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20'
              : 'text-gray-400 hover:text-gray-200 hover:bg-zinc-800'
          }`}
          data-testid="conditions-nearby-btn"
        >
          <Compass className="w-4 h-4" />
          Nearby
          {userLocation && conditionsLocMode === 'nearby' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
        </button>
      </div>
      
      {/* Hierarchical Location Dropdowns (Browse mode) */}
      {conditionsLocMode === 'browse' && (
        <div className="space-y-3">
          {/* Country Dropdown */}
          <div>
            <label className={`block text-xs uppercase tracking-wider font-medium mb-1.5 ${labelClass}`}>Country</label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cyan-400 pointer-events-none z-10" />
              <select
                value={conditionsCountry}
                onChange={(e) => handleConditionsCountryChange(e.target.value)}
                className={`w-full pl-10 pr-10 py-3 ${dropdownBg} border ${dropdownBorder} rounded-xl ${dropdownText} text-sm focus:outline-none ${dropdownFocus} focus:ring-1 transition-all appearance-none cursor-pointer`}
                data-testid="conditions-country-dropdown"
              >
                <option value="">All Countries</option>
                {conditionsCountryOptions.map(name => (
                  <option key={name} value={name}>{getCountryFlag(name)} {name}</option>
                ))}
              </select>
              <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-500'} pointer-events-none`} />
            </div>
          </div>
          
          {/* State/Province Dropdown */}
          {conditionsCountry && conditionsStateOptions.length > 0 && (
            <div>
              <label className={`block text-xs uppercase tracking-wider font-medium mb-1.5 ${labelClass}`}>State / Province</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400 pointer-events-none z-10" />
                <select
                  value={conditionsState}
                  onChange={(e) => handleConditionsStateChange(e.target.value)}
                  className={`w-full pl-10 pr-10 py-3 ${dropdownBg} border ${dropdownBorder} rounded-xl ${dropdownText} text-sm focus:outline-none ${isLight ? 'focus:border-blue-500 focus:ring-blue-200/30' : 'focus:border-blue-500/50 focus:ring-blue-500/20'} focus:ring-1 transition-all appearance-none cursor-pointer`}
                  data-testid="conditions-state-dropdown"
                >
                  <option value="">All States</option>
                  {conditionsStateOptions.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-500'} pointer-events-none`} />
              </div>
            </div>
          )}
          
          {/* City/Area Dropdown */}
          {conditionsState && conditionsCityOptions.length > 0 && (
            <div>
              <label className={`block text-xs uppercase tracking-wider font-medium mb-1.5 ${labelClass}`}>City / Area</label>
              <div className="relative">
                <Navigation className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400 pointer-events-none z-10" />
                <select
                  value={conditionsCity}
                  onChange={(e) => handleConditionsCityChange(e.target.value)}
                  className={`w-full pl-10 pr-10 py-3 ${dropdownBg} border ${dropdownBorder} rounded-xl ${dropdownText} text-sm focus:outline-none ${isLight ? 'focus:border-emerald-500 focus:ring-emerald-200/30' : 'focus:border-emerald-500/50 focus:ring-emerald-500/20'} focus:ring-1 transition-all appearance-none cursor-pointer`}
                  data-testid="conditions-city-dropdown"
                >
                  <option value="">All Cities</option>
                  {conditionsCityOptions.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-500'} pointer-events-none`} />
              </div>
            </div>
          )}
          
          {/* Popular Destinations - show when no country selected */}
          {!conditionsCountry && (
            <div>
              <p className={`text-xs uppercase tracking-wider font-medium mb-2 ${labelClass}`}>Popular Destinations</p>
              <div className="flex flex-wrap gap-2">
                {popularLocations.map((loc, i) => (
                  <button
                    key={i}
                    onClick={() => jumpToConditionsLocation(loc)}
                    className={`px-3 py-1.5 border rounded-full text-xs transition-all ${chipBg}`}
                    data-testid={`conditions-quick-loc-${i}`}
                  >
                    {loc.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {/* Selection breadcrumb + Clear */}
          {conditionsCountry && (
            <div className="flex items-center gap-1.5 text-sm flex-wrap">
              <span className="text-lg">{getCountryFlag(conditionsCountry)}</span>
              <span className={`${breadcrumbText} font-medium`}>{conditionsCountry}</span>
              {conditionsState && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
                  <span className={isLight ? 'text-blue-600' : 'text-blue-400'}>{conditionsState}</span>
                </>
              )}
              {conditionsCity && (
                <>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
                  <span className={isLight ? 'text-emerald-600' : 'text-emerald-400'}>{conditionsCity}</span>
                </>
              )}
              <button aria-label="Clear location filter"
                onClick={clearConditionsLocation}
                className={`ml-auto text-xs flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${isLight ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-500 hover:text-gray-300 hover:bg-zinc-800'}`}
              ><X className="w-3 h-3" /> Clear
              </button>
            </div>
          )}
        </div>
      )}
      
      {/* Nearby Mode Indicator */}
      {conditionsLocMode === 'nearby' && userLocation && (
        <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <Compass className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-300">Showing reports sorted by distance from you</span>
          <button aria-label="Clear nearby filter"
            onClick={clearConditionsLocation}
            className="ml-auto text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
          ><X className="w-3 h-3" /> Clear
          </button>
        </div>
      )}

      {/* Archives: Date Carousel + Gallery Cards */}
      {conditionsSubTab === 'archives' && (
        <div className="space-y-4">
          
          {/* Scrollable date chips */}
          {archiveDates.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {archiveDates.map((d) => {
                const dateObj = new Date(d.date + 'T12:00:00Z');
                const isSelected = archiveDate === d.date;
                return (
                  <button
                    key={d.date}
                    onClick={() => handleArchiveDateSelect(d.date)}
                    className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                        : 'bg-muted text-gray-400 hover:bg-zinc-700 border border-transparent'
                    }`}
                  >
                    <span className="text-[10px] uppercase opacity-70">
                      {dateObj.toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                    <span className="text-sm font-bold">
                      {dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <span className="text-[10px] mt-0.5 opacity-60">
                      {d.report_count} {d.report_count === 1 ? 'report' : 'reports'}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <Archive className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No archived reports found</p>
            </div>
          )}

          {/* Archive Gallery Cards */}
          {archiveDate && (
            <>
              {archiveGalleriesLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
                </div>
              ) : archiveGalleries.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-gray-400 flex items-center gap-1.5">
                    <FolderOpen className="w-4 h-4" />
                    Session Galleries
                  </h3>
                  {archiveGalleries.map((gallery) => (
                    <div
                      key={gallery.id}
                      onClick={() => navigate(`/photographer/${gallery.photographer_id}/gallery?gallery=${gallery.id}`)}
                      className="flex items-center gap-3 p-3 bg-muted/50 hover:bg-zinc-700/50 rounded-xl cursor-pointer transition-all group"
                      data-testid={`archive-gallery-${gallery.id}`}
                    >
                      {/* Cover thumbnail */}
                      <div className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-700">
                        {gallery.cover_image_url ? (
                          <img loading="lazy" decoding="async" 
                            src={gallery.cover_image_url} 
                            alt={gallery.title} 
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Camera className="w-6 h-6 text-zinc-600" />
                          </div>
                        )}
                        <div className="absolute bottom-0.5 right-0.5 bg-black/70 rounded px-1 py-0.5">
                          <span className="text-[9px] font-bold text-white">{gallery.item_count}</span>
                        </div>
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h4 className="font-medium text-foreground text-sm truncate">{gallery.title}</h4>
                          {gallery.session_type && (
                            <span className={`flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                              gallery.session_type === 'live' ? 'bg-green-500/20 text-green-400' :
                              gallery.session_type === 'on_demand' ? 'bg-yellow-500/20 text-yellow-400' :
                              gallery.session_type === 'booking' ? 'bg-purple-500/20 text-purple-400' :
                              'bg-zinc-500/20 text-zinc-400'
                            }`}>
                              {gallery.session_type === 'live' ? 'LIVE' :
                               gallery.session_type === 'on_demand' ? 'ON-DEMAND' :
                               gallery.session_type === 'booking' ? 'BOOKING' : 'MANUAL'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                          {gallery.photographer_avatar ? (
                            <img loading="lazy" decoding="async" src={gallery.photographer_avatar} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
                          ) : (
                            <Camera className="w-3.5 h-3.5 text-yellow-400" />
                          )}
                          <span className="truncate">{gallery.photographer_name || 'Photographer'}</span>
                        </div>
                        {gallery.conditions && (
                          <div className="flex items-center gap-1.5 mt-1">
                            {gallery.conditions.wave_height_ft && (
                              <Badge className="bg-blue-500/20 text-blue-400 text-[10px] py-0 px-1.5">
                                {gallery.conditions.wave_height_ft}ft
                              </Badge>
                            )}
                            {gallery.conditions.conditions_label && (
                              <Badge className="bg-teal-500/20 text-teal-400 text-[10px] py-0 px-1.5">
                                {gallery.conditions.conditions_label}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-cyan-400 transition-colors flex-shrink-0" />
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      {/* Report List (shared between today/yesterday/archive-date) */}
      {conditionsLoading ? (
        <div className="flex justify-center py-10">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
        </div>
      ) : conditionReports.length === 0 && conditionsSubTab !== 'archives' ? (
        /* Empty State */
        <div className="text-center py-12 text-muted-foreground">
          <Waves className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="font-medium mb-1">
            {conditionsSubTab === 'yesterday' ? "No reports from yesterday" : "No reports from today yet"}
          </p>
          <p className="text-sm text-gray-500">
            {conditionsSubTab === 'yesterday' ? "Check the Archives for older reports" : "Check back when photographers go live!"}
          </p>
        </div>
      ) : conditionReports.length === 0 && conditionsSubTab === 'archives' && archiveDate ? (
        <div className="text-center py-8 text-muted-foreground">
          <Waves className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No reports for this date</p>
        </div>
      ) : conditionReports.length > 0 ? (
        /* Conditions Reports List */
        <div className="space-y-3">
          {conditionsSubTab === 'archives' && archiveDate && (
            <h3 className="text-sm font-semibold text-gray-400 flex items-center gap-1.5">
              <Waves className="w-4 h-4" />
              Condition Reports
            </h3>
          )}
          {conditionReports.map((report) => {
            const hasGallery = report.gallery_id && report.gallery_item_count > 0;
            return (
            <div
              key={report.id}
              className={`bg-muted/50 rounded-xl overflow-hidden transition-colors ${isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-700/50'}`}
              data-testid={`condition-report-${report.id}`}
            >
              {/* Main card body - clicks to SpotHub */}
              <div
                onClick={() => {
                  if (report.spot_id) {
                    navigate(`/spot-hub/${report.spot_id}`);
                  } else {
                    navigate(`/profile/${report.photographer_id}`);
                  }
                }}
                className="flex items-center gap-4 p-4 cursor-pointer group"
              >
                {/* Thumbnail */}
                <div className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-700">
                  {(report.thumbnail_url || report.media_url) ? (
                    <img loading="lazy" decoding="async" 
                      src={report.thumbnail_url || report.media_url} 
                      alt={report.spot_name || 'Conditions'} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Waves className="w-8 h-8 text-zinc-600" />
                    </div>
                  )}
                  {/* Wave Height Badge */}
                  {report.wave_height_ft && (
                    <div className="absolute bottom-1 left-1 flex items-center gap-0.5 bg-blue-500/90 backdrop-blur-sm rounded-full px-1.5 py-0.5">
                      <Waves className="w-2.5 h-2.5 text-foreground" />
                      <span className="text-[10px] font-bold text-foreground">{report.wave_height_ft}ft</span>
                    </div>
                  )}
                  {/* Live Shooting Indicator */}
                  {report.is_photographer_live && (
                    <div className="absolute top-1 right-1 w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse" />
                  )}
                  {/* Gallery link badge */}
                  {hasGallery && (
                    <div className="absolute top-1 left-1 bg-black/70 backdrop-blur-sm rounded px-1 py-0.5">
                      <span className="text-[9px] font-bold text-cyan-400">{report.gallery_item_count}</span>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-medium text-foreground truncate">{report.spot_name || 'Unknown Spot'}</h4>
                    {report.conditions_label && (
                      <Badge className="bg-blue-500/20 text-blue-400 text-xs">
                        {report.conditions_label}
                      </Badge>
                    )}
                  </div>
                  
                  {/* Photographer Info */}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      {report.photographer_avatar ? (
                        <img loading="lazy" decoding="async" 
                          src={report.photographer_avatar} 
                          alt={report.photographer_name} 
                          className="w-4 h-4 rounded-full object-cover"
                        />
                      ) : (
                        <Camera className="w-4 h-4 text-yellow-400" />
                      )}
                      <span className="truncate">{report.photographer_name || 'Photographer'}</span>
                    </div>
                    <span className="text-gray-600">{'\u00B7'}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {report.time_ago}
                    </span>
                  </div>
                  
                  {/* Caption Preview */}
                  {report.caption && (
                    <p className="text-xs text-gray-500 truncate mt-1">{report.caption}</p>
                  )}
                </div>

                {/* Arrow */}
                <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-cyan-400 transition-colors flex-shrink-0" />
              </div>

              {/* Action buttons row - View Spot always, View Gallery when gallery linked */}
              <div className="flex gap-2 px-4 pb-3 pt-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (report.spot_id) {
                      navigate(`/spot-hub/${report.spot_id}`);
                    } else {
                      navigate(`/profile/${report.photographer_id}`);
                    }
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all ${
                    isLight
                      ? 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-gray-300 border border-zinc-700'
                  }`}
                >
                  <Waves className="w-3.5 h-3.5" />
                  View Spot
                </button>
                {hasGallery && (
                  <button aria-label="View gallery"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/photographer/${report.photographer_id}/gallery?gallery=${report.gallery_id}`);
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all bg-gradient-to-r from-cyan-500/20 to-blue-500/20 hover:from-cyan-500/30 hover:to-blue-500/30 text-cyan-400 border border-cyan-500/30 hover:border-cyan-500/50"
                    data-testid={`view-gallery-${report.id}`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    View Gallery
                    <span className="bg-cyan-500/30 rounded-full px-1.5 py-0 text-[10px] font-bold">{report.gallery_item_count}</span>
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default React.memo(ExploreConditionsTab);
