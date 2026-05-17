/**
 * AdminSessionsPanel - Force Start/End Live Sessions
 * Extracted from UnifiedAdminConsole.js (v76 decomposition)
 */
import React from 'react';
import {
  Play, Square, Loader2, MapPin, Camera, Upload, X
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';

export var AdminSessionsPanel = ({
  loadingPhotographers,
  filteredPhotographers,
  filteredSpots,
  selectedPhotographer,
  setSelectedPhotographer,
  selectedSpot,
  setSelectedSpot,
  photographerSearch,
  setPhotographerSearch,
  spotSearch,
  setSpotSearch,
  sessionPrice,
  setSessionPrice,
  spotNotes,
  setSpotNotes,
  conditionMedia,
  conditionMediaType,
  mediaPreview,
  handleMediaSelect,
  clearMedia,
  fileInputRef,
  handleForceStart,
  forceStartLoading,
  activeSessions,
  handleForceEnd,
  forceEndLoading,
  cardBgClass,
  textClass,
  textSecondary,
}) => {
  return (
    <div className="space-y-4">
      {loadingPhotographers ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
          <span className={`ml-2 text-sm ${textSecondary}`}>Loading data...</span>
        </div>
      ) : (
        <>
          {/* Force Start Section */}
          <Card className={`${cardBgClass} border-green-500/30`}>
            <CardHeader>
              <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
                <Play className="w-4 h-4 text-green-500" />
                Force Start Session
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Photographer Selector */}
              <div>
                <label className={`text-xs ${textSecondary} mb-1 block`}>Photographer</label>
                <Input
                  placeholder="Search photographers..."
                  value={photographerSearch}
                  onChange={(e) => setPhotographerSearch(e.target.value)}
                  className="mb-2 bg-card border-input h-9 text-sm"
                />
                <select
                  value={selectedPhotographer}
                  onChange={(e) => setSelectedPhotographer(e.target.value)}
                  className="w-full h-10 px-3 rounded-md bg-card border border-input text-foreground text-sm"
                >
                  <option value="">Select photographer...</option>
                  {filteredPhotographers.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.is_shooting}>
                      {p.full_name} {p.is_shooting ? '(LIVE)' : ''} - {p.role}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Location Selector */}
              <div>
                <label className={`text-xs ${textSecondary} mb-1 block`}>Surf Spot</label>
                <Input
                  placeholder="Search spots..."
                  value={spotSearch}
                  onChange={(e) => setSpotSearch(e.target.value)}
                  className="mb-2 bg-card border-input h-9 text-sm"
                />
                <select
                  value={selectedSpot}
                  onChange={(e) => setSelectedSpot(e.target.value)}
                  className="w-full h-10 px-3 rounded-md bg-card border border-input text-foreground text-sm"
                >
                  <option value="">Select surf spot...</option>
                  {filteredSpots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} - {s.region}
                    </option>
                  ))}
                </select>
              </div>
              
              {/* Session Price */}
              <div>
                <label className={`text-xs ${textSecondary} mb-1 block`}>Buy-in Price ($)</label>
                <Input
                  type="number"
                  value={sessionPrice}
                  onChange={(e) => setSessionPrice(e.target.value)}
                  className="bg-card border-input h-9 text-sm w-24"
                  min="0"
                />
              </div>
              
              {/* Media Upload */}
              <div>
                <label className={`text-xs ${textSecondary} mb-1 block`}>Conditions Media</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleMediaSelect}
                  className="hidden"
                />
                {mediaPreview ? (
                  <div className="relative">
                    {conditionMediaType === 'video' ? (
                      <video src={mediaPreview} className="w-full h-24 object-cover rounded-lg" controls />
                    ) : (
                      <img loading="lazy" decoding="async" src={mediaPreview} alt="Conditions" className="w-full h-24 object-cover rounded-lg" />
                    )}
                    <button aria-label="Close"
                      onClick={clearMedia}
                      className="absolute top-1 right-1 p-1 bg-black/60 rounded-full"
                    ><X className="w-4 h-4 text-foreground" />
                    </button>
                  </div>
                ) : (
                  <Button aria-label="Upload"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-dashed border-input h-16"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Photo/Video
                  </Button>
                )}
              </div>
              
              {/* Notes */}
              <div>
                <label className={`text-xs ${textSecondary} mb-1 block`}>Spot Notes</label>
                <Textarea
                  placeholder="e.g., 3-4ft, glassy..."
                  value={spotNotes}
                  onChange={(e) => setSpotNotes(e.target.value)}
                  className="bg-card border-input text-sm h-14 resize-none"
                />
              </div>
              
              <Button aria-label="Loader2"
                onClick={handleForceStart}
                disabled={forceStartLoading || !selectedPhotographer || !selectedSpot}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold"
              >
                {forceStartLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                Force Start Session
              </Button>
            </CardContent>
          </Card>
          
          {/* Active Sessions */}
          <Card className={`${cardBgClass} border-red-500/30`}>
            <CardHeader>
              <CardTitle className={`${textClass} text-sm flex items-center gap-2`}>
                <Square className="w-4 h-4 text-red-500" />
                Active Sessions ({activeSessions.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeSessions.length === 0 ? (
                <p className={`text-sm ${textSecondary} text-center py-4`}>
                  No active sessions
                </p>
              ) : (
                <div className="space-y-2">
                  {activeSessions.map((session) => (
                    <div 
                      key={session.id}
                      className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 flex items-center gap-3"
                    >
                      <Avatar className="w-10 h-10">
                        <AvatarImage src={session.photographer_avatar} />
                        <AvatarFallback className="bg-input">
                          <Camera className="w-4 h-4" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm ${textClass} truncate flex items-center gap-2`}>
                          {session.photographer_name}
                          <span className="px-1.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded animate-pulse">
                            LIVE
                          </span>
                        </p>
                        <p className={`text-xs ${textSecondary} flex items-center gap-1`}>
                          <MapPin className="w-3 h-3" />
                          {session.spot_name}
                        </p>
                      </div>
                      <Button aria-label="Loader2"
                        size="sm"
                        variant="destructive"
                        onClick={() => handleForceEnd(session.photographer_id)}
                        disabled={forceEndLoading === session.photographer_id}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        {forceEndLoading === session.photographer_id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <Square className="w-3 h-3 mr-1" />
                            End
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default AdminSessionsPanel;
