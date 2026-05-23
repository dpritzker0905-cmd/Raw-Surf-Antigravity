// File: frontend/src/components/gallery/ProStudioManager.js
import React, { useState, useEffect, useRef } from 'react';
import { Camera, UserCheck } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';

export const ProStudioManager = ({ gallery, galleryId, sessionParticipants, theme }) => {
  const [activePane, setActivePane] = useState('watermark'); // 'watermark' | 'tagging' | 'timeline'
  const [watermarkStyle, setWatermarkStyle] = useState('grid'); // 'grid' | 'center'
  const [watermarkOpacity, setWatermarkOpacity] = useState(12);
  const [watermarkText, setWatermarkText] = useState('RAW SURF DRM');
  const [detectedSurfers, setDetectedSurfers] = useState([]);
  const [selectedSurferForGroup, setSelectedSurferForGroup] = useState({});
  const [activeVideo, setActiveVideo] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  
  const videoRef = useRef(null);

  // Theme-aware classes
  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  
  const cardBgClass = isLight ? 'bg-white border-gray-200 shadow-sm' : isBeach ? 'bg-zinc-950 border-zinc-800' : 'bg-zinc-800/50 border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : isBeach ? 'text-amber-50/90' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-500' : isBeach ? 'text-amber-200/50' : 'text-zinc-400';
  const itemBgClass = isLight ? 'bg-gray-50 border-gray-200' : isBeach ? 'bg-black border-zinc-800' : 'bg-zinc-900 border-zinc-800';
  const tabBorderClass = isLight ? 'border-gray-200' : isBeach ? 'border-zinc-800' : 'border-zinc-800';
  const activeTabClass = isLight ? 'bg-blue-600 text-white' : isBeach ? 'bg-amber-400 text-black font-bold' : 'bg-cyan-500 text-black font-bold';
  const buttonHighlightClass = isLight ? 'bg-blue-600 hover:bg-blue-700 text-white font-bold' : isBeach ? 'bg-amber-400 hover:bg-amber-500 text-black font-bold' : 'bg-cyan-500 hover:bg-cyan-600 text-black font-bold';
  const progressAccentClass = isLight ? 'accent-blue-500' : isBeach ? 'accent-amber-400' : 'accent-cyan-400';

  // Load session video files for frame exporter
  useEffect(() => {
    if (gallery?.items) {
      const videos = gallery.items.filter(item => item.media_type === 'video');
      if (videos.length > 0) setActiveVideo(videos[0]);
    }
  }, [gallery]);

  // Load photographer watermark settings and detected surfer clusters
  useEffect(() => {
    if (galleryId) {
      fetchAICells();
    }
    if (gallery?.photographer_id) {
      fetchWatermarkSettings();
    }
  }, [galleryId, gallery?.photographer_id]);

  const fetchWatermarkSettings = async () => {
    try {
      const response = await apiClient.get(`/photographer/${gallery.photographer_id}/watermark-settings`);
      if (response.data) {
        setWatermarkStyle(response.data.watermark_position === 'tiled' ? 'grid' : 'center');
        setWatermarkOpacity(Math.round((response.data.watermark_opacity || 0.5) * 100));
        setWatermarkText(response.data.watermark_text || 'RAW SURF DRM');
      }
    } catch (err) {
      // Graceful fallback if settings are uninitialized
    }
  };

  const fetchAICells = async () => {
    try {
      const response = await apiClient.get(`/gallery/${galleryId}/ai-clusters`);
      setDetectedSurfers(response.data.clusters || []);
    } catch (err) {
      // Mocked fallback clusters if API endpoint is still syncing
      setDetectedSurfers([
        { id: 'c1', wetsuit: 'Red/Black', board: 'Yellow Thruster', mediaCount: 15, keyframe: '/api/placeholder/100/100' },
        { id: 'c2', wetsuit: 'Blue Fullsuit', board: 'White Longboard', mediaCount: 8, keyframe: '/api/placeholder/100/100' }
      ]);
    }
  };

  const handleUpdateWatermarkSettings = async () => {
    try {
      await apiClient.put(`/photographer/${gallery.photographer_id}/watermark-settings`, {
        watermark_style: 'text',
        watermark_text: watermarkText,
        watermark_logo_url: null,
        watermark_opacity: watermarkOpacity / 100,
        watermark_position: watermarkStyle === 'grid' ? 'tiled' : 'center',
        default_watermark_in_selection: true
      });
      toast.success("Watermark parameters updated across session previews!");
    } catch (err) {
      toast.error("Failed to update watermark configuration");
    }
  };

  const handleConfirmTagGroup = async (clusterId) => {
    const surferId = selectedSurferForGroup[clusterId];
    if (!surferId) {
      toast.warning("Please select a surfer from the checked-in list.");
      return;
    }

    try {
      await apiClient.post(`/gallery/${galleryId}/confirm-tag-cluster`, {
        cluster_id: clusterId,
        surfer_id: surferId
      });
      toast.success("AI surfer tag matches locked! Notification emails dispatched.");
      fetchAICells();
    } catch (err) {
      toast.error("Failed to confirm tag cluster");
    }
  };

  const handleExportFrame = async () => {
    if (!activeVideo || !videoRef.current) return;
    const time = videoRef.current.currentTime;

    try {
      await apiClient.post(`/gallery/item/${activeVideo.id}/export-frame`, {
        timestamp: time,
        gallery_id: galleryId
      });
      toast.success("4K Frame exported, watermarked, and listed in e-commerce gallery!");
      window.location.reload();
    } catch (err) {
      toast.error("Could not export frame. Verify FFmpeg availability on host.");
    }
  };

  return (
    <div className={`border rounded-2xl p-6 space-y-6 ${cardBgClass}`}>
      
      {/* Header Tab Toggles */}
      <div className={`flex gap-2 border-b pb-4 ${tabBorderClass}`}>
        <Button 
          variant={activePane === 'watermark' ? 'default' : 'ghost'}
          onClick={() => setActivePane('watermark')}
          className={activePane === 'watermark' ? activeTabClass : `${textSecondaryClass} hover:text-white`}
        >
          🖼️ Watermark Designer
        </Button>
        <Button 
          variant={activePane === 'tagging' ? 'default' : 'ghost'}
          onClick={() => setActivePane('tagging')}
          className={activePane === 'tagging' ? activeTabClass : `${textSecondaryClass} hover:text-white`}
        >
          🤖 AI Surfer Queue
        </Button>
        <Button 
          variant={activePane === 'timeline' ? 'default' : 'ghost'}
          onClick={() => setActivePane('timeline')}
          className={activePane === 'timeline' ? activeTabClass : `${textSecondaryClass} hover:text-white`}
        >
          🎞️ 4K Frame Extractor
        </Button>
      </div>

      {/* Workspace Panel */}
      <div className="min-h-[380px]">
        
        {/* 1. Watermark Panel */}
        {activePane === 'watermark' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <h3 className={`text-base font-bold mb-1 ${textPrimaryClass}`}>DRM Brand designer</h3>
                <p className="text-xs text-zinc-400">Protect high-res commercial photographs against screenshot extraction.</p>
              </div>
              
              <div className="space-y-3">
                <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer ${itemBgClass}`}>
                  <input 
                    type="radio" name="w_style" checked={watermarkStyle === 'grid'}
                    onChange={() => setWatermarkStyle('grid')}
                    className={`w-4 h-4 rounded border-zinc-700 bg-zinc-800 ${
                      isBeach ? 'text-amber-400' : isLight ? 'text-blue-500' : 'text-cyan-400'
                    }`}
                  />
                  <div>
                    <p className={`text-xs font-bold ${textPrimaryClass}`}>Diagonal Repeating Grid</p>
                    <p className="text-[10px] text-zinc-400">Repeats overlay diagonally across the image. Recommended for high security.</p>
                  </div>
                </label>
                <label className={`flex items-center gap-3 p-3 border rounded-xl cursor-pointer ${itemBgClass}`}>
                  <input 
                    type="radio" name="w_style" checked={watermarkStyle === 'center'}
                    onChange={() => setWatermarkStyle('center')}
                    className={`w-4 h-4 rounded border-zinc-700 bg-zinc-800 ${
                      isBeach ? 'text-amber-400' : isLight ? 'text-blue-500' : 'text-cyan-400'
                    }`}
                  />
                  <div>
                    <p className={`text-xs font-bold ${textPrimaryClass}`}>Focal Center Emblem</p>
                    <p className="text-[10px] text-zinc-400">Positions a large watermark directly in the center of the frame.</p>
                  </div>
                </label>
              </div>

              <div className="space-y-2">
                <label className={`text-xs font-bold ${textSecondaryClass}`}>Watermark Banner Text</label>
                <input 
                  type="text" value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)}
                  className={`w-full border rounded-xl p-2.5 text-xs ${
                    isLight ? 'bg-white border-gray-200 text-gray-900' : 'bg-zinc-900 border-zinc-800 text-white'
                  }`}
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold text-zinc-300">
                  <span className={textSecondaryClass}>Overlay Opacity Scale</span>
                  <span className={isBeach ? 'text-amber-400' : isLight ? 'text-blue-500' : 'text-cyan-400'}>{watermarkOpacity}%</span>
                </div>
                <input 
                  type="range" min="5" max="30" value={watermarkOpacity}
                  onChange={(e) => setWatermarkOpacity(parseInt(e.target.value))}
                  className={`w-full h-1 rounded-lg cursor-pointer bg-zinc-800 ${progressAccentClass}`}
                />
              </div>

              <Button onClick={handleUpdateWatermarkSettings} className={buttonHighlightClass}>
                Apply Custom Watermark Settings
              </Button>
            </div>

            {/* Live Preview Area */}
            <div className={`rounded-xl p-4 border flex flex-col justify-center items-center relative min-h-[300px] overflow-hidden ${
              isLight ? 'bg-gray-100 border-gray-200' : 'bg-black border-zinc-800'
            }`}>
              <div className="absolute inset-0 bg-cover bg-center rounded-lg opacity-40" style={{ backgroundImage: "url('/api/placeholder/400/300')" }} />
              
              {watermarkStyle === 'grid' ? (
                <div className="absolute inset-0 flex flex-wrap gap-12 justify-center items-center pointer-events-none" style={{ opacity: watermarkOpacity / 100 }}>
                  {[...Array(6)].map((_, i) => (
                    <span key={i} className="text-white text-xs font-extrabold rotate-[-30deg] border border-white/20 px-2 py-0.5 whitespace-nowrap">
                      {watermarkText}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="absolute z-10 pointer-events-none" style={{ opacity: watermarkOpacity / 100 }}>
                  <span className="text-white text-sm font-extrabold border border-white px-4 py-2 bg-black/60 rounded">
                    ⚠️ {watermarkText}
                  </span>
                </div>
              )}
              <span className="z-10 bg-black/80 text-white text-[10px] font-bold px-2 py-1 rounded border border-zinc-700">Studio Mockup Preview</span>
            </div>
          </div>
        )}

        {/* 2. AI Tagging Panel */}
        {activePane === 'tagging' && (
          <div className="space-y-4">
            <div>
              <h3 className={`text-base font-bold mb-1 ${textPrimaryClass}`}>🤖 Session Surfer Parser</h3>
              <p className="text-xs text-zinc-400">Match surfer visuals detected in this session with active surfers check-ins.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {detectedSurfers.map((cluster) => (
                <Card key={cluster.id} className={cardBgClass}>
                  <CardContent className="p-4 flex gap-4 items-center">
                    <img src={cluster.keyframe} alt="Surfer cutout" className="w-16 h-16 object-cover rounded-lg border border-zinc-700 flex-shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div>
                        <h4 className={`text-xs font-bold ${textPrimaryClass}`}>👤 Detected Surfer #{cluster.id}</h4>
                        <p className="text-[10px] text-zinc-400 truncate">Wetsuit: {cluster.wetsuit} | Board: {cluster.board}</p>
                        <p className={`text-[10px] font-semibold mt-0.5 ${
                          isBeach ? 'text-amber-400' : isLight ? 'text-blue-500' : 'text-cyan-400'
                        }`}>{cluster.mediaCount} matched assets</p>
                      </div>
                      
                      {/* Surfer Select Dropdown */}
                      <div className="flex gap-2">
                        <select
                          onChange={(e) => setSelectedSurferForGroup({ ...selectedSurferForGroup, [cluster.id]: e.target.value })}
                          className={`border rounded-lg p-1.5 text-[10px] flex-1 ${
                            isLight 
                              ? 'bg-white border-gray-200 text-gray-900' 
                              : 'bg-zinc-950 border-zinc-800 text-white'
                          }`}
                        >
                          <option value="">Select checked-in surfer...</option>
                          {sessionParticipants.map(surfer => (
                            <option key={surfer.id} value={surfer.id}>@{surfer.username} ({surfer.surf_mode || 'surfer'})</option>
                          ))}
                        </select>
                        <Button 
                          size="sm" onClick={() => handleConfirmTagGroup(cluster.id)}
                          className={`${buttonHighlightClass} text-[10px] px-2.5 h-8 font-bold flex items-center gap-1`}
                        >
                          <UserCheck className="w-3.5 h-3.5" /> Match
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* 3. 4K Frame Extractor Panel */}
        {activePane === 'timeline' && (
          <div className="space-y-4">
            <div>
              <h3 className={`text-base font-bold mb-1 ${textPrimaryClass}`}>🎞️ 4K Frame Grabber</h3>
              <p className="text-xs text-zinc-400">Extract high-res saleable photos directly from your session video clips.</p>
            </div>

            {activeVideo ? (
              <div className="space-y-4">
                {/* Active Player */}
                <div className="relative rounded-xl overflow-hidden border border-zinc-800 bg-black aspect-video">
                  <video
                    ref={videoRef}
                    src={activeVideo.media_url}
                    controls
                    className="w-full h-full object-contain"
                    onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
                  />
                  <div className="absolute top-3 left-3 bg-black/80 px-2 py-1 rounded text-[10px] text-zinc-300">
                    📹 Active Clip: {activeVideo.filename}
                  </div>
                </div>

                <div className={`flex justify-between items-center p-4 border rounded-xl ${itemBgClass}`}>
                  <div>
                    <p className="text-xs text-zinc-400 font-semibold">Timestamp scrub position</p>
                    <p className={`text-sm font-bold ${textPrimaryClass}`}>
                      {new Date(currentTime * 1000).toISOString().substr(14, 5)} / {new Date((videoRef.current?.duration || 0) * 1000).toISOString().substr(14, 5)}
                    </p>
                  </div>
                  <Button onClick={handleExportFrame} className={buttonHighlightClass}>
                    <Camera className="w-4 h-4 mr-2" /> Export Active Frame as Photo
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
                <Camera className="w-12 h-12 mx-auto mb-3 opacity-30 animate-pulse" />
                <p className="text-xs">No video files exist in this session gallery to run frame grabs on.</p>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
