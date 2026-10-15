import React, { useState, useEffect } from 'react';
import { useThemeName } from '../../contexts/ThemeContext';
import apiClient from '../../lib/apiClient';
import { Plus, X, Loader2, Waves } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { toast } from 'sonner';
import { BOARD_TYPES, FIN_SETUPS, CONDITIONS } from './constants';
import { ImageVisionPanel } from '../vision/ImageVisionPanel';

export const SurfboardModal = ({ isOpen, onClose, board, onSave, userId }) => {
  const theme = useThemeName();
  const isEditing = !!board?.id;
  
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    brand: '',
    model: '',
    length_feet: '',
    length_inches: '',
    width_inches: '',
    thickness_inches: '',
    volume_liters: '',
    board_type: '',
    fin_setup: '',
    condition: '',
    description: '',
    year_acquired: '',
    photo_urls: []
  });
  
  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (board) {
        setFormData({
          name: board.name || '',
          brand: board.brand || '',
          model: board.model || '',
          length_feet: board.length_feet || '',
          length_inches: board.length_inches || '',
          width_inches: board.width_inches || '',
          thickness_inches: board.thickness_inches || '',
          volume_liters: board.volume_liters || '',
          board_type: board.board_type || '',
          fin_setup: board.fin_setup || '',
          condition: board.condition || '',
          description: board.description || '',
          year_acquired: board.year_acquired || '',
          photo_urls: board.photo_urls || []
        });
      } else {
        setFormData({
          name: '', brand: '', model: '', length_feet: '', length_inches: '',
          width_inches: '', thickness_inches: '', volume_liters: '', board_type: '',
          fin_setup: '', condition: '', description: '', year_acquired: '', photo_urls: []
        });
      }
    }
  }, [isOpen, board]);
  
  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (formData.photo_urls.length + files.length > 5) {
      toast.error('Maximum 5 photos allowed');
      return;
    }
    
    setUploading(true);
    try {
      for (const file of files) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', file);
        
        const response = await apiClient.post(`/upload`, uploadFormData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        
        if (response.data.url) {
          setFormData(prev => ({
            ...prev,
            photo_urls: [...prev.photo_urls, response.data.url]
          }));
        }
      }
      toast.success('Photo uploaded!');
    } catch (error) {
      toast.error('Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };
  
  const handleRemovePhoto = (index) => {
    setFormData(prev => ({
      ...prev,
      photo_urls: prev.photo_urls.filter((_, i) => i !== index)
    }));
  };

  const applyScanSuggestions = (analysis) => {
    setFormData(previous => {
      const suggested = {
        brand: analysis.brand, model: analysis.model, description: analysis.description,
        board_type: BOARD_TYPES.some(type => type.value === analysis.board_type) ? analysis.board_type : null,
        fin_setup: FIN_SETUPS.some(setup => setup.value === analysis.fin_setup) ? analysis.fin_setup : null,
      };
      const next = { ...previous };
      Object.entries(suggested).forEach(([field, value]) => {
        if (!previous[field]?.trim() && typeof value === 'string' && value.trim()) next[field] = value;
      });
      return next;
    });
  };
  
  const handleSubmit = async () => {
    // Client-side validation: reject negative dimensions
    const dimChecks = { length_feet: 'Length (ft)', length_inches: 'Length (in)',
      width_inches: 'Width', thickness_inches: 'Thickness', volume_liters: 'Volume' };
    for (const [key, label] of Object.entries(dimChecks)) {
      if (formData[key] !== '' && formData[key] != null && Number(formData[key]) < 0) {
        toast.error(`${label} must be a positive number`); return;
      }
    }

    if (formData.year_acquired !== '' && formData.year_acquired != null) {
      const year = Number(formData.year_acquired);
      const currentYear = new Date().getFullYear();
      if (year < 1900 || year > currentYear + 1) {
        toast.error(`Year Acquired must be between 1900 and ${currentYear + 1}`); return;
      }
    }

    setLoading(true);
    try {
      const payload = {
        ...formData,
        length_feet: formData.length_feet ? parseInt(formData.length_feet) : null,
        length_inches: formData.length_inches ? parseInt(formData.length_inches) : null,
        width_inches: formData.width_inches ? parseFloat(formData.width_inches) : null,
        thickness_inches: formData.thickness_inches ? parseFloat(formData.thickness_inches) : null,
        volume_liters: formData.volume_liters ? parseFloat(formData.volume_liters) : null,
        year_acquired: formData.year_acquired ? parseInt(formData.year_acquired) : null
      };
      
      if (isEditing) {
        await apiClient.patch(`/surfboards/${board.id}`, payload);
        toast.success('Surfboard updated!');
      } else {
        await apiClient.post(`/surfboards/`, payload);
        toast.success('Surfboard added to your quiver!');
      }
      
      onSave();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save surfboard');
    } finally {
      setLoading(false);
    }
  };
  
  const textPrimary = 'text-foreground';
  const inputBg = theme === 'beach' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-background border-border text-foreground';
  const selectBg = theme === 'beach' ? 'bg-amber-50 text-amber-900' : 'bg-popover text-popover-foreground';
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-background text-foreground border-border max-w-lg p-0 flex flex-col">
        {/* Fixed Header */}
        <DialogHeader className="p-4 pb-2 border-b border-border flex-shrink-0">
          <DialogTitle className={`text-xl font-bold ${textPrimary} flex items-center gap-2`}>
            <Waves className="w-5 h-5 text-cyan-400" />
            {isEditing ? 'Edit Surfboard' : 'Add to Quiver'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">Add photos and board details. Review any scan suggestions before saving.</DialogDescription>
        </DialogHeader>
        
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {/* Photo Upload Section */}
          <div>
            <Label className={textPrimary}>Photos (up to 5)</Label>
            <div className="grid grid-cols-5 gap-2 mt-2">
              {formData.photo_urls.map((url, idx) => (
                <div key={idx} className="relative aspect-square rounded-lg overflow-hidden group">
                  <img loading="lazy" decoding="async" src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button" aria-label={`Remove board photo ${idx + 1}`}
                    onClick={() => handleRemovePhoto(idx)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {formData.photo_urls.length < 5 && (
                <label className="aspect-square rounded-lg border-2 border-dashed border-border hover:border-primary flex items-center justify-center cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-ring">
                  {uploading ? (
                    <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                  ) : (
                    <Plus className="w-6 h-6 text-muted-foreground" />
                  )}
                  <input aria-label="Upload file"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoUpload}
                    className="sr-only"
                    disabled={uploading}
                  />
                </label>
              )}
            </div>
          </div>
          
          {/* Brand & Model */}
          <ImageVisionPanel key={`${isOpen}-${board?.id || 'new'}`} kind="board" boardId={board?.id}
            images={formData.photo_urls.map(url => ({ id: url, url }))} onApply={applyScanSuggestions} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={textPrimary}>Brand / Shaper</Label>
              <Input
                aria-label="Brand / Shaper"
                value={formData.brand}
                onChange={(e) => setFormData(p => ({ ...p, brand: e.target.value }))}
                placeholder="e.g. Channel Islands"
                className={inputBg}
              />
            </div>
            <div>
              <Label className={textPrimary}>Model</Label>
              <Input
                aria-label="Model"
                value={formData.model}
                onChange={(e) => setFormData(p => ({ ...p, model: e.target.value }))}
                placeholder="e.g. Sampler"
                className={inputBg}
              />
            </div>
          </div>
          
          {/* Dimensions */}
          <div>
            <Label className={textPrimary}>Dimensions</Label>
            <div className="grid grid-cols-5 gap-2 mt-2">
              <div className="col-span-1">
                <Input
                  type="number"
                  min="0"
                  value={formData.length_feet}
                  onChange={(e) => setFormData(p => ({ ...p, length_feet: e.target.value }))}
                  placeholder="5"
                  className={inputBg}
                />
                <p className={`text-xs text-muted-foreground text-center mt-1`}>ft</p>
              </div>
              <div className="col-span-1">
                <Input aria-label="10"
                  type="number"
                  min="0"
                  value={formData.length_inches}
                  onChange={(e) => setFormData(p => ({ ...p, length_inches: e.target.value }))}
                  placeholder="10"
                  className={inputBg}
                />
                <p className={`text-xs text-muted-foreground text-center mt-1`}>in</p>
              </div>
              <div className="col-span-1">
                <Input aria-label="19.5"
                  type="number"
                  min="0"
                  step="0.25"
                  value={formData.width_inches}
                  onChange={(e) => setFormData(p => ({ ...p, width_inches: e.target.value }))}
                  placeholder="19.5"
                  className={inputBg}
                />
                <p className={`text-xs text-muted-foreground text-center mt-1`}>width</p>
              </div>
              <div className="col-span-1">
                <Input aria-label="2.5"
                  type="number"
                  min="0"
                  step="0.125"
                  value={formData.thickness_inches}
                  onChange={(e) => setFormData(p => ({ ...p, thickness_inches: e.target.value }))}
                  placeholder="2.5"
                  className={inputBg}
                />
                <p className={`text-xs text-muted-foreground text-center mt-1`}>thick</p>
              </div>
              <div className="col-span-1">
                <Input aria-label="28.5"
                  type="number"
                  min="0"
                  step="0.1"
                  value={formData.volume_liters}
                  onChange={(e) => setFormData(p => ({ ...p, volume_liters: e.target.value }))}
                  placeholder="28.5"
                  className={inputBg}
                />
                <p className={`text-xs text-muted-foreground text-center mt-1`}>liters</p>
              </div>
            </div>
          </div>
          
          {/* Board Type & Fin Setup */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={textPrimary}>Board Type</Label>
              <Select value={formData.board_type} onValueChange={(v) => setFormData(p => ({ ...p, board_type: v }))}>
                <SelectTrigger className={inputBg}>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent className={selectBg}>
                  {BOARD_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className={textPrimary}>Fin Setup</Label>
              <Select value={formData.fin_setup} onValueChange={(v) => setFormData(p => ({ ...p, fin_setup: v }))}>
                <SelectTrigger className={inputBg}>
                  <SelectValue placeholder="Select fins" />
                </SelectTrigger>
                <SelectContent className={selectBg}>
                  {FIN_SETUPS.map(f => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {/* Condition */}
          <div>
            <Label className={textPrimary}>Condition</Label>
            <Select value={formData.condition} onValueChange={(v) => setFormData(p => ({ ...p, condition: v }))}>
              <SelectTrigger className={inputBg}>
                <SelectValue placeholder="Select condition" />
              </SelectTrigger>
              <SelectContent className={selectBg}>
                {CONDITIONS.map(c => (
                  <SelectItem key={c.value} value={c.value}>
                    <span className={c.color}>{c.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Description */}
          <div>
            <Label className={textPrimary}>Notes / Description</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))}
              placeholder="Any notes about this board..."
              className={inputBg}
              rows={2}
            />
          </div>
          
          {/* Year */}
          <div>
            <Label className={textPrimary}>Year Acquired</Label>
            <Input
              type="number"
              min="1900"
              max={new Date().getFullYear() + 1}
              value={formData.year_acquired}
              onChange={(e) => setFormData(p => ({ ...p, year_acquired: e.target.value }))}
              placeholder="2024"
              className={`${inputBg} w-24`}
            />
          </div>
        </div>
        
        {/* Fixed Footer */}
        <DialogFooter className="p-4 pt-2 border-t border-border flex-shrink-0 gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1 sm:flex-none">Cancel</Button>
          <Button aria-label={isEditing ? 'Save Changes' : 'Add Board'}
            onClick={handleSubmit}
            disabled={loading || uploading}
            className="flex-1 sm:flex-none bg-gradient-to-r from-cyan-500 to-blue-600"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? 'Save Changes' : 'Add Board'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
