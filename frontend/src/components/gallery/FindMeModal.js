import React, { useState } from 'react';
import { Sparkles, Camera, X, Loader2, Search, ShieldCheck, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import apiClient from '../../lib/apiClient';
import { getErrorMessage } from '../../utils/errors';
import logger from '../../utils/logger';

/**
 * FindMeModal — AI-powered surfer identification in a gallery.
 * Lets surfers upload a selfie + optional board/wetsuit details,
 * then scans the gallery using the POST /gallery/{id}/find-me endpoint.
 *
 * Props:
 *   open      — boolean controlling visibility
 *   onClose   — callback to close the modal
 *   galleryId — the gallery to scan
 *   userId    — the requesting user's ID
 */
export const FindMeModal = ({ open, onClose, galleryId, userId }) => {
  const [selfieUrl, setSelfieUrl] = useState('');
  const [selfieFile, setSelfieFile] = useState(null);
  const [selfiePreview, setSelfiePreview] = useState(null);
  const [boardDescription, setBoardDescription] = useState('');
  const [wetsuitDescription, setWetsuitDescription] = useState('');
  const [stance, setStance] = useState('');
  const [scanning, setScanning] = useState(false);
  const [matches, setMatches] = useState(null);
  const [scanMeta, setScanMeta] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Handle selfie file selection
  const handleSelfieSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    setSelfieFile(file);
    setSelfiePreview(URL.createObjectURL(file));
    setSelfieUrl(''); // clear URL if a file is picked
  };

  // Upload selfie and get back URL, or use the pasted URL
  const getSelfieUrl = async () => {
    if (selfieUrl) return selfieUrl;
    if (!selfieFile) return null;

    // Upload selfie to backend for temporary storage
    const formData = new FormData();
    formData.append('file', selfieFile);
    formData.append('purpose', 'find_me_selfie');
    try {
      const res = await apiClient.post('/upload/temp', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data.url;
    } catch (err) {
      // Fallback: convert to base64 data URL
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(selfieFile);
      });
    }
  };

  // Execute the AI scan
  const handleScan = async () => {
    const url = await getSelfieUrl();
    if (!url) {
      toast.error('Please upload a selfie or paste a selfie URL');
      return;
    }
    setScanning(true);
    setMatches(null);
    setScanMeta(null);

    try {
      const response = await apiClient.post(
        `/gallery/${galleryId}/find-me`,
        {
          selfie_url: url,
          board_description: boardDescription || undefined,
          wetsuit_description: wetsuitDescription || undefined,
          stance: stance || undefined,
        }
      );
      const data = response.data;
      setMatches(data.matches || []);
      setScanMeta({
        totalScanned: data.total_photos_scanned,
        matchesFound: data.matches_found,
        scansRemaining: data.scans_remaining_today,
        maxPhotos: data.max_photos_per_scan,
        tier: data.subscription_tier,
      });

      if (data.matches_found > 0) {
        toast.success(`🤖 Found ${data.matches_found} match${data.matches_found > 1 ? 'es' : ''}!`);
      } else {
        toast.info('No matches found — try adjusting your details.');
      }
    } catch (error) {
      if (error.response?.status === 429) {
        toast.error(error.response.data?.detail || 'Daily scan limit reached');
      } else {
        toast.error(getErrorMessage(error, 'AI scan failed'));
      }
      logger.error('Find Me scan error:', error);
    } finally {
      setScanning(false);
    }
  };

  // Reset form
  const handleReset = () => {
    setMatches(null);
    setScanMeta(null);
    setSelfieFile(null);
    setSelfiePreview(null);
    setSelfieUrl('');
    setBoardDescription('');
    setWetsuitDescription('');
    setStance('');
    setShowAdvanced(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            AI Find Me
          </DialogTitle>
        </DialogHeader>

        {/* Pre-scan form */}
        {!matches && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a selfie and we'll scan this gallery to find photos of you using AI recognition.
            </p>

            {/* Selfie upload area */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Your Selfie *</label>
              {selfiePreview ? (
                <div className="relative w-24 h-24 rounded-xl overflow-hidden border-2 border-cyan-500/40">
                  <img src={selfiePreview} alt="Selfie" className="w-full h-full object-cover" />
                  <button
                    onClick={() => {
                      setSelfieFile(null);
                      setSelfiePreview(null);
                    }}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-zinc-600 rounded-xl cursor-pointer hover:border-cyan-500/50 transition-colors bg-muted/30">
                  <Camera className="w-8 h-8 text-zinc-500 mb-1" />
                  <span className="text-xs text-zinc-400">Tap to upload selfie</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="user"
                    className="hidden"
                    onChange={handleSelfieSelect}
                  />
                </label>
              )}
              {!selfieFile && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500 uppercase">or paste URL</span>
                  <Input
                    placeholder="https://..."
                    value={selfieUrl}
                    onChange={(e) => setSelfieUrl(e.target.value)}
                    className="text-xs h-8"
                  />
                </div>
              )}
            </div>

            {/* Advanced options toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              {showAdvanced ? 'Hide' : 'Show'} Advanced Options
            </button>

            {showAdvanced && (
              <div className="space-y-3 pl-2 border-l-2 border-cyan-500/20">
                <div>
                  <label className="text-xs font-medium text-gray-400">Board Description</label>
                  <Input
                    placeholder="e.g., white 6'2 shortboard with blue fins"
                    value={boardDescription}
                    onChange={(e) => setBoardDescription(e.target.value)}
                    className="text-xs h-8 mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400">Wetsuit / Rash Guard</label>
                  <Input
                    placeholder="e.g., black full suit, red rash guard"
                    value={wetsuitDescription}
                    onChange={(e) => setWetsuitDescription(e.target.value)}
                    className="text-xs h-8 mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400">Stance</label>
                  <div className="flex gap-2 mt-1">
                    {['regular', 'goofy'].map((s) => (
                      <button
                        key={s}
                        onClick={() => setStance(stance === s ? '' : s)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          stance === s
                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                            : 'bg-muted text-gray-400 hover:bg-zinc-700 border border-transparent'
                        }`}
                      >
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Privacy note */}
            <div className="flex items-start gap-2 p-2 bg-muted/50 rounded-lg">
              <ShieldCheck className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-gray-500 leading-relaxed">
                Your selfie is only used for this scan and is not stored permanently.
                AI matching uses visual pattern recognition — no facial data is retained.
              </p>
            </div>
          </div>
        )}

        {/* Scan results */}
        {matches && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {matches.length > 0
                    ? `🎯 ${matches.length} match${matches.length > 1 ? 'es' : ''} found`
                    : '😔 No matches found'}
                </p>
                <p className="text-[10px] text-gray-500">
                  Scanned {scanMeta?.totalScanned || 0} photos • {scanMeta?.scansRemaining ?? '?'} scans left today
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={handleReset} className="text-xs">
                New Scan
              </Button>
            </div>

            {/* Match grid */}
            {matches.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {matches.map((match, i) => (
                  <div
                    key={match.gallery_item_id}
                    className="relative rounded-xl overflow-hidden bg-zinc-800 group cursor-pointer"
                  >
                    <img
                      src={match.preview_url || match.thumbnail_url}
                      alt={`Match ${i + 1}`}
                      className="w-full aspect-square object-cover group-hover:scale-105 transition-transform"
                    />
                    {/* Confidence badge */}
                    <div className="absolute top-1 right-1">
                      <Badge
                        className={`text-[10px] py-0 ${
                          match.confidence >= 0.7
                            ? 'bg-green-500/80 text-white'
                            : match.confidence >= 0.5
                            ? 'bg-yellow-500/80 text-black'
                            : 'bg-orange-500/80 text-white'
                        }`}
                      >
                        {Math.round(match.confidence * 100)}%
                      </Badge>
                    </div>
                    {/* Price badge */}
                    {match.is_for_sale && match.price && (
                      <div className="absolute bottom-1 left-1 bg-black/70 backdrop-blur-sm rounded px-1.5 py-0.5">
                        <span className="text-[10px] font-bold text-green-400">${match.price}</span>
                      </div>
                    )}
                    {/* Match rank */}
                    <div className="absolute top-1 left-1 w-5 h-5 bg-cyan-500/90 rounded-full flex items-center justify-center">
                      <span className="text-[10px] font-bold text-white">{i + 1}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {!matches ? (
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={handleScan}
                disabled={scanning || (!selfieFile && !selfieUrl)}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
              >
                {scanning ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-1" />
                    Find Me
                  </>
                )}
              </Button>
            </div>
          ) : (
            <Button onClick={onClose} className="w-full">
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FindMeModal;
