/**
 * CreatePost Page - Uses CreatePostModal component
 * This is a full-page version that renders the modal content directly
 * Provides the same full-featured experience as the Feed's "+ Post" button
 */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { Loader2, Image, Video, Upload, Camera, Megaphone, X, ChevronLeft, ChevronRight, Smile, AtSign, Play, HelpCircle, Radio, Sliders } from 'lucide-react';
import { toast } from 'sonner';
import useCreatePostActions from '../hooks/useCreatePostActions';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { CreateAdModal } from './CreateAdModal';
import CreateWaveModal from './CreateWaveModal';
import EmojiPicker from './EmojiPicker';
import MentionAutocomplete from './MentionAutocomplete';
import HashtagAutocomplete from './HashtagAutocomplete';
import GoLiveModal from './GoLiveModal';
import WebcamCaptureModal from './WebcamCaptureModal';
import VideoInfoModal from './create-post/VideoInfoModal';
import LocationPickerPanel from './create-post/LocationPickerPanel';
import SessionConditionsPanel from './create-post/SessionConditionsPanel';
import { CasualEditorModal } from './social/CasualEditorModal';
import EmptyMediaSelection from './create-post/EmptyMediaSelection';


export const CreatePost = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();

  // Theme-aware classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const bgInput = isLight ? 'bg-gray-100' : isBeach ? 'bg-black' : 'bg-zinc-900';
  const borderInput = isLight ? 'border-gray-300' : isBeach ? 'border-zinc-800' : 'border-zinc-700';
  const textInput = isLight ? 'text-gray-900' : 'text-white';
  const labelClass = isLight ? 'text-gray-500' : isBeach ? 'text-zinc-300' : 'text-zinc-400';
  const cardBg = isLight ? 'bg-gray-50' : isBeach ? 'bg-zinc-950' : 'bg-zinc-800/50';
  const cardBorder = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-800' : 'border-zinc-700';
  const pillBg = isLight ? 'bg-gray-100 hover:bg-gray-200 text-gray-800' : 'bg-zinc-700 hover:bg-zinc-600 text-white';
  const hoverBg = isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-700';
  const selectContentBg = isLight ? 'bg-white border-gray-200' : 'bg-zinc-800 border-zinc-700';
  const selectItemClass = isLight ? 'text-gray-900 hover:bg-gray-100' : 'text-white hover:bg-zinc-700';
  const toggleInactive = isLight
    ? 'bg-gray-50 border-gray-200 text-gray-600 hover:border-cyan-400/50'
    : 'bg-zinc-800/50 border-zinc-700 text-zinc-300 hover:border-cyan-500/30';
  
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
  const [showCasualEditor, setShowCasualEditor] = useState(false);
  const [editingFileIndex, setEditingFileIndex] = useState(0);
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

  // GPS + Location hierarchy state (mirrors Feed check-in flow)
  const [allSpots, setAllSpots] = useState([]);
  const [locationHierarchy, setLocationHierarchy] = useState({ countries: [] });
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  
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

  // ============ HANDLERS EXTRACTED ============
  const {
    fetchSpots,
    fetchRecentLocations,
    fetchAllSpots,
    fetchLocationHierarchy,
    calculateDistance,
    handleHierarchySpotSelect,
    handleRecentLocationSelect,
    handleSpotSelect,
    fetchConditions,
    fetchConditionsByLocation,
    handleCaptionChange,
    handleMentionSelect,
    handleHashtagSelect,
    handleCaptionKeyDown,
    handleFileSelect,
    removeImage,
    compressImageToBase64,
    handleUpload,
    gpsLoading,
    userLat,
    userLon,
    nearestSpot,
    getGpsLocation,
  } = useCreatePostActions({
    user, navigate, selectedSpot, caption, selectedFiles, previewUrls,
    captionRef, hashtagRef,
    allSpots, knownSpots, location,
    sessionDate, sessionStartTime, sessionEndTime,
    waveHeightFt, wavePeriodSec, waveDirection, waveDirectionDegrees,
    windSpeedMph, windDirection, tideStatus, tideHeightFt, showSessionData,
    conditionsSource, mentions, currentPreviewIndex,
    showMentionAutocomplete, showHashtagAutocomplete, hashtagQuery, hashtagIndex, hashtagEndIndex,
    mentionRef: mentionRef,
    setAllSpots,
    setCaption,
    setConditionsLoading,
    setConditionsSource,
    setCurrentPreviewIndex,
    setCursorPosition,
    setHashtagEndIndex,
    setHashtagIndex,
    setHashtagPosition,
    setHashtagQuery,
    setKnownSpots,
    setLoading,
    setLocation,
    setLocationHierarchy,
    setMediaType,
    setMentionPosition,
    setMentions,
    setPreviewUrls,
    setProcessingStatus,
    setRecentLocations,
    setSelectedFiles,
    setSelectedSpot,
    setShowHashtagAutocomplete,
    setShowMentionAutocomplete,
    setShowRecentLocations,
    setShowSessionData,
    setTideHeightFt,
    setTideStatus,
    setUploadProgress,
    setWaveDirection,
    setWaveDirectionDegrees,
    setWaveHeightFt,
    setWavePeriodSec,
    setWindDirection,
    setWindSpeedMph,
  });

  // Fetch known spots on mount
  useEffect(() => {
    fetchSpots();
  }, []);

  // Fetch user's recent locations
  useEffect(() => {
    if (user?.id) fetchRecentLocations();
  }, [user?.id]);

  // Fetch all spots + location hierarchy for GPS/manual location picker
  useEffect(() => {
    fetchAllSpots();
    fetchLocationHierarchy();
  }, []);

  // Handle spot selection from hierarchy picker





  // Handle caption change and detect @ mentions and # hashtags

  // Handle mention selection
  
  // Handle hashtag selection

  // Handle keyboard events for mention and hashtag navigation

  

  // Compress an image File to a base64 string (max 1200px, 85% quality)


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
          <h1 className="text-2xl font-bold text-foreground font-oswald" >
            Create Post
          </h1>
          {selectedFiles.length > 0 && (
            <Button aria-label="Loader2"
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
        <input aria-label="Upload file"
          ref={cameraVideoInputRef}
          type="file"
          accept="video/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
        />

        {selectedFiles.length === 0 ? (
          <EmptyMediaSelection
            photoInputRef={photoInputRef}
            videoInputRef={videoInputRef}
            setShowCreateWaveModal={setShowCreateWaveModal}
            setShowVideoInfoModal={setShowVideoInfoModal}
            setShowWebcamModal={setShowWebcamModal}
            setShowGoLiveModal={setShowGoLiveModal}
            setShowCreateAdModal={setShowCreateAdModal}
          />
        ) : (
          <div className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto pr-1">
            {/* Preview with Carousel Controls */}
            <div className={`relative rounded-xl overflow-hidden ${isLight ? 'bg-gray-100' : 'bg-zinc-900'}`}>
              {mediaType === 'video' ? (
                <video
                  src={previewUrls[0]}
                  controls
                  className="w-full aspect-square object-cover"
                  playsInline
                />
              ) : (
                <div className="relative"
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
                    className="w-full aspect-square object-cover"
                    draggable={false}
                  />
                  {/* Carousel Navigation */}
                  {previewUrls.length > 1 && (
                    <>
                      {currentPreviewIndex > 0 && (
                        <button aria-label="Previous"
                          onClick={() => setCurrentPreviewIndex(prev => prev - 1)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/70 rounded-full flex items-center justify-center hover:bg-black"
                        >
                          <ChevronLeft className="w-5 h-5 text-white" />
                        </button>
                      )}
                      {currentPreviewIndex < previewUrls.length - 1 && (
                        <button aria-label="Next"
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
              {mediaType === 'image' && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingFileIndex(currentPreviewIndex);
                    setShowCasualEditor(true);
                  }}
                  className="absolute top-3 right-14 p-2 bg-black/70 rounded-full hover:bg-black text-white flex items-center justify-center transition-colors"
                  title="Edit Photo"
                  data-testid="edit-photo-btn"
                >
                  <Sliders className="w-5 h-5 text-cyan-400" />
                </button>
              )}
              <button aria-label="Close"
                onClick={clearSelection}
                className="absolute top-3 right-3 p-2 bg-black/70 rounded-full hover:bg-black"
              ><X className="w-5 h-5 text-white" />
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
                    <img loading="lazy" decoding="async"
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
                    className={`w-16 h-16 rounded-lg border-2 border-dashed ${isLight ? 'border-gray-300 hover:border-gray-500' : 'border-zinc-600 hover:border-zinc-400'} flex items-center justify-center flex-shrink-0`}
                  >
                    <span className={`text-2xl ${isLight ? 'text-gray-400' : 'text-zinc-500'}`}>+</span>
                  </button>
                )}
              </div>
            )}

            {/* Caption with Emoji and @Mentions */}
            <div className="relative">
              <Textarea aria-label="Text input"
                ref={captionRef}
                value={caption}
                onChange={handleCaptionChange}
                onKeyDown={handleCaptionKeyDown}
                onSelect={(e) => setCursorPosition(e.target.selectionStart)}
                placeholder="Write a caption... Use @ to mention someone"
                className={`${bgInput} ${borderInput} ${textInput} min-h-[80px] resize-none pr-20`}
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
                  className={`p-2 rounded-full ${hoverBg} ${labelClass} hover:text-cyan-400 transition-colors`}
                  title="Mention someone"
                >
                  <AtSign className="w-4 h-4" />
                </button>
                <button aria-label="Emoji"
                  type="button"
                  aria-expanded={showEmojiPicker} onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  className={`p-2 rounded-full transition-colors ${
                    showEmojiPicker ? 'bg-yellow-500/20 text-yellow-400' : `${hoverBg} ${labelClass} hover:text-white`
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

            {/* Location Picker (Extracted to create-post/LocationPickerPanel.js) */}
            <LocationPickerPanel
              showLocationPicker={showLocationPicker} setShowLocationPicker={setShowLocationPicker}
              selectedCountry={selectedCountry} setSelectedCountry={setSelectedCountry}
              selectedState={selectedState} setSelectedState={setSelectedState}
              selectedCity={selectedCity} setSelectedCity={setSelectedCity}
              selectedSpot={selectedSpot} setSelectedSpot={setSelectedSpot}
              locationHierarchy={locationHierarchy}
              location={location} setLocation={setLocation}
              nearestSpot={nearestSpot} userLat={userLat} userLon={userLon}
              gpsLoading={gpsLoading} getGpsLocation={getGpsLocation}
              recentLocations={recentLocations}
              knownSpots={knownSpots} allSpots={allSpots}
              handleHierarchySpotSelect={handleHierarchySpotSelect}
              handleRecentLocationSelect={handleRecentLocationSelect}
              handleSpotSelect={handleSpotSelect}
              fetchConditions={fetchConditions}
              calculateDistance={calculateDistance}
              cardBg={cardBg} cardBorder={cardBorder} isLight={isLight}
              labelClass={labelClass} bgInput={bgInput} borderInput={borderInput} textInput={textInput}
              selectContentBg={selectContentBg} selectItemClass={selectItemClass}
              hoverBg={hoverBg} pillBg={pillBg}
            />

            {/* Session Conditions (Extracted to create-post/SessionConditionsPanel.js) */}
            <SessionConditionsPanel
              showSessionData={showSessionData} setShowSessionData={setShowSessionData}
              sessionDate={sessionDate} setSessionDate={setSessionDate}
              sessionStartTime={sessionStartTime} setSessionStartTime={setSessionStartTime}
              sessionEndTime={sessionEndTime} setSessionEndTime={setSessionEndTime}
              waveHeightFt={waveHeightFt} setWaveHeightFt={setWaveHeightFt}
              wavePeriodSec={wavePeriodSec} setWavePeriodSec={setWavePeriodSec}
              waveDirection={waveDirection} setWaveDirection={setWaveDirection}
              waveDirectionDegrees={waveDirectionDegrees} setWaveDirectionDegrees={setWaveDirectionDegrees}
              windSpeedMph={windSpeedMph} setWindSpeedMph={setWindSpeedMph}
              windDirection={windDirection} setWindDirection={setWindDirection}
              tideStatus={tideStatus} setTideStatus={setTideStatus}
              tideHeightFt={tideHeightFt} setTideHeightFt={setTideHeightFt}
              conditionsLoading={conditionsLoading} conditionsSource={conditionsSource}
              fetchConditionsByLocation={fetchConditionsByLocation}
              cardBg={cardBg} cardBorder={cardBorder} toggleInactive={toggleInactive}
              bgInput={bgInput} borderInput={borderInput} textInput={textInput} labelClass={labelClass}
              isLight={isLight}
            />

            {/* Progress */}
            {loading && (
              <div className="space-y-2">
                <div className={`h-2 ${isLight ? 'bg-gray-200' : 'bg-zinc-800'} rounded-full overflow-hidden`}>
                  <div
                    className="h-full bg-gradient-to-r from-yellow-400 to-orange-400 transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className={`text-xs ${labelClass} text-center`}>{processingStatus}</p>
              </div>
            )}

            {/* Submit Button */}
            <Button aria-label="Loader2"
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
      
      {/* VideoInfoModal - Extracted to create-post/VideoInfoModal.js */}
      <VideoInfoModal isOpen={showVideoInfoModal} onClose={() => setShowVideoInfoModal(false)} isLight={isLight} />
      
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

      {/* Casual Social Media Editor */}
      {selectedFiles.length > 0 && selectedFiles[editingFileIndex] && (
        <CasualEditorModal
          isOpen={showCasualEditor}
          onClose={() => setShowCasualEditor(false)}
          file={selectedFiles[editingFileIndex]}
          fileIndex={editingFileIndex}
          weatherData={{
            spotName: location || selectedSpot,
            waveHeight: waveHeightFt,
            wavePeriod: wavePeriodSec,
            windSpeed: windSpeedMph,
            windDir: windDirection
          }}
          theme={theme}
          onSave={(editedFile, index) => {
            const updatedFiles = [...selectedFiles];
            updatedFiles[index] = editedFile;
            setSelectedFiles(updatedFiles);

            const updatedPreviews = [...previewUrls];
            URL.revokeObjectURL(updatedPreviews[index]);
            updatedPreviews[index] = URL.createObjectURL(editedFile);
            setPreviewUrls(updatedPreviews);
            
            toast.success("Edits saved to draft post!");
          }}
        />
      )}
    </div>
  );
};
