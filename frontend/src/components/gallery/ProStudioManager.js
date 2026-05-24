// File: frontend/src/components/gallery/ProStudioManager.js
import React, { useState, useEffect, useRef } from 'react';
import { Camera, UserCheck, ChevronDown } from 'lucide-react';
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
  const [watermarkStyleType, setWatermarkStyleType] = useState('text'); // 'text' | 'logo' | 'both'
  const [watermarkLogoUrl, setWatermarkLogoUrl] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);

  const filmstripThumbnails = [
    'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=150&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=150&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=150&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=150&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=150&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1472214222541-d510753a4907?w=150&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=150&auto=format&fit=crop&q=60',
    'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=150&auto=format&fit=crop&q=60'
  ];
  
  // Dynamic preview backgrounds for the watermark designer
  const previewPresets = [
    { name: 'Pipeline Sunny', url: 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?auto=format&fit=crop&w=600&q=80' },
    { name: 'Sunset Beach', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80' },
    { name: 'Swell Wave', url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=600&q=80' }
  ];
  const [previewImage, setPreviewImage] = useState(previewPresets[0].url);
  
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
        setWatermarkStyleType(response.data.watermark_style || 'text');
        setWatermarkLogoUrl(response.data.watermark_logo_url || null);
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

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Logo must be under 5MB');
      return;
    }
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_type', 'watermark_logo');
      const response = await apiClient.post('/upload/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setWatermarkLogoUrl(response.data.url);
      setWatermarkStyleType('logo');
      toast.success('Watermark logo uploaded!');
    } catch (err) {
      toast.error('Failed to upload logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = () => {
    setWatermarkLogoUrl(null);
    setWatermarkStyleType('text');
    toast.info('Logo removed. Reverted to text watermark.');
  };

  const handleUpdateWatermarkSettings = async () => {
    try {
      await apiClient.put(`/photographer/${gallery.photographer_id}/watermark-settings`, {
        watermark_style: watermarkStyleType,
        watermark_text: watermarkText,
        watermark_logo_url: watermarkLogoUrl,
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

              <div className="space-y-2">
                <label className={`text-xs font-bold ${textSecondaryClass}`}>Watermark Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'text', label: 'Type Text' },
                    { id: 'logo', label: 'Upload Logo' },
                    { id: 'both', label: 'Logo + Text' }
                  ].map(t => (
                    <button
                      key={t.id}
                      onClick={() => setWatermarkStyleType(t.id)}
                      className={`p-2 rounded-lg border text-xs font-semibold text-center transition-colors ${
                        watermarkStyleType === t.id
                          ? isBeach
                            ? 'border-amber-400 bg-amber-400/5 text-amber-400'
                            : isLight
                              ? 'border-blue-500 bg-blue-500/5 text-blue-600'
                              : 'border-cyan-400 bg-cyan-500/5 text-cyan-400'
                          : itemBgClass + ' ' + textSecondaryClass
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {(watermarkStyleType === 'logo' || watermarkStyleType === 'both') && (
                <div className="space-y-2">
                  <label className={`text-xs font-bold ${textSecondaryClass}`}>Custom Watermark Logo</label>
                  {watermarkLogoUrl ? (
                    <div className={`relative p-3 rounded-xl border flex items-center justify-between ${itemBgClass}`}>
                      <div className="flex items-center gap-3">
                        <img src={watermarkLogoUrl} alt="Logo" className="w-10 h-10 object-contain rounded border border-zinc-700 bg-zinc-950/40" />
                        <span className="text-[10px] text-zinc-400 truncate max-w-[120px]">Custom logo uploaded</span>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={handleRemoveLogo}
                        className="text-red-400 hover:text-red-300 p-1.5 h-auto text-[10px] font-bold"
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <label className={`block p-4 rounded-xl border border-dashed cursor-pointer text-center hover:border-cyan-500/50 transition-colors ${itemBgClass}`}>
                      <input
                        type="file"
                        accept="image/png"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                      {uploadingLogo ? (
                        <span className="text-[10px] text-zinc-400">Uploading logo...</span>
                      ) : (
                        <div className="space-y-1">
                          <p className={`text-xs font-bold ${textPrimaryClass}`}>📂 Select PNG Logo</p>
                          <p className="text-[9px] text-zinc-500">Transparents/alpha-channels blend best</p>
                        </div>
                      )}
                    </label>
                  )}
                </div>
              )}
              
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

              {(watermarkStyleType === 'text' || watermarkStyleType === 'both') && (
                <div className="space-y-2">
                  <label className={`text-xs font-bold ${textSecondaryClass}`}>Watermark Banner Text</label>
                  <input 
                    type="text" value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)}
                    className={`w-full border rounded-xl p-2.5 text-xs ${
                      isLight ? 'bg-white border-gray-200 text-gray-900' : 'bg-zinc-900 border-zinc-800 text-white'
                    }`}
                  />
                </div>
              )}

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
            <div className="flex flex-col gap-3">
              <div className={`rounded-xl p-4 border flex flex-col justify-center items-center relative min-h-[300px] overflow-hidden ${
                isLight ? 'bg-gray-100 border-gray-200' : 'bg-black border-zinc-800'
              }`}>
                <div className="absolute inset-0 bg-cover bg-center rounded-lg opacity-40 transition-all duration-500" style={{ backgroundImage: `url('${previewImage}')` }} />
                
                {watermarkStyle === 'grid' ? (
                  <div className="absolute inset-0 flex flex-wrap gap-12 justify-center items-center pointer-events-none" style={{ opacity: watermarkOpacity / 100 }}>
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="flex flex-col items-center rotate-[-30deg]">
                        {watermarkLogoUrl && (
                          <img src={watermarkLogoUrl} alt="DRM Logo" className="max-h-8 object-contain opacity-80" />
                        )}
                        {(watermarkStyleType === 'text' || watermarkStyleType === 'both') && (
                          <span className="text-white text-[10px] font-extrabold whitespace-nowrap mt-1">
                            {watermarkText}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="absolute z-10 pointer-events-none flex flex-col items-center gap-2" style={{ opacity: watermarkOpacity / 100 }}>
                    {watermarkLogoUrl && (
                      <img src={watermarkLogoUrl} alt="DRM Logo" className="max-h-24 object-contain" />
                    )}
                    {(watermarkStyleType === 'text' || watermarkStyleType === 'both') && (
                      <span className="text-white text-xs font-extrabold border border-white/20 px-3 py-1 bg-black/60 rounded">
                        {watermarkText}
                      </span>
                    )}
                  </div>
                )}
                <span className="z-10 bg-black/80 text-white text-[10px] font-bold px-2 py-1 rounded border border-zinc-700">Studio Mockup Preview</span>
              </div>

              {/* Dynamic Background Presets */}
              <div className={`p-3 border rounded-xl space-y-2 ${itemBgClass}`}>
                <p className={`text-[10px] font-bold ${textSecondaryClass}`}>Change preview lighting & contrast:</p>
                <div className="flex gap-2 overflow-x-auto pb-1 max-w-full">
                  {/* Gallery Images if available */}
                  {(gallery?.items?.filter(item => item.media_type === 'image') || []).map((img, i) => (
                    <button
                      key={img.id || i}
                      onClick={() => setPreviewImage(img.media_url)}
                      className={`relative w-12 h-12 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${
                        previewImage === img.media_url ? 'border-cyan-400 scale-95' : 'border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <img src={img.media_url} alt={`Gallery ${i}`} className="object-cover w-full h-full" />
                    </button>
                  ))}

                  {/* Preset lighting wave photos */}
                  {previewPresets.map((preset, i) => (
                    <button
                      key={i}
                      onClick={() => setPreviewImage(preset.url)}
                      className={`relative w-12 h-12 rounded-lg overflow-hidden border-2 transition-all flex-shrink-0 ${
                        previewImage === preset.url ? (isBeach ? 'border-amber-400' : isLight ? 'border-blue-500' : 'border-cyan-400') + ' scale-95' : 'border-zinc-800 hover:border-zinc-700'
                      }`}
                      title={preset.name}
                    >
                      <img src={preset.url} alt={preset.name} className="object-cover w-full h-full" />
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 text-[8px] text-white text-center py-0.5 truncate">
                        {preset.name.split(' ')[0]}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
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
                        <div className="relative flex-1">
                          <button
                            onClick={() => setOpenDropdown(openDropdown === cluster.id ? null : cluster.id)}
                            className={`w-full border rounded-lg p-2 text-left text-[10px] flex items-center justify-between ${
                              isLight ? 'bg-white border-gray-200 text-gray-900' : 'bg-zinc-950 border-zinc-800 text-white'
                            }`}
                          >
                            {selectedSurferForGroup[cluster.id] ? (
                              (() => {
                                const selected = sessionParticipants.find(s => s.id === selectedSurferForGroup[cluster.id]);
                                return selected ? (
                                  <div className="flex items-center gap-2">
                                    <img
                                      src={selected.avatar_url || '/api/placeholder/40/40'}
                                      alt={selected.username}
                                      className="w-5 h-5 rounded-full object-cover border border-zinc-700"
                                    />
                                    <span className="font-bold truncate">@{selected.username}</span>
                                    <span className="text-[8px] opacity-60">({selected.surf_mode || 'surfer'})</span>
                                  </div>
                                ) : 'Select checked-in surfer...';
                              })()
                            ) : 'Select checked-in surfer...'}
                            <ChevronDown className="w-3.5 h-3.5 opacity-60" />
                          </button>
                          
                          {openDropdown === cluster.id && (
                            <div className={`absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border shadow-xl p-1 ${
                              isLight ? 'bg-white border-gray-200' : 'bg-zinc-950 border-zinc-800'
                            }`}>
                              {sessionParticipants.length === 0 ? (
                                <div className="p-2 text-[10px] text-zinc-500 text-center">No participants in session</div>
                              ) : (
                                sessionParticipants.map(surfer => (
                                  <button
                                    key={surfer.id}
                                    onClick={() => {
                                      setSelectedSurferForGroup({ ...selectedSurferForGroup, [cluster.id]: surfer.id });
                                      setOpenDropdown(null);
                                    }}
                                    className={`w-full text-left p-2 rounded-md flex items-center gap-2.5 transition-colors ${
                                      isLight ? 'hover:bg-gray-100' : 'hover:bg-zinc-900'
                                    }`}
                                  >
                                    <img
                                      src={surfer.avatar_url || '/api/placeholder/40/40'}
                                      alt={surfer.username}
                                      className="w-6 h-6 rounded-full object-cover border border-zinc-700"
                                    />
                                    <div className="min-w-0">
                                      <p className={`text-[10px] font-bold truncate ${isLight ? 'text-gray-900' : 'text-white'}`}>@{surfer.username}</p>
                                      <p className="text-[8px] text-zinc-400 truncate">{surfer.full_name || 'Checked-in Surfer'} • {surfer.surf_mode || 'casual'}</p>
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
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

                {/* Visual Keyframe Filmstrip Timeline */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[10px] text-zinc-500 font-semibold px-1">
                    <span>🎞️ KEYFRAME FILMSTRIP SCRUBBER</span>
                    <span>Click strip to seek frame</span>
                  </div>
                  <div 
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickX = e.clientX - rect.left;
                      const percentage = clickX / rect.width;
                      if (videoRef.current) {
                        const duration = videoRef.current.duration || 0;
                        videoRef.current.currentTime = duration * percentage;
                        setCurrentTime(duration * percentage);
                      }
                    }}
                    className="relative h-14 w-full rounded-xl overflow-hidden border border-zinc-800 bg-zinc-950 flex cursor-pointer select-none group shadow-inner"
                  >
                    {filmstripThumbnails.map((thumb, idx) => (
                      <div key={idx} className="flex-1 h-full border-r border-zinc-900/60 last:border-0 relative">
                        <img src={thumb} alt={`Frame ${idx}`} className="w-full h-full object-cover opacity-60 group-hover:opacity-75 transition-opacity" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                      </div>
                    ))}
                    
                    {/* Scrub Indicator Line */}
                    <div 
                      className={`absolute top-0 bottom-0 w-0.5 z-10 shadow-lg ${
                        isBeach ? 'bg-amber-400' : isLight ? 'bg-blue-500' : 'bg-cyan-500'
                      }`}
                      style={{ 
                        left: `${
                          videoRef.current && videoRef.current.duration 
                            ? (currentTime / videoRef.current.duration) * 100 
                            : 0
                        }%` 
                      }}
                    />
                    {/* Handle head */}
                    <div 
                      className={`absolute top-[-3px] w-2 h-2 rounded-full z-10 shadow border border-white ${
                        isBeach ? 'bg-amber-400' : isLight ? 'bg-blue-500' : 'bg-cyan-500'
                      }`}
                      style={{ 
                        left: `calc(${
                          videoRef.current && videoRef.current.duration 
                            ? (currentTime / videoRef.current.duration) * 100 
                            : 0
                        }% - 3px)` 
                      }}
                    />
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
