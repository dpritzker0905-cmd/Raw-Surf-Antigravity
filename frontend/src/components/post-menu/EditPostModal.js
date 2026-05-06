import React, { useState, useEffect } from 'react';
import { Waves, ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { toast } from 'sonner';
import { TextareaWithEmoji } from '../EmojiPicker';

const EditPostModal = ({ post, open, onClose, onSave, isLight }) => {
  // Helper to extract date part from ISO datetime string
  const extractDatePart = (dateStr) => {
    if (!dateStr) return new Date().toISOString().split('T')[0];
    // Handle ISO datetime strings like "2026-03-31T12:00:00Z"
    if (typeof dateStr === 'string' && dateStr.includes('T')) {
      return dateStr.split('T')[0];
    }
    return dateStr;
  };

  const [caption, setCaption] = useState(post?.caption || '');
  const [location, setLocation] = useState(post?.location || '');
  const [sessionDate, setSessionDate] = useState(extractDatePart(post?.session_date));
  const [sessionStartTime, setSessionStartTime] = useState(post?.session_start_time || '');
  const [sessionEndTime, setSessionEndTime] = useState(post?.session_end_time || '');
  const [waveHeightFt, setWaveHeightFt] = useState(post?.wave_height_ft?.toString() || '');
  const [wavePeriodSec, setWavePeriodSec] = useState(post?.wave_period_sec?.toString() || '');
  const [waveDirection, setWaveDirection] = useState(post?.wave_direction || '');
  const [windSpeedMph, setWindSpeedMph] = useState(post?.wind_speed_mph?.toString() || '');
  const [windDirection, setWindDirection] = useState(post?.wind_direction || '');
  const [tideStatus, setTideStatus] = useState(post?.tide_status || '');
  const [tideHeightFt, setTideHeightFt] = useState(post?.tide_height_ft?.toString() || '');
  const [loading, setLoading] = useState(false);
  const [showConditions, setShowConditions] = useState(false);

  // Reset state when post changes
  useEffect(() => {
    if (post) {
      setCaption(post.caption || '');
      setLocation(post.location || '');
      setSessionDate(extractDatePart(post.session_date));
      setSessionStartTime(post.session_start_time || '');
      setSessionEndTime(post.session_end_time || '');
      setWaveHeightFt(post.wave_height_ft?.toString() || '');
      setWavePeriodSec(post.wave_period_sec?.toString() || '');
      setWaveDirection(post.wave_direction || '');
      setWindSpeedMph(post.wind_speed_mph?.toString() || '');
      setWindDirection(post.wind_direction || '');
      setTideStatus(post.tide_status || '');
      setTideHeightFt(post.tide_height_ft?.toString() || '');
      // Auto-show conditions if any exist
      setShowConditions(!!(post.wave_height_ft || post.wind_speed_mph || post.tide_status));
    }
  }, [post]);

  const handleSave = async () => {
    setLoading(true);
    try {
      await onSave({ 
        caption,
        location: location || null,
        session_date: sessionDate || null,
        session_start_time: sessionStartTime || null,
        session_end_time: sessionEndTime || null,
        wave_height_ft: waveHeightFt ? parseFloat(waveHeightFt) : null,
        wave_period_sec: wavePeriodSec ? parseFloat(wavePeriodSec) : null,
        wave_direction: waveDirection || null,
        wind_speed_mph: windSpeedMph ? parseFloat(windSpeedMph) : null,
        wind_direction: windDirection || null,
        tide_status: tideStatus || null,
        tide_height_ft: tideHeightFt ? parseFloat(tideHeightFt) : null
      });
      onClose();
    } catch (error) {
      toast.error('Failed to update post');
    } finally {
      setLoading(false);
    }
  };

  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const tideStatuses = ['Rising', 'Falling', 'High', 'Low'];
  const bgColor = isLight ? 'bg-white' : 'bg-zinc-900';
  const inputBg = isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800 border-zinc-700';
  const textColor = isLight ? 'text-gray-900' : 'text-white';
  const labelColor = isLight ? 'text-gray-700' : 'text-gray-300';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className={`${bgColor} sm:max-w-lg`} aria-describedby="edit-post-description">
        <DialogHeader className="shrink-0 border-b border-zinc-700 px-4 sm:px-6 pt-4 pb-3">
          <DialogTitle className={textColor}>
            Edit Post
          </DialogTitle>
          <DialogDescription id="edit-post-description" className={isLight ? 'text-gray-500' : 'text-gray-400'}>
            Update your post details and session conditions
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {/* Caption with Emoji Picker */}
          <div>
            <Label className={labelColor}>Caption</Label>
            <div className="mt-1">
              <TextareaWithEmoji
                value={caption}
                onChange={setCaption}
                placeholder="Write a caption..."
                rows={3}
                isLight={isLight}
              />
            </div>
          </div>

          {/* Location & Session Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={labelColor}>Location</Label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g., Cocoa Beach"
                className={`mt-1 ${inputBg}`}
              />
            </div>
            <div>
              <Label className={labelColor}>Session Date</Label>
              <Input
                type="date"
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                className={`mt-1 ${inputBg}`}
              />
            </div>
          </div>

          {/* Session Times */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={labelColor}>Start Time</Label>
              <Input
                type="time"
                value={sessionStartTime}
                onChange={(e) => setSessionStartTime(e.target.value)}
                className={`mt-1 ${inputBg}`}
              />
            </div>
            <div>
              <Label className={labelColor}>End Time</Label>
              <Input
                type="time"
                value={sessionEndTime}
                onChange={(e) => setSessionEndTime(e.target.value)}
                className={`mt-1 ${inputBg}`}
              />
            </div>
          </div>

          {/* Conditions Toggle */}
          <button aria-label="Waves"
            type="button"
            aria-expanded={showConditions} onClick={() => setShowConditions(!showConditions)}
            className={`w-full flex items-center justify-between p-3 rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-zinc-800/50'}`}
          >
            <div className="flex items-center gap-2">
              <Waves className="w-4 h-4 text-cyan-400" />
              <span className={`text-sm font-medium ${textColor}`}>Session Conditions</span>
            </div>
            <ChevronDown className={`w-4 h-4 ${isLight ? 'text-gray-400' : 'text-gray-500'} transition-transform ${showConditions ? 'rotate-180' : ''}`} />
          </button>

          {showConditions && (
            <div className={`space-y-4 p-4 rounded-lg border ${isLight ? 'border-gray-200 bg-gray-50' : 'border-zinc-700 bg-zinc-800/30'}`}>
              {/* Wave Conditions */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className={`${labelColor} text-xs`}>Wave Height (ft)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={waveHeightFt}
                    onChange={(e) => setWaveHeightFt(e.target.value)}
                    placeholder="3.5"
                    className={`mt-1 ${inputBg}`}
                  />
                </div>
                <div>
                  <Label className={`${labelColor} text-xs`}>Period (sec)</Label>
                  <Input
                    type="number"
                    step="1"
                    value={wavePeriodSec}
                    onChange={(e) => setWavePeriodSec(e.target.value)}
                    placeholder="8"
                    className={`mt-1 ${inputBg}`}
                  />
                </div>
                <div>
                  <Label className={`${labelColor} text-xs`}>Wave Dir</Label>
                  <Select value={waveDirection} onValueChange={setWaveDirection}>
                    <SelectTrigger className={`mt-1 ${inputBg}`}>
                      <SelectValue placeholder="--" />
                    </SelectTrigger>
                    <SelectContent className={isLight ? 'bg-white' : 'bg-zinc-800 border-zinc-700'}>
                      {directions.map(d => (
                        <SelectItem key={d} value={d} className={textColor}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Wind Conditions */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${labelColor} text-xs`}>Wind Speed (mph)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={windSpeedMph}
                    onChange={(e) => setWindSpeedMph(e.target.value)}
                    placeholder="10"
                    className={`mt-1 ${inputBg}`}
                  />
                </div>
                <div>
                  <Label className={`${labelColor} text-xs`}>Wind Dir</Label>
                  <Select value={windDirection} onValueChange={setWindDirection}>
                    <SelectTrigger className={`mt-1 ${inputBg}`}>
                      <SelectValue placeholder="--" />
                    </SelectTrigger>
                    <SelectContent className={isLight ? 'bg-white' : 'bg-zinc-800 border-zinc-700'}>
                      {directions.map(d => (
                        <SelectItem key={d} value={d} className={textColor}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Tide Conditions */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={`${labelColor} text-xs`}>Tide Status</Label>
                  <Select value={tideStatus} onValueChange={setTideStatus}>
                    <SelectTrigger className={`mt-1 ${inputBg}`}>
                      <SelectValue placeholder="--" />
                    </SelectTrigger>
                    <SelectContent className={isLight ? 'bg-white' : 'bg-zinc-800 border-zinc-700'}>
                      {tideStatuses.map(s => (
                        <SelectItem key={s} value={s} className={textColor}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className={`${labelColor} text-xs`}>Tide Height (ft)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={tideHeightFt}
                    onChange={(e) => setTideHeightFt(e.target.value)}
                    placeholder="2.5"
                    className={`mt-1 ${inputBg}`}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button aria-label="Loader2" 
            onClick={handleSave} 
            disabled={loading}
            className="bg-gradient-to-r from-cyan-500 to-blue-600"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditPostModal;
