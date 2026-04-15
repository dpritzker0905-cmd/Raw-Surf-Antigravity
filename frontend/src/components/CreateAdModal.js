/**
 * CreateAdModal - User-facing ad submission for Self-Serve Ad Engine
 * Similar flow to creating a social post - supports images and videos
 */
import React, { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import axios from 'axios';
import {
  Megaphone, Image, Video, X, Upload, Loader2, DollarSign,
  CheckCircle, AlertCircle, ExternalLink, Sparkles
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Ad type options
const AD_TYPES = [
  { value: 'sponsored', label: 'Sponsored', description: 'Promote your business or service' },
  { value: 'promo', label: 'Promotion', description: 'Special offers and deals' },
];

// Target role options
const TARGET_ROLES = [
  { value: '', label: 'All Users' },
  { value: 'Surfer', label: 'Surfers' },
  { value: 'Photographer', label: 'Photographers' },
  { value: 'Grom Parent', label: 'Parents' },
  { value: 'School', label: 'Schools & Coaches' },
];

export const CreateAdModal = ({ isOpen, onClose, onSuccess }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const fileInputRef = useRef(null);

  // Form state
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [cta, setCta] = useState('Learn More');
  const [ctaLink, setCtaLink] = useState('');
  const [adType, setAdType] = useState('sponsored');
  const [targetRole, setTargetRole] = useState('');
  const [budgetCredits, setBudgetCredits] = useState(10);
  
  // Media state
  const [mediaUrl, setMediaUrl] = useState(null);
  const [mediaType, setMediaType] = useState(null); // 'image' or 'video'
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  
  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1); // 1: content, 2: targeting, 3: preview

  const handleMediaSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    
    if (!isVideo && !isImage) {
      toast.error('Please select an image or video file');
      return;
    }

    // Check file size (max 10MB for images, 50MB for videos)
    const maxSize = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`File too large. Max ${isVideo ? '50MB' : '10MB'}`);
      return;
    }
    
    setUploadingMedia(true);
    setMediaType(isVideo ? 'video' : 'image');
    
    try {
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setMediaPreview(e.target.result);
      };
      reader.readAsDataURL(file);

      // Upload to server
      const formData = new FormData();
      formData.append('file', file);
      formData.append('user_id', user.id);
      formData.append('upload_type', 'ad_creative');

      const response = await axios.post(`${API}/uploads/media`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (isVideo) {
        setMediaUrl(response.data.video_url || response.data.url);
        setThumbnailUrl(response.data.thumbnail_url);
      } else {
        setMediaUrl(response.data.url);
      }
      
      toast.success('Media uploaded successfully');
    } catch (error) {
      logger.error('Upload error:', error);
      toast.error('Failed to upload media');
      clearMedia();
    } finally {
      setUploadingMedia(false);
    }
  };

  const clearMedia = () => {
    setMediaUrl(null);
    setMediaType(null);
    setThumbnailUrl(null);
    setMediaPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!headline.trim() || !description.trim() || !ctaLink.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (budgetCredits < 10) {
      toast.error('Minimum budget is $10');
      return;
    }

    if ((user?.credit_balance || 0) < budgetCredits) {
      toast.error(`Insufficient credits. You have $${user?.credit_balance || 0}`);
      return;
    }

    setSubmitting(true);
    try {
      const response = await axios.post(`${API}/ads/submit?user_id=${user.id}`, {
        headline: headline.trim(),
        description: description.trim(),
        cta: cta.trim() || 'Learn More',
        cta_link: ctaLink.trim(),
        ad_type: adType,
        target_roles: targetRole ? [targetRole] : [],
        image_url: mediaType === 'image' ? mediaUrl : null,
        video_url: mediaType === 'video' ? mediaUrl : null,
        thumbnail_url: thumbnailUrl,
        media_type: mediaType,
        budget_credits: budgetCredits
      });

      toast.success('Ad submitted for approval!', {
        description: `$${budgetCredits} deducted. New balance: $${response.data.new_balance}`
      });

      // Reset form
      resetForm();
      onSuccess?.();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit ad');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setHeadline('');
    setDescription('');
    setCta('Learn More');
    setCtaLink('');
    setAdType('sponsored');
    setTargetRole('');
    setBudgetCredits(10);
    clearMedia();
    setStep(1);
  };

  const canProceedToStep2 = headline.trim() && description.trim();
  const canProceedToStep3 = ctaLink.trim();
  const canSubmit = canProceedToStep2 && canProceedToStep3 && budgetCredits >= 10;

  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900';
  const textClass = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-600' : 'text-gray-400';
  const inputClass = isLight 
    ? 'bg-gray-50 border-gray-300 text-gray-900' 
    : 'bg-zinc-800 border-zinc-700 text-white';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${cardBg} border-zinc-800 sm:max-w-md`}>
        <DialogHeader className="shrink-0 border-b border-zinc-700 px-4 sm:px-6 pt-4 pb-3">
          <DialogTitle className={`${textClass} flex items-center gap-2`}>
            <Megaphone className="w-5 h-5 text-purple-500" />
            Create Ad
            <Badge className="bg-zinc-700 text-gray-300 text-xs">
              Step {step}/3
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {/* Step 1: Content */}
          {step === 1 && (
            <>
              {/* Media Upload */}
              <div>
                <label className={`text-sm font-medium ${textClass} mb-2 block`}>
                  Ad Creative (Optional)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  onChange={handleMediaSelect}
                  className="hidden"
                />
                
                {mediaPreview ? (
                  <div className="relative rounded-xl overflow-hidden border border-zinc-700">
                    {mediaType === 'video' ? (
                      <video 
                        src={mediaPreview} 
                        className="w-full h-40 object-cover" 
                        controls 
                      />
                    ) : (
                      <img 
                        src={mediaPreview} 
                        alt="Ad preview" 
                        className="w-full h-40 object-cover" 
                      />
                    )}
                    <button
                      onClick={clearMedia}
                      className="absolute top-2 right-2 p-1.5 bg-black/60 rounded-full hover:bg-black/80 transition-colors"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                    <div className="absolute bottom-2 left-2">
                      <Badge className={mediaType === 'video' ? 'bg-red-500' : 'bg-blue-500'}>
                        {mediaType === 'video' ? <Video className="w-3 h-3 mr-1" /> : <Image className="w-3 h-3 mr-1" />}
                        {mediaType}
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingMedia}
                    className={`w-full h-32 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 transition-colors ${
                      isLight 
                        ? 'border-gray-300 hover:border-purple-400 hover:bg-purple-50' 
                        : 'border-zinc-700 hover:border-purple-500 hover:bg-purple-500/10'
                    }`}
                  >
                    {uploadingMedia ? (
                      <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
                    ) : (
                      <>
                        <Upload className={`w-6 h-6 ${textSecondary}`} />
                        <span className={`text-sm ${textSecondary}`}>
                          Upload Image or Video
                        </span>
                        <span className={`text-xs ${textSecondary}`}>
                          Max 10MB image, 50MB video
                        </span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* Headline */}
              <div>
                <label className={`text-sm font-medium ${textClass} mb-2 block`}>
                  Headline *
                </label>
                <Input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="e.g., Get 50% Off Your First Session"
                  maxLength={60}
                  className={inputClass}
                />
                <span className={`text-xs ${textSecondary}`}>
                  {headline.length}/60 characters
                </span>
              </div>

              {/* Description */}
              <div>
                <label className={`text-sm font-medium ${textClass} mb-2 block`}>
                  Description *
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tell users what you're offering..."
                  maxLength={150}
                  rows={3}
                  className={`${inputClass} resize-none`}
                />
                <span className={`text-xs ${textSecondary}`}>
                  {description.length}/150 characters
                </span>
              </div>

              <Button
                onClick={() => setStep(2)}
                disabled={!canProceedToStep2}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                Continue to Targeting
              </Button>
            </>
          )}

          {/* Step 2: Targeting */}
          {step === 2 && (
            <>
              {/* CTA Button */}
              <div>
                <label className={`text-sm font-medium ${textClass} mb-2 block`}>
                  Button Text
                </label>
                <Input
                  value={cta}
                  onChange={(e) => setCta(e.target.value)}
                  placeholder="Learn More"
                  maxLength={20}
                  className={inputClass}
                />
              </div>

              {/* CTA Link */}
              <div>
                <label className={`text-sm font-medium ${textClass} mb-2 block`}>
                  Link URL *
                </label>
                <Input
                  value={ctaLink}
                  onChange={(e) => setCtaLink(e.target.value)}
                  placeholder="https://yoursite.com/offer"
                  className={inputClass}
                />
              </div>

              {/* Ad Type */}
              <div>
                <label className={`text-sm font-medium ${textClass} mb-2 block`}>
                  Ad Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {AD_TYPES.map((type) => (
                    <button
                      key={type.value}
                      onClick={() => setAdType(type.value)}
                      className={`p-3 rounded-lg border-2 text-left transition-colors ${
                        adType === type.value
                          ? 'border-purple-500 bg-purple-500/10'
                          : `border-zinc-700 ${isLight ? 'hover:border-gray-400' : 'hover:border-zinc-500'}`
                      }`}
                    >
                      <p className={`font-medium ${textClass}`}>{type.label}</p>
                      <p className={`text-xs ${textSecondary}`}>{type.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Target Audience */}
              <div>
                <label className={`text-sm font-medium ${textClass} mb-2 block`}>
                  Target Audience
                </label>
                <select
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  className={`w-full h-10 px-3 rounded-lg border ${inputClass}`}
                >
                  {TARGET_ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="flex-1 border-zinc-700"
                >
                  Back
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={!canProceedToStep3}
                  className="flex-1 bg-purple-600 hover:bg-purple-700"
                >
                  Review & Pay
                </Button>
              </div>
            </>
          )}

          {/* Step 3: Preview & Budget */}
          {step === 3 && (
            <>
              {/* Ad Preview */}
              <div className="rounded-xl border border-purple-500/30 overflow-hidden">
                <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 px-3 py-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span className={`text-sm font-medium ${textClass}`}>Ad Preview</span>
                </div>
                <div className="p-4 space-y-3">
                  {mediaPreview && (
                    <div className="rounded-lg overflow-hidden">
                      {mediaType === 'video' ? (
                        <video src={mediaPreview} className="w-full h-32 object-cover" />
                      ) : (
                        <img src={mediaPreview} alt="Ad" className="w-full h-32 object-cover" />
                      )}
                    </div>
                  )}
                  <div>
                    <h3 className={`font-bold ${textClass}`}>{headline || 'Your Headline'}</h3>
                    <p className={`text-sm ${textSecondary} mt-1`}>
                      {description || 'Your description here...'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" className="bg-purple-600 hover:bg-purple-700">
                      {cta || 'Learn More'}
                      <ExternalLink className="w-3 h-3 ml-1" />
                    </Button>
                    {targetRole && (
                      <Badge className="bg-zinc-700 text-gray-300">
                        Targeting: {targetRole}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Budget */}
              <div className="rounded-xl border border-green-500/30 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-green-500" />
                    <span className={`font-medium ${textClass}`}>Ad Budget</span>
                  </div>
                  <span className={`text-sm ${textSecondary}`}>
                    Balance: ${user?.credit_balance?.toFixed(2) || '0.00'}
                  </span>
                </div>
                
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    value={budgetCredits}
                    onChange={(e) => setBudgetCredits(Math.max(10, parseInt(e.target.value) || 10))}
                    min={10}
                    className={`${inputClass} w-24`}
                  />
                  <span className={textSecondary}>credits</span>
                </div>
                
                <p className={`text-xs ${textSecondary} mt-2`}>
                  Minimum $10. Higher budgets get more impressions.
                </p>
              </div>

              {/* Submit Info */}
              <div className={`rounded-lg p-3 ${isLight ? 'bg-blue-50' : 'bg-blue-500/10'} flex items-start gap-2`}>
                <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5" />
                <p className={`text-xs ${textSecondary}`}>
                  Your ad will be reviewed by our team within 24 hours. 
                  Credits are held until approval. Rejected ads get a full refund.
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(2)}
                  className="flex-1 border-zinc-700"
                >
                  Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit || submitting || (user?.credit_balance || 0) < budgetCredits}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-2" />
                  )}
                  Submit Ad (${budgetCredits})
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateAdModal;
