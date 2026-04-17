/**
 * CreatePost Page - Uses CreatePostModal component
 * This is a full-page version that renders the modal content directly
 * Provides the same full-featured experience as the Feed's "+ Post" button
 */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { MapPin, Loader2, Navigation, Image, Video, Upload, Camera, Megaphone, Waves, ChevronDown, Wind, ArrowUpDown, X, Check, ChevronLeft, ChevronRight, Smile, AtSign, Hash, Play, HelpCircle, Clock, Music, Volume2, VolumeX, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { CreateAdModal } from './CreateAdModal';
import CreateWaveModal from './CreateWaveModal';
import EmojiPicker from './EmojiPicker';
import MentionAutocomplete from './MentionAutocomplete';
import HashtagAutocomplete from './HashtagAutocomplete';
import logger from '../utils/logger';
import GoLiveModal from './GoLiveModal';
import WebcamCaptureModal from './WebcamCaptureModal';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const CreatePost = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Multi-file support for carousel posts
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewUrls, setPreviewUrls] = useState([]);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  
  const [mediaType, setMediaType] = useState('image');
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState('');
  const [showCreateAdModal, setShowCreateAdModal] = useState(false);
  const [showCreateWaveModal, setShowCreateWaveModal] = useState(false);
  const [showVideoInfoModal, setShowVideoInfoModal] = useState(false);
  const [showGoLiveModal, setShowGoLiveModal] = useState(false);
  const [showWebcamModal, setShowWebcamModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const photoInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const cameraVideoInputRef = useRef(null);
  const captionRef = useRef(null);

  // Session metadata state
  const [showSessionData, setShowSessionData] = useState(false);
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
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
  
  // Mention state
  const [mentions, setMentions] = useState([]);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showMentionAutocomplete, setShowMentionAutocomplete] = useState(false);
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
  const mentionRef = useRef(null);
  
  // Hashtag autocomplete state
  const [showHashtagAutocomplete, setShowHashtagAutocomplete] = useState(false);
  const [hashtagQuery, setHashtagQuery] = useState('');
  const [hashtagIndex, setHashtagIndex] = useState(-1);
  const [hashtagEndIndex, setHashtagEndIndex] = useState(-1);
  const [hashtagPosition, setHashtagPosition] = useState({ top: 0, left: 0 });
  const hashtagRef = useRef(null);

  // Fetch known spots on mount
  useEffect(() => {
    const fetchSpots = async () => {
      try {
        const response = await axios.get(`${API}/surf-conditions/known-spots`);
        setKnownSpots(response.data.spots || []);
      } catch (e) {
        // Silent fail
      }
    };
    fetchSpots();
  }, []);

  // Fetch user's recent locations
  useEffect(() => {
    const fetchRecentLocations = async () => {
      if (!user?.id) return;
      try {
        const response = await axios.get(`${API}/posts/user/${user.id}/recent-locations`);
        setRecentLocations(response.data || []);
        if (response.data && response.data.length > 0) {
          setShowRecentLocations(true);
        }
      } catch (e) {
        // Silent fail
      }
    };
    if (user?.id) fetchRecentLocations();
  }, [user?.id]);

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
      const response = await axios.get(`${API}/surf-conditions`, {
        params: { latitude: lat, longitude: lon, spot_name: spotName }
      });
      
      if (response.data.wave_height_ft) setWaveHeightFt(response.data.wave_height_ft.toString());
      if (response.data.wave_period_sec) setWavePeriodSec(response.data.wave_period_sec.toString());
      if (response.data.wave_direction) setWaveDirection(response.data.wave_direction);
      if (response.data.wave_direction_degrees) setWaveDirectionDegrees(response.data.wave_direction_degrees);
      if (response.data.wind_speed_mph) setWindSpeedMph(response.data.wind_speed_mph.toString());
      if (response.data.wind_direction) setWindDirection(response.data.wind_direction);
      if (response.data.tide_status) setTideStatus(response.data.tide_status);
      if (response.data.tide_height_ft) setTideHeightFt(response.data.tide_height_ft.toString());
      setConditionsSource('auto');
      setShowSessionData(true);
      toast.success('Conditions auto-filled! Feel free to adjust.');
    } catch (e) {
      toast.error('Could not fetch conditions. Enter manually.');
    } finally {
      setConditionsLoading(false);
    }
  };

  const fetchConditionsByLocation = async () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }

    setConditionsLoading(true);
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000
        });
      });

      await fetchConditions(position.coords.latitude, position.coords.longitude, location || 'Current Location');
    } catch (e) {
      toast.error('Could not get location. Select a spot instead.');
    } finally {
      setConditionsLoading(false);
    }
  };

  // Handle caption change and detect @ mentions and # hashtags
  const handleCaptionChange = (e) => {
    const newCaption = e.target.value;
    const newCursorPos = e.target.selectionStart;
    
    setCaption(newCaption);
    setCursorPosition(newCursorPos);
    
    const textBeforeCursor = newCaption.substring(0, newCursorPos);
    
    // Check for @ mentions
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex !== -1) {
      const charBefore = lastAtIndex > 0 ? newCaption[lastAtIndex - 1] : ' ';
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      
      // Show autocomplete if @ is after space/newline/start and no space after @
      if ((charBefore === ' ' || charBefore === '\n' || lastAtIndex === 0) && 
          !textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
        setShowMentionAutocomplete(true);
        setShowHashtagAutocomplete(false); // Close hashtag autocomplete
        
        // Position the dropdown below the textarea
        const textarea = captionRef.current;
        if (textarea) {
          setMentionPosition({
            top: 85,
            left: 0
          });
        }
        return;
      }
    }
    
    // Check for # hashtags
    const lastHashIndex = textBeforeCursor.lastIndexOf('#');
    if (lastHashIndex !== -1) {
      const charBefore = lastHashIndex > 0 ? newCaption[lastHashIndex - 1] : ' ';
      const textAfterHash = textBeforeCursor.substring(lastHashIndex + 1);
      
      // Show autocomplete if # is after space/newline/start and no space after #
      if ((charBefore === ' ' || charBefore === '\n' || lastHashIndex === 0) && 
          !textAfterHash.includes(' ') && !textAfterHash.includes('\n')) {
        setShowHashtagAutocomplete(true);
        setShowMentionAutocomplete(false); // Close mention autocomplete
        setHashtagQuery(textAfterHash);
        setHashtagIndex(lastHashIndex);
        setHashtagEndIndex(newCursorPos);
        
        // Position the dropdown below the textarea
        setHashtagPosition({
          top: 85,
          left: 0
        });
        return;
      }
    }
    
    // Close both autocompletes if no trigger found
    setShowMentionAutocomplete(false);
    setShowHashtagAutocomplete(false);
  };

  // Handle mention selection
  const handleMentionSelect = (mention, atIndex, endIndex) => {
    // Replace @query with @username
    const newCaption = caption.substring(0, atIndex) + 
                       `@${mention.username} ` + 
                       caption.substring(endIndex);
    
    setCaption(newCaption);
    
    // Add to mentions list (avoid duplicates)
    setMentions(prev => {
      const exists = prev.find(m => m.user_id === mention.user_id);
      if (exists) return prev;
      return [...prev, mention];
    });
    
    setShowMentionAutocomplete(false);
    
    // Focus back to textarea
    setTimeout(() => {
      if (captionRef.current) {
        const newCursorPos = atIndex + mention.username.length + 2; // +2 for @ and space
        captionRef.current.focus();
        captionRef.current.setSelectionRange(newCursorPos, newCursorPos);
        setCursorPosition(newCursorPos);
      }
    }, 0);
  };
  
  // Handle hashtag selection
  const handleHashtagSelect = (hashtag, hashIndex, endIndex) => {
    // Replace #query with #hashtag
    const tagToInsert = typeof hashtag === 'string' ? hashtag : hashtag.tag;
    const newCaption = caption.substring(0, hashIndex) + 
                       `#${tagToInsert} ` + 
                       caption.substring(endIndex);
    
    setCaption(newCaption);
    setShowHashtagAutocomplete(false);
    
    // Focus back to textarea
    setTimeout(() => {
      if (captionRef.current) {
        const newCursorPos = hashIndex + tagToInsert.length + 2; // +2 for # and space
        captionRef.current.focus();
        captionRef.current.setSelectionRange(newCursorPos, newCursorPos);
        setCursorPosition(newCursorPos);
      }
    }, 0);
  };

  // Handle keyboard events for mention and hashtag navigation
  const handleCaptionKeyDown = (e) => {
    // Handle mention autocomplete
    if (showMentionAutocomplete && mentionRef.current) {
      const handled = mentionRef.current.handleKeyDown(e);
      if (handled) return;
    }
    
    // Handle hashtag autocomplete
    if (showHashtagAutocomplete && hashtagRef.current) {
      const handled = hashtagRef.current.handleKeyDown(e);
      if (handled) return;
    }
    
    // If Enter is pressed with hashtag autocomplete open but no suggestions, insert the typed hashtag
    if (showHashtagAutocomplete && e.key === 'Enter' && hashtagQuery) {
      e.preventDefault();
      handleHashtagSelect(hashtagQuery, hashtagIndex, hashtagEndIndex);
    }
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

    // Video: only single file allowed
    if (isVideo) {
      const maxSize = 100 * 1024 * 1024;
      if (firstFile.size > maxSize) {
        toast.error('Video too large. Maximum size is 100MB');
        return;
      }
      previewUrls.forEach(url => URL.revokeObjectURL(url));
      setSelectedFiles([firstFile]);
      setPreviewUrls([URL.createObjectURL(firstFile)]);
      setMediaType('video');
      setCurrentPreviewIndex(0);
      return;
    }

    // Images: allow up to 10
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
            : (mediaType === 'video' ? 'Uploading & processing video...' : 'Uploading...')
        );

        const uploadResponse = await axios.post(`${API}/upload/feed`, formData, {
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
      
      // Store mentions separately for notification purposes (not on Post model)
      const mentionsToNotify = mentions.length > 0 ? mentions.map(m => ({
        user_id: m.user_id,
        username: m.username,
        full_name: m.full_name
      })) : [];

      // Add session metadata if enabled
      if (showSessionData) {
        if (sessionDate) postData.session_date = new Date(sessionDate).toISOString();
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

      await axios.post(`${API}/posts?author_id=${user.id}`, postData);

      if (isCarousel) {
        toast.success(`Posted ${selectedFiles.length} photos!`);
      } else {
        toast.success('Post created successfully!');
      }
      
      navigate('/feed');
    } catch (error) {
      logger.error('Upload error:', error);
      toast.error(error.response?.data?.detail || 'Failed to create post');
    } finally {
      setLoading(false);
      setUploadProgress(0);
      setProcessingStatus('');
    }
  };

  const clearSelection = () => {
    previewUrls.forEach(url => URL.revokeObjectURL(url));
    setSelectedFiles([]);
    setPreviewUrls([]);
    setCurrentPreviewIndex(0);
    setMediaType('image');
  };

  return (
    <div className="pb-20 bg-background min-h-screen" data-testid="create-post-page">
      <div className="max-w-lg mx-auto p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: 'Oswald' }}>
            Create Post
          </h1>
          {selectedFiles.length > 0 && (
            <Button
              onClick={handleUpload}
              disabled={loading}
              className="bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold"
              data-testid="share-post-btn"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Share'}
            </Button>
          )}
        </div>

        {/* Hidden File Inputs */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*,image/jpeg,image/png,image/heic,image/webp"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*,video/mp4,video/quicktime,video/webm,video/mov"
          onChange={handleFileSelect}
          className="hidden"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
        />
        <input
          ref={cameraVideoInputRef}
          type="file"
          accept="video/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
        />

        {selectedFiles.length === 0 ? (
          <div className="space-y-4">
            {/* Upload Area */}
            <div className="w-full rounded-2xl border-2 border-dashed border-border p-6 bg-muted/50">
              <p className="text-foreground font-medium text-lg text-center mb-2">Select media to post</p>
              <p className="text-muted-foreground text-sm text-center mb-6">Up to 10 photos or 1 video</p>
              
              <div className="flex justify-center gap-4 mb-4">
                {/* Photo Button */}
                <button
                  onClick={() => photoInputRef.current?.click()}
                  className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-muted hover:bg-accent border-2 border-transparent hover:border-blue-500 transition-all active:scale-95"
                  data-testid="photo-select-btn"
                >
                  <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <Image className="w-8 h-8 text-blue-400" />
                  </div>
                  <span className="text-foreground font-medium">Photo</span>
                  <span className="text-xs text-muted-foreground">JPG, PNG, HEIC</span>
                </button>

                {/* Video Button */}
                <button
                  onClick={() => videoInputRef.current?.click()}
                  className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-muted hover:bg-accent border-2 border-transparent hover:border-purple-500 transition-all active:scale-95"
                  data-testid="video-select-btn"
                >
                  <div className="w-16 h-16 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <Video className="w-8 h-8 text-purple-400" />
                  </div>
                  <span className="text-foreground font-medium">Video</span>
                  <span className="text-xs text-muted-foreground">MP4, MOV</span>
                </button>
                
                {/* Wave (Short Video) Button */}
                <button
                  onClick={() => setShowCreateWaveModal(true)}
                  className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-muted hover:bg-accent border-2 border-transparent hover:border-cyan-500 transition-all active:scale-95"
                  data-testid="wave-select-btn"
                >
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                    <Play className="w-8 h-8 text-cyan-400" />
                  </div>
                  <span className="text-foreground font-medium">Wave</span>
                  <span className="text-xs text-muted-foreground">60s max</span>
                </button>
              </div>

              <p className="text-muted-foreground text-sm text-center">
                Videos auto-optimized to 1080p
              </p>
              
              {/* Help Link - Video vs Wave */}
              <button
                onClick={() => setShowVideoInfoModal(true)}
                className="flex items-center justify-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 mx-auto mt-2"
              >
                <HelpCircle className="w-4 h-4" />
                What's the difference between Video and Wave?
              </button>
            </div>

            {/* Camera shortcut */}
            <Button
              onClick={() => setShowWebcamModal(true)}
              variant="outline"
              className="w-full h-12 border-border text-foreground hover:bg-muted font-medium"
            >
              <Camera className="w-5 h-5 mr-3 text-cyan-500 font-bold" />
              Capture Photo or Video
            </Button>

            {/* Go Live Option */}
            <Button
              onClick={() => setShowGoLiveModal(true)}
              className="w-full h-12 bg-red-500 hover:bg-red-600 text-white border-0 font-bold"
            >
              <Radio className="w-5 h-5 mr-3 animate-pulse" />
              Go Live
            </Button>

            {/* Create Ad Option */}
            <Button
              onClick={() => setShowCreateAdModal(true)}
              variant="outline"
              className="w-full h-12 border-purple-500/50 text-purple-500 dark:text-purple-400 hover:bg-purple-500/10 hover:border-purple-500"
              data-testid="create-ad-btn"
            >
              <Megaphone className="w-5 h-5 mr-2" />
              Create Ad
            </Button>
          </div>
        ) : (
          <div className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto pr-1">
            {/* Preview with Carousel Controls */}
            <div className="relative rounded-xl overflow-hidden bg-zinc-900">
              {mediaType === 'video' ? (
                <video
                  src={previewUrls[0]}
                  controls
                  className="w-full aspect-square object-cover"
                  playsInline
                />
              ) : (
                <div className="relative">
                  <img
                    src={previewUrls[currentPreviewIndex]}
                    alt={`Preview ${currentPreviewIndex + 1}`}
                    className="w-full aspect-square object-cover"
                  />
                  {/* Carousel Navigation */}
                  {previewUrls.length > 1 && (
                    <>
                      {currentPreviewIndex > 0 && (
                        <button
                          onClick={() => setCurrentPreviewIndex(prev => prev - 1)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/70 rounded-full flex items-center justify-center hover:bg-black"
                        >
                          <ChevronLeft className="w-5 h-5 text-white" />
                        </button>
                      )}
                      {currentPreviewIndex < previewUrls.length - 1 && (
                        <button
                          onClick={() => setCurrentPreviewIndex(prev => prev + 1)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/70 rounded-full flex items-center justify-center hover:bg-black"
                        >
                          <ChevronRight className="w-5 h-5 text-white" />
                        </button>
                      )}
                      {/* Dot indicators */}
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                        {previewUrls.map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setCurrentPreviewIndex(i)}
                            className={`w-2 h-2 rounded-full transition-all ${
                              i === currentPreviewIndex ? 'bg-white w-4' : 'bg-white/50'
                            }`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              <button
                onClick={clearSelection}
                className="absolute top-3 right-3 p-2 bg-black/70 rounded-full hover:bg-black"
              >
                <X className="w-5 h-5 text-white" />
              </button>
              {/* Photo count badge */}
              {previewUrls.length > 1 && (
                <div className="absolute top-3 left-3 bg-black/70 px-2 py-1 rounded text-xs text-white">
                  {currentPreviewIndex + 1} / {previewUrls.length}
                </div>
              )}
            </div>

            {/* Thumbnail Strip for Multiple Images */}
            {mediaType === 'image' && previewUrls.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {previewUrls.map((url, i) => (
                  <div key={i} className="relative flex-shrink-0">
                    <img
                      src={url}
                      alt={`Thumb ${i + 1}`}
                      onClick={() => setCurrentPreviewIndex(i)}
                      className={`w-16 h-16 rounded-lg object-cover cursor-pointer border-2 transition-all ${
                        i === currentPreviewIndex ? 'border-yellow-400' : 'border-transparent hover:border-zinc-500'
                      }`}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                ))}
                {/* Add More Button */}
                {previewUrls.length < 10 && (
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    className="w-16 h-16 rounded-lg border-2 border-dashed border-zinc-600 flex items-center justify-center hover:border-zinc-400 flex-shrink-0"
                  >
                    <span className="text-2xl text-zinc-500">+</span>
                  </button>
                )}
              </div>
            )}

            {/* Caption with Emoji and @Mentions */}
            <div className="relative">
              <Textarea
                ref={captionRef}
                value={caption}
                onChange={handleCaptionChange}
                onKeyDown={handleCaptionKeyDown}
                onSelect={(e) => setCursorPosition(e.target.selectionStart)}
                placeholder="Write a caption... Use @ to mention someone"
                className="bg-zinc-900 border-zinc-700 text-white min-h-[80px] resize-none pr-20"
                data-testid="caption-input"
              />
              <div className="absolute right-3 top-3 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const textarea = captionRef.current;
                    if (textarea) {
                      const pos = textarea.selectionStart || caption.length;
                      const newCaption = caption.slice(0, pos) + '@' + caption.slice(pos);
                      setCaption(newCaption);
                      setCursorPosition(pos + 1);
                      setShowMentionAutocomplete(true);
                      setTimeout(() => {
                        textarea.focus();
                        textarea.setSelectionRange(pos + 1, pos + 1);
                      }, 0);
                    }
                  }}
                  className="p-2 rounded-full hover:bg-zinc-700 text-gray-400 hover:text-cyan-400 transition-colors"
                  title="Mention someone"
                >
                  <AtSign className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className={`p-2 rounded-full transition-colors ${
                    showEmojiPicker ? 'bg-yellow-500/20 text-yellow-400' : 'hover:bg-zinc-700 text-gray-400 hover:text-white'
                  }`}
                >
                  <Smile className="w-5 h-5" />
                </button>
              </div>
              
              {/* Mention Autocomplete */}
              <MentionAutocomplete
                ref={mentionRef}
                text={caption}
                cursorPosition={cursorPosition}
                onSelect={handleMentionSelect}
                isVisible={showMentionAutocomplete}
                onClose={() => setShowMentionAutocomplete(false)}
                position={mentionPosition}
              />
              
              {/* Hashtag Autocomplete */}
              {showHashtagAutocomplete && (
                <HashtagAutocomplete
                  ref={hashtagRef}
                  query={hashtagQuery}
                  onSelect={handleHashtagSelect}
                  hashIndex={hashtagIndex}
                  endIndex={hashtagEndIndex}
                  position={hashtagPosition}
                  onClose={() => setShowHashtagAutocomplete(false)}
                />
              )}
              
              <EmojiPicker
                isOpen={showEmojiPicker}
                onClose={() => setShowEmojiPicker(false)}
                onSelect={(emoji) => {
                  const textarea = captionRef.current;
                  if (textarea) {
                    const start = textarea.selectionStart || caption.length;
                    const end = textarea.selectionEnd || caption.length;
                    const newCaption = caption.slice(0, start) + emoji + caption.slice(end);
                    setCaption(newCaption);
                    setTimeout(() => {
                      textarea.focus();
                      textarea.setSelectionRange(start + emoji.length, start + emoji.length);
                    }, 0);
                  } else {
                    setCaption(caption + emoji);
                  }
                }}
                position="below"
              />
              
              {/* Mentions preview */}
              {mentions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {mentions.map((m, idx) => (
                    <span 
                      key={m.user_id || idx}
                      className="px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded-full text-xs flex items-center gap-1"
                    >
                      @{m.username}
                      <button
                        type="button"
                        onClick={() => setMentions(prev => prev.filter(x => x.user_id !== m.user_id))}
                        className="hover:text-red-400"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Location */}
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Add location"
                className="bg-zinc-900 border-zinc-700 text-white pl-10"
                data-testid="location-input"
              />
            </div>

            {/* Recent Locations */}
            {showRecentLocations && recentLocations.length > 0 && (
              <div className="bg-zinc-800/50 rounded-lg p-3">
                <p className="text-xs text-zinc-400 mb-2">Recent locations</p>
                <div className="flex flex-wrap gap-2">
                  {recentLocations.slice(0, 5).map((loc, i) => (
                    <button
                      key={i}
                      onClick={() => handleRecentLocationSelect(loc)}
                      className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded-full text-sm text-white flex items-center gap-1"
                    >
                      <MapPin className="w-3 h-3" />
                      {loc.location}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Known Spots Dropdown */}
            {knownSpots.length > 0 && (
              <Select value={selectedSpot} onValueChange={handleSpotSelect}>
                <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white">
                  <SelectValue placeholder="Or select a known surf spot..." />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {knownSpots.map(spot => (
                    <SelectItem key={spot.key} value={spot.key} className="text-white hover:bg-zinc-700">
                      {spot.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Session Conditions Toggle */}
            <button
              onClick={() => setShowSessionData(!showSessionData)}
              className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${
                showSessionData 
                  ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400' 
                  : 'bg-zinc-800/50 border-zinc-700 text-zinc-300 hover:border-cyan-500/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <Waves className="w-5 h-5" />
                <span className="font-medium">Add Session Conditions</span>
              </div>
              <ChevronDown className={`w-5 h-5 transition-transform ${showSessionData ? 'rotate-180' : ''}`} />
            </button>

            {/* Session Data Fields */}
            {showSessionData && (
              <div className="space-y-4 p-4 bg-zinc-800/50 rounded-lg border border-zinc-700">
                {/* Auto-fetch Button */}
                <Button
                  onClick={fetchConditionsByLocation}
                  disabled={conditionsLoading}
                  variant="outline"
                  className="w-full border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10"
                >
                  {conditionsLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Navigation className="w-4 h-4 mr-2" />
                  )}
                  Auto-fill from Current Location
                </Button>

                {/* Session Time */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">Date</label>
                    <Input
                      type="date"
                      value={sessionDate}
                      onChange={(e) => setSessionDate(e.target.value)}
                      className="bg-zinc-900 border-zinc-700 text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">Start</label>
                    <Input
                      type="time"
                      value={sessionStartTime}
                      onChange={(e) => setSessionStartTime(e.target.value)}
                      className="bg-zinc-900 border-zinc-700 text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">End</label>
                    <Input
                      type="time"
                      value={sessionEndTime}
                      onChange={(e) => setSessionEndTime(e.target.value)}
                      className="bg-zinc-900 border-zinc-700 text-white text-sm"
                    />
                  </div>
                </div>

                {/* Wave Conditions */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-cyan-400">
                    <Waves className="w-4 h-4" />
                    <span className="text-sm font-medium">Wave Conditions</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1">Height (ft)</label>
                      <Input
                        type="number"
                        step="0.5"
                        value={waveHeightFt}
                        onChange={(e) => setWaveHeightFt(e.target.value)}
                        placeholder="3.5"
                        className="bg-zinc-900 border-zinc-700 text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1">Period (sec)</label>
                      <Input
                        type="number"
                        value={wavePeriodSec}
                        onChange={(e) => setWavePeriodSec(e.target.value)}
                        placeholder="12"
                        className="bg-zinc-900 border-zinc-700 text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1">Direction</label>
                      <Select value={waveDirection} onValueChange={setWaveDirection}>
                        <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white text-sm h-9">
                          <SelectValue placeholder="Dir" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700">
                          {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map(dir => (
                            <SelectItem key={dir} value={dir} className="text-white">{dir}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Wind Conditions */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <Wind className="w-4 h-4" />
                    <span className="text-sm font-medium">Wind</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1">Speed (mph)</label>
                      <Input
                        type="number"
                        value={windSpeedMph}
                        onChange={(e) => setWindSpeedMph(e.target.value)}
                        placeholder="8"
                        className="bg-zinc-900 border-zinc-700 text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1">Direction</label>
                      <Select value={windDirection} onValueChange={setWindDirection}>
                        <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white text-sm h-9">
                          <SelectValue placeholder="Direction" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700">
                          {['Offshore', 'Onshore', 'Cross-shore', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map(dir => (
                            <SelectItem key={dir} value={dir} className="text-white">{dir}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Tide Conditions */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-blue-400">
                    <ArrowUpDown className="w-4 h-4" />
                    <span className="text-sm font-medium">Tide</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1">Status</label>
                      <Select value={tideStatus} onValueChange={setTideStatus}>
                        <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white text-sm h-9">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700">
                          {['High', 'Low', 'Rising', 'Falling', 'Mid'].map(status => (
                            <SelectItem key={status} value={status} className="text-white">{status}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1">Height (ft)</label>
                      <Input
                        type="number"
                        step="0.1"
                        value={tideHeightFt}
                        onChange={(e) => setTideHeightFt(e.target.value)}
                        placeholder="2.5"
                        className="bg-zinc-900 border-zinc-700 text-white text-sm"
                      />
                    </div>
                  </div>
                </div>

                {conditionsSource === 'auto' && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400">
                    <Check className="w-3 h-3" />
                    <span>Conditions auto-filled from weather data</span>
                  </div>
                )}
              </div>
            )}

            {/* Progress */}
            {loading && (
              <div className="space-y-2">
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-yellow-400 to-orange-400 transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 text-center">{processingStatus}</p>
              </div>
            )}

            {/* Submit Button */}
            <Button
              onClick={handleUpload}
              disabled={loading}
              className="w-full h-14 bg-gradient-to-r from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-black font-bold text-lg"
              data-testid="post-submit-btn"
            >
              {loading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <>
                  <Upload className="w-5 h-5 mr-2" />
                  Share Post
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Create Ad Modal */}
      <CreateAdModal
        isOpen={showCreateAdModal}
        onClose={() => setShowCreateAdModal(false)}
        onSuccess={() => {
          setShowCreateAdModal(false);
          navigate('/wallet');
        }}
      />
      
      {/* Create Wave Modal */}
      <CreateWaveModal
        isOpen={showCreateWaveModal}
        onClose={() => setShowCreateWaveModal(false)}
        onSuccess={() => {
          setShowCreateWaveModal(false);
          navigate('/feed?tab=waves');
          toast.success('Wave posted!');
        }}
      />
      
      {/* Video vs Wave Info Modal */}
      <Dialog open={showVideoInfoModal} onOpenChange={setShowVideoInfoModal}>
        <DialogContent className="bg-background border-border text-foreground max-w-md w-[95vw] sm:w-full p-0 overflow-hidden sm:border sm:rounded-xl shadow-2xl flex flex-col max-h-[75vh] my-auto">
          <div className="overflow-y-auto w-full p-6 pb-12 custom-scrollbar">
            <DialogHeader className="mb-4">
              <DialogTitle className="flex items-center gap-2 text-xl font-bold text-foreground">
                <HelpCircle className="w-6 h-6 text-cyan-500" />
                Video vs Wave
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-5">
              {/* Wave Section */}
              <div className="p-5 rounded-xl bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 shadow-sm relative overflow-hidden">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-cyan-500/10 rounded-full blur-xl pointer-events-none"></div>
                <div className="flex items-center gap-3 mb-4 relative z-10">
                  <div className="w-12 h-12 rounded-full bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30">
                    <Play className="w-6 h-6 text-cyan-600 dark:text-cyan-400 translate-x-0.5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-lg text-cyan-700 dark:text-cyan-400">Wave</h3>
                    <p className="text-sm text-foreground/70 font-medium">Short-form vertical video</p>
                  </div>
                </div>
                <ul className="space-y-3 text-sm text-foreground/90 relative z-10">
                  <li className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-cyan-600 dark:text-cyan-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">60 seconds max</strong> - Quick highlights & clips</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Play className="w-5 h-5 text-cyan-600 dark:text-cyan-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">Vertical format</strong> - Full-screen TikTok-style</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Music className="w-5 h-5 text-cyan-600 dark:text-cyan-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">Licensed music</strong> - Coming soon via Adaptr</span>
                  </li>
                </ul>
                <div className="mt-4 pt-3 border-t border-cyan-500/10">
                  <p className="text-xs font-medium text-cyan-700 dark:text-cyan-500/80">
                    Best for: Tricks, highlights, funny moments, quick clips
                  </p>
                </div>
              </div>
              
              {/* Video Section */}
              <div className="p-5 rounded-xl bg-purple-500/10 border border-purple-500/20 shadow-sm relative overflow-hidden">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-500/10 rounded-full blur-xl pointer-events-none"></div>
                <div className="flex items-center gap-3 mb-4 relative z-10">
                  <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
                    <Video className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-lg text-purple-700 dark:text-purple-400">Video Post</h3>
                    <p className="text-sm text-foreground/70 font-medium">Standard video in feed</p>
                  </div>
                </div>
                <ul className="space-y-3 text-sm text-foreground/90 relative z-10">
                  <li className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">Longer duration</strong> - Full session clips</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Video className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">Any aspect ratio</strong> - Landscape, square, portrait</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Music className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">Licensed music</strong> - Coming soon via Epidemic Sound</span>
                  </li>
                </ul>
                <div className="mt-4 pt-3 border-t border-purple-500/10">
                  <p className="text-xs font-medium text-purple-700 dark:text-purple-500/80">
                    Best for: Session recaps, tutorials, vlogs, longer content
                  </p>
                </div>
              </div>
              
              {/* Music Note */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <VolumeX className="w-5 h-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-foreground/80 leading-relaxed">
                  <strong className="text-amber-700 dark:text-amber-400 font-bold block mb-1">Music Note</strong>
                  Videos with unlicensed copyrighted music may have audio muted. Licensed music libraries coming soon!
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Broadcast Launch Modal */}
      <GoLiveModal 
        isOpen={showGoLiveModal} 
        onClose={() => setShowGoLiveModal(false)} 
      />

      {/* WebRTC Native Camera Interface */}
      <WebcamCaptureModal
        isOpen={showWebcamModal}
        onClose={() => setShowWebcamModal(false)}
        onCapture={(files) => {
          handleFileSelect({ target: { files } });
        }}
      />
    </div>
  );
};
