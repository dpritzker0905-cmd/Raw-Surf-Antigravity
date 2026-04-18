import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Droplet, Type, Image, Move, Eye, Upload, X, Loader2, Check, AlertCircle } from 'lucide-react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import logger from '../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

const WatermarkSettings = ({ open, onOpenChange, theme = 'dark' }) => {
  const { user } = useAuth();
  const isLight = theme === 'light';
  
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondaryClass = isLight ? 'text-gray-600' : 'text-zinc-400';
  const borderClass = isLight ? 'border-gray-200' : 'border-zinc-700';
  const bgCardClass = isLight ? 'bg-gray-100' : 'bg-zinc-800';

  // Watermark settings state
  const [settings, setSettings] = useState({
    watermark_style: 'text',  // 'text', 'logo', 'both'
    watermark_text: '',
    watermark_logo_url: null,
    watermark_opacity: 0.5,
    watermark_position: 'bottom-right'  // 'center', 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'tiled'
  });
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [generatingPreview, setGeneratingPreview] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');

  // Sample preview image for testing watermark
  const sampleImage = 'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800';

  // Load existing settings on mount
  useEffect(() => {
    if (open && user?.id) {
      fetchSettings();
    }
  }, [open, user?.id]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get(`/users/${user.id}/profile`);
      const profile = response.data;
      
      setSettings({
        watermark_style: profile.watermark_style || 'text',
        watermark_text: profile.watermark_text || profile.business_name || profile.full_name || '',
        watermark_logo_url: profile.watermark_logo_url || null,
        watermark_opacity: profile.watermark_opacity || 0.5,
        watermark_position: profile.watermark_position || 'bottom-right'
      });
    } catch (error) {
      logger.error('Error fetching watermark settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await apiClient.put(`/photographer/${user.id}/watermark-settings`, settings);
      setSavedMessage('Watermark settings saved!');
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (error) {
      logger.error('Error saving watermark settings:', error);
      setSavedMessage('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('Logo must be under 5MB');
      return;
    }

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_type', 'watermark_logo');

      const response = await apiClient.post(
        `/upload/image`,
        formData,
        {
          headers: { 'Content-Type': 'multipart/form-data' }
        }
      );

      setSettings(prev => ({
        ...prev,
        watermark_logo_url: response.data.url
      }));
    } catch (error) {
      logger.error('Error uploading logo:', error);
      alert('Failed to upload logo');
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = () => {
    setSettings(prev => ({
      ...prev,
      watermark_logo_url: null
    }));
  };

  const generatePreview = async () => {
    setGeneratingPreview(true);
    try {
      // Call backend to generate a preview with current settings
      const response = await apiClient.post(`/gallery/generate-watermark-preview`, {
        photographer_id: user.id,
        sample_image_url: sampleImage,
        watermark_style: settings.watermark_style,
        watermark_text: settings.watermark_text,
        watermark_logo_url: settings.watermark_logo_url,
        watermark_opacity: settings.watermark_opacity,
        watermark_position: settings.watermark_position
      });
      
      setPreviewUrl(response.data.preview_url);
    } catch (error) {
      logger.error('Error generating preview:', error);
      // Show local simulation if backend fails
      setPreviewUrl(sampleImage);
    } finally {
      setGeneratingPreview(false);
    }
  };

  const positionOptions = [
    { value: 'center', label: 'Center' },
    { value: 'bottom-right', label: 'Bottom Right' },
    { value: 'bottom-left', label: 'Bottom Left' },
    { value: 'top-right', label: 'Top Right' },
    { value: 'top-left', label: 'Top Left' },
    { value: 'tiled', label: 'Tiled (Repeated)' }
  ];

  const styleOptions = [
    { value: 'text', label: 'Text Only', icon: Type },
    { value: 'logo', label: 'Logo Only', icon: Image },
    { value: 'both', label: 'Logo + Text', icon: Droplet }
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border ${borderClass} sm:max-w-2xl`}>
        <DialogHeader className="shrink-0 border-b border-inherit px-4 sm:px-6 pt-4 pb-3">
          <DialogTitle className={`${textPrimaryClass} flex items-center gap-2`}>
            <Droplet className="w-5 h-5 text-cyan-400" />
            Watermark Settings
          </DialogTitle>
          <p className={`text-sm ${textSecondaryClass}`}>
            Customize how your watermark appears on preview images. Unpurchased photos will show this watermark.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
          </div>
        ) : (
          <div className="space-y-6">
            
            {/* Watermark Style Selection */}
            <div className="space-y-3">
              <Label className={textPrimaryClass}>Watermark Style</Label>
              <div className="grid grid-cols-3 gap-3">
                {styleOptions.map(option => {
                  const Icon = option.icon;
                  const isSelected = settings.watermark_style === option.value;
                  return (
                    <button
                      key={option.value}
                      data-testid={`watermark-style-${option.value}`}
                      onClick={() => setSettings(prev => ({ ...prev, watermark_style: option.value }))}
                      className={`
                        p-4 rounded-xl border-2 transition-all
                        ${isSelected 
                          ? 'border-cyan-500 bg-cyan-500/10' 
                          : `border-transparent ${bgCardClass} hover:border-cyan-500/50`
                        }
                      `}
                    >
                      <Icon className={`w-6 h-6 mx-auto mb-2 ${isSelected ? 'text-cyan-400' : textSecondaryClass}`} />
                      <span className={`text-sm ${isSelected ? 'text-cyan-400' : textPrimaryClass}`}>
                        {option.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Text Input (shown for 'text' and 'both' styles) */}
            {(settings.watermark_style === 'text' || settings.watermark_style === 'both') && (
              <div className="space-y-2">
                <Label className={textPrimaryClass}>Watermark Text</Label>
                <Input
                  data-testid="watermark-text-input"
                  value={settings.watermark_text}
                  onChange={(e) => setSettings(prev => ({ ...prev, watermark_text: e.target.value }))}
                  placeholder="Your business name or copyright text"
                  className={`${bgCardClass} border ${borderClass} ${textPrimaryClass}`}
                  maxLength={50}
                />
                <p className={`text-xs ${textSecondaryClass}`}>
                  {settings.watermark_text.length}/50 characters
                </p>
              </div>
            )}

            {/* Logo Upload (shown for 'logo' and 'both' styles) */}
            {(settings.watermark_style === 'logo' || settings.watermark_style === 'both') && (
              <div className="space-y-3">
                <Label className={textPrimaryClass}>Custom Logo</Label>
                
                {settings.watermark_logo_url ? (
                  <div className={`relative p-4 rounded-xl ${bgCardClass} border ${borderClass}`}>
                    <img
                      src={settings.watermark_logo_url}
                      alt="Watermark logo"
                      className="max-h-24 mx-auto object-contain"
                    />
                    <button
                      data-testid="remove-logo-btn"
                      onClick={removeLogo}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className={`
                    block p-6 rounded-xl border-2 border-dashed cursor-pointer
                    transition-all hover:border-cyan-500/50
                    ${bgCardClass} ${borderClass}
                  `}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                      data-testid="logo-upload-input"
                    />
                    {uploadingLogo ? (
                      <div className="flex items-center justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                      </div>
                    ) : (
                      <div className="text-center">
                        <Upload className={`w-8 h-8 mx-auto mb-2 ${textSecondaryClass}`} />
                        <p className={textPrimaryClass}>Upload Logo</p>
                        <p className={`text-xs ${textSecondaryClass} mt-1`}>PNG or SVG recommended (transparent background)</p>
                      </div>
                    )}
                  </label>
                )}
              </div>
            )}

            {/* Position Selection */}
            <div className="space-y-2">
              <Label className={textPrimaryClass}>Position</Label>
              <Select
                value={settings.watermark_position}
                onValueChange={(value) => setSettings(prev => ({ ...prev, watermark_position: value }))}
              >
                <SelectTrigger 
                  data-testid="watermark-position-select"
                  className={`${bgCardClass} border ${borderClass} ${textPrimaryClass}`}
                >
                  <SelectValue placeholder="Select position" />
                </SelectTrigger>
                <SelectContent className={`${isLight ? 'bg-white' : 'bg-zinc-800'} border ${borderClass}`}>
                  {positionOptions.map(option => (
                    <SelectItem 
                      key={option.value} 
                      value={option.value}
                      className={`${textPrimaryClass} hover:bg-cyan-500/10`}
                    >
                      <div className="flex items-center gap-2">
                        <Move className="w-4 h-4" />
                        {option.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Opacity Slider */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className={textPrimaryClass}>Opacity</Label>
                <span className={`text-sm ${textSecondaryClass}`}>
                  {Math.round(settings.watermark_opacity * 100)}%
                </span>
              </div>
              <Slider
                data-testid="watermark-opacity-slider"
                value={[settings.watermark_opacity * 100]}
                onValueChange={(values) => setSettings(prev => ({ ...prev, watermark_opacity: values[0] / 100 }))}
                min={10}
                max={100}
                step={5}
                className="w-full"
              />
              <div className="flex justify-between text-xs">
                <span className={textSecondaryClass}>Subtle</span>
                <span className={textSecondaryClass}>Bold</span>
              </div>
            </div>

            {/* Preview Section */}
            <div className={`p-4 rounded-xl ${bgCardClass} border ${borderClass}`}>
              <div className="flex items-center justify-between mb-3">
                <Label className={textPrimaryClass}>Preview</Label>
                <Button
                  data-testid="generate-preview-btn"
                  variant="outline"
                  size="sm"
                  onClick={generatePreview}
                  disabled={generatingPreview}
                  className="text-cyan-400 border-cyan-500/30"
                >
                  {generatingPreview ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Eye className="w-4 h-4 mr-2" />
                  )}
                  Generate Preview
                </Button>
              </div>
              
              <div className="relative aspect-video rounded-lg overflow-hidden bg-black/50">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Watermark preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <Image className={`w-12 h-12 mx-auto mb-2 ${textSecondaryClass}`} />
                      <p className={`text-sm ${textSecondaryClass}`}>
                        Click "Generate Preview" to see your watermark
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Simulated watermark overlay for instant feedback */}
                {!previewUrl && settings.watermark_text && (
                  <div 
                    className={`
                      absolute text-white/50 font-bold text-xl pointer-events-none
                      ${settings.watermark_position === 'center' ? 'inset-0 flex items-center justify-center' : ''}
                      ${settings.watermark_position === 'bottom-right' ? 'bottom-4 right-4' : ''}
                      ${settings.watermark_position === 'bottom-left' ? 'bottom-4 left-4' : ''}
                      ${settings.watermark_position === 'top-right' ? 'top-4 right-4' : ''}
                      ${settings.watermark_position === 'top-left' ? 'top-4 left-4' : ''}
                    `}
                    style={{ opacity: settings.watermark_opacity }}
                  >
                    {settings.watermark_text}
                  </div>
                )}
              </div>
            </div>

            {/* Save Status Message */}
            {savedMessage && (
              <div className={`
                flex items-center gap-2 p-3 rounded-lg
                ${savedMessage.includes('saved') 
                  ? 'bg-green-500/10 text-green-400' 
                  : 'bg-red-500/10 text-red-400'
                }
              `}>
                {savedMessage.includes('saved') 
                  ? <Check className="w-5 h-5" /> 
                  : <AlertCircle className="w-5 h-5" />
                }
                {savedMessage}
              </div>
            )}
          </div>
        )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="save-watermark-settings-btn"
            onClick={handleSaveSettings}
            disabled={saving}
            className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WatermarkSettings;
