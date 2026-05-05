/**
 * useCreatePostActions.js - Extracted from CreatePost.js
 * Post creation: media upload, compression, tag, spot selection.
 * 18 pure handlers.
 */
import apiClient from '../lib/apiClient';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const useCreatePostActions = ({
  user, navigate, selectedSpot, caption, selectedFiles, previewUrls,
  captionRef, hashtagRef,
  allSpots, knownSpots, location,
  sessionDate, sessionStartTime, sessionEndTime,
  waveHeightFt, wavePeriodSec, waveDirection, waveDirectionDegrees,
  windSpeedMph, windDirection, tideStatus, tideHeightFt, showSessionData,
  conditionsSource, mentions, currentPreviewIndex,
  showMentionAutocomplete, showHashtagAutocomplete, hashtagQuery, hashtagIndex, hashtagEndIndex,
  mentionRef,
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
}) => {

    const fetchSpots = async () => {
      try {
        const response = await apiClient.get(`/surf-conditions/known-spots`);
        setKnownSpots(response.data.spots || []);
      } catch (e) {
        // Silent fail
      }
    };

    const fetchRecentLocations = async () => {
      if (!user?.id) return;
      try {
        const response = await apiClient.get(`/posts/user/${user.id}/recent-locations`);
        setRecentLocations(response.data || []);
        if (response.data && response.data.length > 0) {
          setShowRecentLocations(true);
        }
      } catch (e) {
        // Silent fail
      }
    };

    const fetchAllSpots = async () => {
      try {
        const response = await apiClient.get(`/surf-spots`);
        setAllSpots(response.data || []);
      } catch (e) { /* silent */ }
    };

    const fetchLocationHierarchy = async () => {
      try {
        const response = await apiClient.get(`/surf-spots/locations`);
        setLocationHierarchy(response.data || { countries: [] });
      } catch (e) { /* silent */ }
    };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const handleHierarchySpotSelect = (spotId) => {
    const spot = allSpots.find(s => s.id === spotId);
    if (spot) {
      setLocation(spot.name);
      if (spot.latitude && spot.longitude) {
        fetchConditions(spot.latitude, spot.longitude, spot.name);
      }
    }
  };

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
      const response = await apiClient.get(`/surf-conditions`, {
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

  const compressImageToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.src = e.target.result;
      img.onload = () => {
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setLoading(true);
    setUploadProgress(0);

    try {
      const uploadedMedia = [];
      const isCarousel = selectedFiles.length > 1;
      
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const isVideo = file.type.startsWith('video/');

        setProcessingStatus(
          isCarousel 
            ? `Processing photo ${i + 1} of ${selectedFiles.length}...` 
            : (isVideo ? 'Uploading & processing video...' : 'Processing...')
        );

        if (isVideo) {
          // Videos still go through server upload for transcoding
          const formData = new FormData();
          formData.append('file', file);
          formData.append('user_id', user.id);
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
        } else {
          // Images: compress and store as base64 directly in DB (no ephemeral disk)
          const base64 = await compressImageToBase64(file);
          setUploadProgress(Math.round(((i + 1) / selectedFiles.length) * 100));
          uploadedMedia.push({
            url: base64,
            type: 'image',
            thumbnail_url: null,
            width: null,
            height: null
          });
        }
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
      const _mentionsToNotify = mentions.length > 0 ? mentions.map(m => ({
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

      await apiClient.post(`/posts?author_id=${user.id}`, postData);

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


  return {
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
  };
};

export default useCreatePostActions;