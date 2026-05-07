
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../lib/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { MapPin, Loader2, Navigation, Image, Video, Upload, Camera, Megaphone, Waves, ChevronDown, Wind, ArrowUpDown, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { CreateAdModal } from './CreateAdModal';
import logger from '../utils/logger';
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DirSelect = ({ value, onChange, placeholder = 'Dir' }) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white text-sm"><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent className="bg-zinc-800 border-zinc-700">
      {DIRECTIONS.map(d => <SelectItem key={d} value={d} className="text-white hover:bg-zinc-700">{d}</SelectItem>)}
    </SelectContent>
  </Select>
);
const CreatePostModal = ({ isOpen, onClose, onCreated }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewUrls, setPreviewUrls] = useState([]);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [mediaType, setMediaType] = useState('image');
  const [caption, setCaption] = useState(''); const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false); const [uploadProgress, setUploadProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState(''); const [showCreateAdModal, setShowCreateAdModal] = useState(false);
  const photoInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const [showSessionData, setShowSessionData] = useState(false);
  const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [sessionDate, setSessionDate] = useState(todayLocal());
  const [sessionStartTime, setSessionStartTime] = useState('');
  const [sessionEndTime, setSessionEndTime] = useState('');
  const [waveHeightFt, setWaveHeightFt] = useState('');
  const [wavePeriodSec, setWavePeriodSec] = useState('');
  const [waveDirection, setWaveDirection] = useState('');
  const [waveDirectionDegrees, setWaveDirectionDegrees] = useState(null);
  const [windSpeedMph, setWindSpeedMph] = useState('');
  const [windDirection, setWindDirection] = useState('');
  const [tideStatus, setTideStatus] = useState('');
  const [tideHeightFt, setTideHeightFt] = useState('');
  const [conditionsLoading, setConditionsLoading] = useState(false);
  const [conditionsSource, setConditionsSource] = useState('manual');
  const [knownSpots, setKnownSpots] = useState([]);
  const [selectedSpot, setSelectedSpot] = useState('');
  const [recentLocations, setRecentLocations] = useState([]);
  const [showRecentLocations, setShowRecentLocations] = useState(false);

  useEffect(() => {
    if (isOpen) apiClient.get(`/surf-conditions/known-spots`).then(r => setKnownSpots(r.data.spots || [])).catch(() => {});
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen || !user?.id) return;
    apiClient.get(`/posts/user/${user.id}/recent-locations`).then(r => {
      setRecentLocations(r.data || []);
      if (r.data?.length > 0) setShowRecentLocations(true);
    }).catch(() => {});
  }, [isOpen, user?.id]);

  const handleRecentLocationSelect = async (recentLoc) => {
    setLocation(recentLoc.location);
    setShowRecentLocations(false);
    
    if (recentLoc.latitude && recentLoc.longitude) {
      await fetchConditions(recentLoc.latitude, recentLoc.longitude, recentLoc.location);
    }
  };

  const handleSpotSelect = async (spotKey) => {
    setSelectedSpot(spotKey);
    const spot = knownSpots.find(s => s.key === spotKey);
    if (spot) {
      setLocation(spot.name);
      await fetchConditions(spot.lat, spot.lon, spot.name);
    }
  };

  const fetchConditions = async (lat, lon, spotName) => {
    setConditionsLoading(true);
    try {
      const { data: d } = await apiClient.get(`/surf-conditions`, { params: { latitude: lat, longitude: lon, spot_name: spotName } });
      if (d.wave_height_ft) setWaveHeightFt(d.wave_height_ft.toString());
      if (d.wave_period_sec) setWavePeriodSec(d.wave_period_sec.toString());
      if (d.wave_direction) setWaveDirection(d.wave_direction);
      if (d.wave_direction_degrees) setWaveDirectionDegrees(d.wave_direction_degrees);
      if (d.wind_speed_mph) setWindSpeedMph(d.wind_speed_mph.toString());
      if (d.wind_direction) setWindDirection(d.wind_direction);
      if (d.tide_status) setTideStatus(d.tide_status);
      if (d.tide_height_ft) setTideHeightFt(d.tide_height_ft.toString());
      setConditionsSource('auto'); setShowSessionData(true);
      toast.success('Conditions auto-filled! Feel free to adjust.');
    } catch (e) { toast.error('Could not fetch conditions. Enter manually.'); } finally { setConditionsLoading(false); }
  };

  const fetchConditionsByLocation = async () => {
    if (!navigator.geolocation) { toast.error('Geolocation not supported'); return; }
    setConditionsLoading(true);
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
      });
      await fetchConditions(position.coords.latitude, position.coords.longitude, location || 'Current Location');
    } catch (e) { toast.error('Could not get location. Select a spot instead.'); } finally { setConditionsLoading(false); }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const firstFile = files[0];
    const isVideo = firstFile.type.startsWith('video/');
    const isImage = firstFile.type.startsWith('image/');

    if (!isVideo && !isImage) {
      toast.error('Please select image or video files');
      return;
    }

    if (isVideo) {
      const maxSize = 100 * 1024 * 1024;
      if (firstFile.size > maxSize) {
        toast.error('Video too large. Maximum size is 100MB');
        return;
      }
      // Clear any existing and set single video
      previewUrls.forEach(url => URL.revokeObjectURL(url));
      setSelectedFiles([firstFile]);
      setPreviewUrls([URL.createObjectURL(firstFile)]);
      setMediaType('video');
      setCurrentPreviewIndex(0);
      return;
    }

    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    const maxImages = 10;
    const totalImages = selectedFiles.length + imageFiles.length;
    
    if (totalImages > maxImages) {
      toast.error(`Maximum ${maxImages} photos allowed. You have ${selectedFiles.length}, can add ${maxImages - selectedFiles.length} more.`);
      return;
    }

    const maxSize = 50 * 1024 * 1024;
    const validFiles = [];
    const newPreviews = [];
    
    for (const file of imageFiles) {
      if (file.size > maxSize) {
        toast.error(`${file.name} is too large. Maximum size is 50MB`);
        continue;
      }
      validFiles.push(file);
      newPreviews.push(URL.createObjectURL(file));
    }

    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
      setPreviewUrls(prev => [...prev, ...newPreviews]);
      setMediaType('image');
      setCurrentPreviewIndex(selectedFiles.length);
    }
  };
  
  const removeImage = (index) => {
    URL.revokeObjectURL(previewUrls[index]);
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
    if (currentPreviewIndex >= index && currentPreviewIndex > 0) {
      setCurrentPreviewIndex(prev => prev - 1);
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setLoading(true);
    setUploadProgress(0);

    try {
      const uploadedMedia = [];
      const isCarousel = selectedFiles.length > 1;
      
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const formData = new FormData();
        formData.append('file', file);
        formData.append('user_id', user.id);

        setProcessingStatus(
          isCarousel 
            ? `Uploading photo ${i + 1} of ${selectedFiles.length}...` 
            : (mediaType === 'video' ? 'Uploading & processing video (may transcode to 1080p)...' : 'Uploading...')
        );

        const uploadResponse = await apiClient.post(`/upload/feed`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            const fileProgress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            const overallProgress = Math.round(((i + fileProgress / 100) / selectedFiles.length) * 100);
            setUploadProgress(overallProgress);
          }
        });
        
        uploadedMedia.push({
          url: uploadResponse.data.media_url,
          type: uploadResponse.data.media_type,
          thumbnail_url: uploadResponse.data.thumbnail_url,
          width: uploadResponse.data.final_width,
          height: uploadResponse.data.final_height
        });
      }

      setProcessingStatus('Creating post...');

      const postData = {
        media_url: uploadedMedia[0].url,
        media_type: uploadedMedia[0].type,
        thumbnail_url: uploadedMedia[0].thumbnail_url || null,
        caption: caption || null,
        location: location || null,
        video_width: uploadedMedia[0].width || null,
        video_height: uploadedMedia[0].height || null,
        is_carousel: isCarousel,
        carousel_media: isCarousel ? uploadedMedia : []
      };

      if (showSessionData) {
        if (sessionDate) postData.session_date = sessionDate + 'T12:00:00.000Z';
        if (sessionStartTime) postData.session_start_time = sessionStartTime;
        if (sessionEndTime) postData.session_end_time = sessionEndTime;
        if (waveHeightFt) postData.wave_height_ft = parseFloat(waveHeightFt);
        if (wavePeriodSec) postData.wave_period_sec = parseInt(wavePeriodSec);
        if (waveDirection) postData.wave_direction = waveDirection;
        if (waveDirectionDegrees) postData.wave_direction_degrees = waveDirectionDegrees;
        if (windSpeedMph) postData.wind_speed_mph = parseFloat(windSpeedMph);
        if (windDirection) postData.wind_direction = windDirection;
        if (tideStatus) postData.tide_status = tideStatus;
        if (tideHeightFt) postData.tide_height_ft = parseFloat(tideHeightFt);
        postData.conditions_source = conditionsSource;
      }


      await apiClient.post(`/posts?author_id=${user.id}`, postData);

      if (isCarousel) {
        toast.success(`Posted ${selectedFiles.length} photos!`);
      } else {
        toast.success('Post created successfully!');
      }
      
      onCreated();
      handleClose();
    } catch (error) {
      logger.error('Upload error:', error);
      toast.error(error.response?.data?.detail || 'Failed to create post');
    } finally {
      setLoading(false);
      setUploadProgress(0);
      setProcessingStatus('');
    }
  };

  const handleClose = () => {
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setSelectedFiles([]); setPreviewUrls([]); setCurrentPreviewIndex(0);
    setMediaType('image'); setCaption(''); setLocation('');
    setShowSessionData(false); setSessionDate(todayLocal());
    setSessionStartTime(''); setSessionEndTime('');
    setWaveHeightFt(''); setWavePeriodSec(''); setWaveDirection('');
    setWaveDirectionDegrees(null); setWindSpeedMph(''); setWindDirection('');
    setTideStatus(''); setTideHeightFt(''); setConditionsSource('manual');
    setSelectedSpot(''); onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent data-testid="create-post-dialog"  
        className="bg-zinc-900 border-zinc-800 text-white sm:max-w-lg" 
        aria-describedby="create-post-description"
      >
        <DialogHeader className="shrink-0 border-b border-zinc-800">
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Upload className="w-5 h-5 text-yellow-400" />
            Create Post
          </DialogTitle>
          <DialogDescription id="create-post-description" className="sr-only">
            Upload media and create a new post
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          <input aria-label="Upload file"
            ref={photoInputRef}
            type="file"
            accept="image/*,image/jpeg,image/png,image/heic,image/webp"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <input aria-label="Upload file"
            ref={videoInputRef}
            type="file"
            accept="video/*,video/mp4,video/quicktime,video/webm,video/mov"
            onChange={handleFileSelect}
            className="hidden"
          />
          <input aria-label="Upload file"
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileSelect}
            className="hidden"
          />

          {selectedFiles.length === 0 ? (
            <div className="w-full aspect-video rounded-lg border-2 border-dashed border-zinc-600 flex flex-col items-center justify-center gap-4 bg-zinc-800/50 p-6">
              <p className="text-white font-medium">Select media to post</p>
              
              <div className="flex gap-4">
                {[
                  { ref: photoInputRef, icon: Image, label: 'Photos', sub: 'Up to 10', color: 'blue', testId: 'post-photo-select' },
                  { ref: videoInputRef, icon: Video, label: 'Video', sub: 'MP4, MOV', color: 'purple', testId: 'post-video-select' },
                  { ref: cameraInputRef, icon: Camera, label: 'Camera', sub: 'Take photo', color: 'yellow', testId: 'post-camera-capture' },
                ].map(({ ref, icon: Icon, label, sub, color, testId }) => (
                  <button key={label} aria-label={label}
                    onClick={() => ref.current?.click()}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl bg-zinc-700/50 hover:bg-zinc-700 border border-zinc-600 hover:border-${color}-500 transition-all`}
                    data-testid={testId}
                  >
                    <Icon className={`w-8 h-8 text-${color}-400`} />
                    <span className="text-sm text-white font-medium">{label}</span>
                    <span className="text-xs text-gray-500">{sub}</span>
                  </button>
                ))}
              </div>

              <p className="text-xs text-gray-500 mt-2">
                Select up to 10 photos for a carousel post
              </p>

              <div className="w-full h-px bg-zinc-700 my-2" />

              <button aria-label="Megaphone"
                onClick={() => setShowCreateAdModal(true)}
                className="flex items-center justify-center gap-3 w-full p-3 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 hover:border-purple-500 transition-all"
                data-testid="post-create-ad"
              >
                <Megaphone className="w-5 h-5 text-purple-400" />
                <span className="text-sm text-purple-400 font-medium">Create Ad</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                {mediaType === 'video' ? (
                  <video
                    src={previewUrls[0]}
                    controls
                    className="w-full aspect-video object-cover rounded-lg"
                  />
                ) : (
                  <div
                    onTouchStart={(e) => {
                      if (e.touches?.length === 1) {
                        e.currentTarget._touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                      }
                    }}
                    onTouchEnd={(e) => {
                      if (e.changedTouches?.length !== 1) return;
                      const start = e.currentTarget._touchStart;
                      if (!start) return;
                      const dx = e.changedTouches[0].clientX - start.x;
                      const dy = Math.abs(e.changedTouches[0].clientY - start.y);
                      if (Math.abs(dx) > 40 && dy < 80 && previewUrls.length > 1) {
                        if (dx < 0 && currentPreviewIndex < previewUrls.length - 1) {
                          setCurrentPreviewIndex(prev => prev + 1);
                        } else if (dx > 0 && currentPreviewIndex > 0) {
                          setCurrentPreviewIndex(prev => prev - 1);
                        }
                      }
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget._dragStart = e.clientX;
                      e.currentTarget._dragging = true;
                    }}
                    onMouseUp={(e) => {
                      if (!e.currentTarget._dragging) return;
                      e.currentTarget._dragging = false;
                      const dx = e.clientX - (e.currentTarget._dragStart || 0);
                      if (Math.abs(dx) > 40 && previewUrls.length > 1) {
                        if (dx < 0 && currentPreviewIndex < previewUrls.length - 1) {
                          setCurrentPreviewIndex(prev => prev + 1);
                        } else if (dx > 0 && currentPreviewIndex > 0) {
                          setCurrentPreviewIndex(prev => prev - 1);
                        }
                      }
                    }}
                    onMouseLeave={(e) => { e.currentTarget._dragging = false; }}
                    style={{ touchAction: 'pan-y', cursor: previewUrls.length > 1 ? 'grab' : 'default' }}
                  >
                  <img loading="lazy" decoding="async"
                    src={previewUrls[currentPreviewIndex]}
                    alt={`Preview ${currentPreviewIndex + 1}`}
                    className="w-full aspect-video object-cover rounded-lg"
                    draggable={false}
                  />
                
                {previewUrls.length > 1 && (
                  <>
                    <button aria-label="svg"
                      onClick={() => setCurrentPreviewIndex(prev => (prev - 1 + previewUrls.length) % previewUrls.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/70 rounded-full hover:bg-black"
                    >
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button aria-label="svg"
                      onClick={() => setCurrentPreviewIndex(prev => (prev + 1) % previewUrls.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/70 rounded-full hover:bg-black"
                    >
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                      {previewUrls.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => setCurrentPreviewIndex(idx)}
                          className={`w-1.5 h-1.5 rounded-full transition-colors ${
                            idx === currentPreviewIndex ? 'bg-white' : 'bg-white/50'
                          }`}
                        />
                      ))}
                    </div>
                  </>
                )}
                
                {previewUrls.length > 1 && (
                  <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded text-xs text-white">
                    {currentPreviewIndex + 1} / {previewUrls.length}
                  </div>
                )}
                </div>
              )}
              </div>
              
              {previewUrls.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {previewUrls.map((url, idx) => (
                    <div key={idx} className="relative flex-shrink-0">
                      <button
                        onClick={() => setCurrentPreviewIndex(idx)}
                        className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                          idx === currentPreviewIndex ? 'border-blue-500' : 'border-transparent'
                        }`}
                      >
                        <img loading="lazy" decoding="async" src={url} alt={`Thumb ${idx + 1}`} className="w-full h-full object-cover" />
                      </button>
                      <button
                        onClick={() => removeImage(idx)}
                        className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ))}
                  {previewUrls.length < 10 && mediaType === 'image' && (
                    <button aria-label="svg"
                      onClick={() => photoInputRef.current?.click()}
                      className="w-16 h-16 rounded-lg border-2 border-dashed border-zinc-600 flex items-center justify-center hover:border-zinc-500 transition-colors flex-shrink-0"
                    >
                      <svg className="w-6 h-6 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
              
              {previewUrls.length === 1 && (
                <div className="flex justify-between items-center">
                  <button
                    onClick={() => {
                      previewUrls.forEach(url => URL.revokeObjectURL(url));
                      setSelectedFiles([]);
                      setPreviewUrls([]);
                    }}
                    className="text-sm text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                  {mediaType === 'image' && (
                    <button
                      onClick={() => photoInputRef.current?.click()}
                      className="text-sm text-blue-400 hover:text-blue-300"
                    >
                      + Add more photos
                    </button>
                  )}
                </div>
              )}
              
              {mediaType === 'video' && (
                <p className="text-xs text-blue-400">
                  Videos over 1080p will be automatically optimized
                </p>
              )}
            </div>
          )}

          <div>
            <label className="text-sm text-gray-400 mb-2 block">Caption (optional)</label>
            <Textarea aria-label="What's happening?"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="What's happening?"
              className="bg-zinc-800 border-zinc-700 text-white"
              rows={2}
            />
          </div>

          {recentLocations.length > 0 && (
            <div className="space-y-2" data-testid="recent-locations-section">
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-400 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-cyan-400" />
                  Recent Locations
                </label>
                <button
                  type="button"
                  aria-expanded={showRecentLocations} onClick={() => setShowRecentLocations(!showRecentLocations)}
                  className="text-xs text-cyan-400 hover:text-cyan-300"
                >
                  {showRecentLocations ? 'Hide' : 'Show'}
                </button>
              </div>
              {showRecentLocations && (
                <div className="flex flex-wrap gap-2">
                  {recentLocations.slice(0, 5).map((loc, idx) => (
                    <button aria-label="Location"
                      key={idx}
                      type="button"
                      onClick={() => handleRecentLocationSelect(loc)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-full text-sm text-white transition-colors group"
                      data-testid={`recent-location-${idx}`}
                    >
                      <MapPin className="w-3 h-3 text-cyan-400 group-hover:text-cyan-300" />
                      <span>{loc.spot_name || loc.location}</span>
                      {loc.use_count > 1 && (
                        <span className="text-xs text-gray-500">x{loc.use_count}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="text-sm text-gray-400 mb-2 block">Location (optional)</label>
            <Input aria-label="e.g., Sebastian Inlet, FL"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g., Sebastian Inlet, FL"
              className="bg-zinc-800 border-zinc-700 text-white"
            />
          </div>

          <div className="border border-zinc-700 rounded-lg overflow-hidden">
            <button aria-label="Waves"
              type="button"
              aria-expanded={showSessionData} onClick={() => setShowSessionData(!showSessionData)}
              className="w-full flex items-center justify-between p-3 bg-zinc-800/50 hover:bg-zinc-800 transition-colors"
              data-testid="toggle-session-data"
            >
              <div className="flex items-center gap-2">
                <Waves className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-medium text-white">Add Session Conditions</span>
                {conditionsSource === 'auto' && (
                  <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Auto-filled</span>
                )}
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showSessionData ? 'rotate-180' : ''}`} />
            </button>

            {showSessionData && (
              <div className="p-4 space-y-4 bg-zinc-800/30">
                <div className="flex gap-2">
                  <Select value={selectedSpot} onValueChange={handleSpotSelect}>
                    <SelectTrigger className="flex-1 bg-zinc-800 border-zinc-700 text-white">
                      <SelectValue placeholder="Select a surf spot..." />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700 max-h-60">
                      {knownSpots.map((spot) => (
                        <SelectItem key={spot.key} value={spot.key} className="text-white hover:bg-zinc-700">
                          {spot.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button aria-label="Loader2"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={fetchConditionsByLocation}
                    disabled={conditionsLoading}
                    className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                    data-testid="fetch-conditions-gps"
                  >
                    {conditionsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
                  </Button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Date</label>
                    <Input aria-label="Date"
                      type="date"
                      value={sessionDate}
                      onChange={(e) => setSessionDate(e.target.value)}
                      max={todayLocal()}
                      className="bg-zinc-800 border-zinc-700 text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Start</label>
                    <Input aria-label="Time"
                      type="time"
                      value={sessionStartTime}
                      onChange={(e) => setSessionStartTime(e.target.value)}
                      className="bg-zinc-800 border-zinc-700 text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">End</label>
                    <Input aria-label="Time"
                      type="time"
                      value={sessionEndTime}
                      onChange={(e) => setSessionEndTime(e.target.value)}
                      className="bg-zinc-800 border-zinc-700 text-white text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
                      <Waves className="w-3 h-3" /> Wave Height (ft)
                    </label>
                    <Input aria-label="e.g., 4.5"
                      type="number"
                      step="0.5"
                      value={waveHeightFt}
                      onChange={(e) => { setWaveHeightFt(e.target.value); setConditionsSource('manual'); }}
                      placeholder="e.g., 4.5"
                      className="bg-zinc-800 border-zinc-700 text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Period (sec)</label>
                    <Input aria-label="e.g., 12"
                      type="number"
                      value={wavePeriodSec}
                      onChange={(e) => { setWavePeriodSec(e.target.value); setConditionsSource('manual'); }}
                      placeholder="e.g., 12"
                      className="bg-zinc-800 border-zinc-700 text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Wave Dir</label>
                    <DirSelect value={waveDirection} onChange={(v) => { setWaveDirection(v); setConditionsSource('manual'); }} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
                      <Wind className="w-3 h-3" /> Wind (mph)
                    </label>
                    <Input aria-label="e.g., 8"
                      type="number"
                      step="0.5"
                      value={windSpeedMph}
                      onChange={(e) => { setWindSpeedMph(e.target.value); setConditionsSource('manual'); }}
                      placeholder="e.g., 8"
                      className="bg-zinc-800 border-zinc-700 text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Direction</label>
                    <DirSelect value={windDirection} onChange={(v) => { setWindDirection(v); setConditionsSource('manual'); }} placeholder="Select..." />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
                      <ArrowUpDown className="w-3 h-3" /> Tide Status
                    </label>
                    <Select value={tideStatus} onValueChange={(v) => { setTideStatus(v); setConditionsSource('manual'); }}>
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white text-sm">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        {['Rising', 'High', 'Falling', 'Low'].map((status) => (
                          <SelectItem key={status} value={status} className="text-white hover:bg-zinc-700">{status}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Tide Height (ft)</label>
                    <Input aria-label="e.g., 2.3"
                      type="number"
                      step="0.1"
                      value={tideHeightFt}
                      onChange={(e) => { setTideHeightFt(e.target.value); setConditionsSource('manual'); }}
                      placeholder="e.g., 2.3"
                      className="bg-zinc-800 border-zinc-700 text-white text-sm"
                    />
                  </div>
                </div>

                <p className="text-xs text-gray-500 flex items-center gap-1">
                  {conditionsSource === 'auto' ? (
                    <>
                      <Check className="w-3 h-3 text-green-400" />
                      <span className="text-green-400">Auto-filled from Open-Meteo</span>
                      <span>- Edit values to override</span>
                    </>
                  ) : (
                    <>Conditions will be shown on your post</>
                  )}
                </p>
              </div>
            )}
          </div>

          {loading && (
            <div className="space-y-2">
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-yellow-400 transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 text-center">{processingStatus}</p>
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 sm:px-6 py-4 border-t border-zinc-800" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}>
          <Button aria-label="Loader2"
            onClick={handleUpload}
            disabled={loading || selectedFiles.length === 0}
            className="w-full h-12 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold"
            data-testid="post-submit-btn"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : selectedFiles.length > 1 ? (
              `Share ${selectedFiles.length} Photos`
            ) : (
              'Share Post'
            )}
          </Button>
        </div>
      </DialogContent>

      <CreateAdModal
        isOpen={showCreateAdModal}
        onClose={() => setShowCreateAdModal(false)}
        onSuccess={() => {
          setShowCreateAdModal(false);
          handleClose();
          navigate('/wallet');
        }}
      />
    </Dialog>
  );
};

export default CreatePostModal;
