/**
 * SurfboardsTab - Display and manage user's surfboard quiver
 * Features:
 * - Grid display of surfboards with photos
 * - Add/Edit surfboard modal
 * - Photo upload (up to 5 per board)
 * - Dimensions, brand, condition tracking
 * - Future: Marketplace listing integration
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import axios from 'axios';
import {
  Plus, Camera, Edit2, Trash2, X, Loader2, ChevronLeft, ChevronRight,
  Ruler, Tag, Info, DollarSign, Calendar, Waves
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { toast } from 'sonner';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Board type options
const BOARD_TYPES = [
  { value: 'shortboard', label: 'Shortboard' },
  { value: 'longboard', label: 'Longboard' },
  { value: 'funboard', label: 'Funboard' },
  { value: 'fish', label: 'Fish' },
  { value: 'gun', label: 'Gun' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'mini_mal', label: 'Mini Mal' },
  { value: 'foamie', label: 'Soft Top / Foamie' },
  { value: 'sup', label: 'SUP' },
  { value: 'other', label: 'Other' }
];

// Fin setup options
const FIN_SETUPS = [
  { value: 'thruster', label: 'Thruster (3 fin)' },
  { value: 'quad', label: 'Quad (4 fin)' },
  { value: 'twin', label: 'Twin Fin' },
  { value: 'single', label: 'Single Fin' },
  { value: '2_plus_1', label: '2+1' },
  { value: 'five', label: '5 Fin' },
  { value: 'finless', label: 'Finless' }
];

// Condition options
const CONDITIONS = [
  { value: 'mint', label: 'Mint', color: 'text-green-400' },
  { value: 'excellent', label: 'Excellent', color: 'text-cyan-400' },
  { value: 'good', label: 'Good', color: 'text-blue-400' },
  { value: 'fair', label: 'Fair', color: 'text-yellow-400' },
  { value: 'needs_repair', label: 'Needs Repair', color: 'text-red-400' }
];

// Surfboard Card Component
const SurfboardCard = ({ board, onClick, isLight }) => {
  const primaryPhoto = board.photo_urls?.[board.primary_photo_index || 0];
  const conditionInfo = CONDITIONS.find(c => c.value === board.condition);
  
  return (
    <div 
      onClick={onClick}
      className={`relative aspect-[3/4] rounded-xl overflow-hidden cursor-pointer group transition-all hover:scale-[1.02] ${
        isLight ? 'bg-gray-100' : 'bg-zinc-800'
      }`}
    >
      {primaryPhoto ? (
        <img 
          src={primaryPhoto} 
          alt={board.name || 'Surfboard'} 
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Waves className={`w-12 h-12 ${isLight ? 'text-gray-300' : 'text-zinc-600'}`} />
        </div>
      )}
      
      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      
      {/* Info overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform">
        <p className="text-white font-medium text-sm truncate">
          {board.brand || 'Unknown'} {board.model || ''}
        </p>
        {board.dimensions_display && (
          <p className="text-gray-300 text-xs">{board.dimensions_display}</p>
        )}
        {conditionInfo && (
          <Badge className={`mt-1 ${conditionInfo.color} bg-black/50 text-xs`}>
            {conditionInfo.label}
          </Badge>
        )}
      </div>
      
      {/* Photo count badge */}
      {board.photo_urls?.length > 1 && (
        <div className="absolute top-2 right-2 bg-black/60 px-2 py-0.5 rounded-full">
          <span className="text-white text-xs">{board.photo_urls.length}</span>
        </div>
      )}
    </div>
  );
};

// Add/Edit Surfboard Modal
const SurfboardModal = ({ isOpen, onClose, board, onSave, userId }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
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
        
        const response = await axios.post(`${API}/uploads/image`, uploadFormData, {
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
  
  const handleSubmit = async () => {
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
        await axios.patch(`${API}/surfboards/${board.id}?user_id=${userId}`, payload);
        toast.success('Surfboard updated!');
      } else {
        await axios.post(`${API}/surfboards/?user_id=${userId}`, payload);
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
  
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const inputBg = isLight ? 'bg-white border-gray-300' : 'bg-zinc-800 border-zinc-700';
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border-zinc-800 max-w-lg p-0 flex flex-col`}>
        {/* Fixed Header */}
        <DialogHeader className="p-4 pb-2 border-b border-zinc-800 flex-shrink-0">
          <DialogTitle className={`text-xl font-bold ${textPrimary} flex items-center gap-2`}>
            <Waves className="w-5 h-5 text-cyan-400" />
            {isEditing ? 'Edit Surfboard' : 'Add to Quiver'}
          </DialogTitle>
        </DialogHeader>
        
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {/* Photo Upload Section */}
          <div>
            <Label className={textPrimary}>Photos (up to 5)</Label>
            <div className="grid grid-cols-5 gap-2 mt-2">
              {formData.photo_urls.map((url, idx) => (
                <div key={idx} className="relative aspect-square rounded-lg overflow-hidden group">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => handleRemovePhoto(idx)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {formData.photo_urls.length < 5 && (
                <label className={`aspect-square rounded-lg border-2 border-dashed ${isLight ? 'border-gray-300 hover:border-cyan-400' : 'border-zinc-700 hover:border-cyan-500'} flex items-center justify-center cursor-pointer transition-colors`}>
                  {uploading ? (
                    <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                  ) : (
                    <Plus className={`w-6 h-6 ${isLight ? 'text-gray-400' : 'text-zinc-500'}`} />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePhotoUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                </label>
              )}
            </div>
          </div>
          
          {/* Brand & Model */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={textPrimary}>Brand / Shaper</Label>
              <Input
                value={formData.brand}
                onChange={(e) => setFormData(p => ({ ...p, brand: e.target.value }))}
                placeholder="e.g. Channel Islands"
                className={inputBg}
              />
            </div>
            <div>
              <Label className={textPrimary}>Model</Label>
              <Input
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
                  value={formData.length_feet}
                  onChange={(e) => setFormData(p => ({ ...p, length_feet: e.target.value }))}
                  placeholder="5"
                  className={inputBg}
                />
                <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} text-center mt-1`}>ft</p>
              </div>
              <div className="col-span-1">
                <Input
                  type="number"
                  value={formData.length_inches}
                  onChange={(e) => setFormData(p => ({ ...p, length_inches: e.target.value }))}
                  placeholder="10"
                  className={inputBg}
                />
                <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} text-center mt-1`}>in</p>
              </div>
              <div className="col-span-1">
                <Input
                  type="number"
                  step="0.25"
                  value={formData.width_inches}
                  onChange={(e) => setFormData(p => ({ ...p, width_inches: e.target.value }))}
                  placeholder="19.5"
                  className={inputBg}
                />
                <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} text-center mt-1`}>width</p>
              </div>
              <div className="col-span-1">
                <Input
                  type="number"
                  step="0.125"
                  value={formData.thickness_inches}
                  onChange={(e) => setFormData(p => ({ ...p, thickness_inches: e.target.value }))}
                  placeholder="2.5"
                  className={inputBg}
                />
                <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} text-center mt-1`}>thick</p>
              </div>
              <div className="col-span-1">
                <Input
                  type="number"
                  step="0.1"
                  value={formData.volume_liters}
                  onChange={(e) => setFormData(p => ({ ...p, volume_liters: e.target.value }))}
                  placeholder="28.5"
                  className={inputBg}
                />
                <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-gray-400'} text-center mt-1`}>liters</p>
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
                <SelectContent className={isLight ? 'bg-white' : 'bg-zinc-900'}>
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
                <SelectContent className={isLight ? 'bg-white' : 'bg-zinc-900'}>
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
              <SelectContent className={isLight ? 'bg-white' : 'bg-zinc-900'}>
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
              value={formData.year_acquired}
              onChange={(e) => setFormData(p => ({ ...p, year_acquired: e.target.value }))}
              placeholder="2024"
              className={`${inputBg} w-24`}
            />
          </div>
        </div>
        
        {/* Fixed Footer */}
        <DialogFooter className="p-4 pt-2 border-t border-zinc-800 flex-shrink-0 gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1 sm:flex-none">Cancel</Button>
          <Button 
            onClick={handleSubmit}
            disabled={loading}
            className="flex-1 sm:flex-none bg-gradient-to-r from-cyan-500 to-blue-600"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : isEditing ? 'Save Changes' : 'Add Board'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// View Surfboard Detail Modal
const SurfboardDetailModal = ({ isOpen, onClose, board, onEdit, onDelete, isOwnProfile, userId }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  
  useEffect(() => {
    if (isOpen) {
      setCurrentPhotoIndex(board?.primary_photo_index || 0);
      setDeleteConfirm(false);
    }
  }, [isOpen, board]);
  
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await axios.delete(`${API}/surfboards/${board.id}?user_id=${userId}`);
      toast.success('Surfboard removed from quiver');
      onDelete();
      onClose();
    } catch (error) {
      toast.error('Failed to delete surfboard');
    } finally {
      setDeleting(false);
    }
  };
  
  const photos = board?.photo_urls || [];
  const conditionInfo = CONDITIONS.find(c => c.value === board?.condition);
  const boardTypeInfo = BOARD_TYPES.find(t => t.value === board?.board_type);
  const finInfo = FIN_SETUPS.find(f => f.value === board?.fin_setup);
  
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${isLight ? 'bg-white' : 'bg-zinc-900'} border-zinc-800 max-w-lg p-0 overflow-hidden`}>
        <DialogTitle className="sr-only">Surfboard Detail</DialogTitle>
        {/* Photo Gallery */}
        <div className="relative aspect-[4/3] bg-black">
          {photos.length > 0 ? (
            <img 
              src={photos[currentPhotoIndex]} 
              alt="" 
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Waves className="w-16 h-16 text-zinc-700" />
            </div>
          )}
          
          {/* Photo Navigation */}
          {photos.length > 1 && (
            <>
              <button
                onClick={() => setCurrentPhotoIndex(i => (i - 1 + photos.length) % photos.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => setCurrentPhotoIndex(i => (i + 1) % photos.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {photos.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentPhotoIndex(idx)}
                    className={`w-2 h-2 rounded-full ${currentPhotoIndex === idx ? 'bg-white' : 'bg-white/50'}`}
                  />
                ))}
              </div>
            </>
          )}
          
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Board Info */}
        <div className="p-4 space-y-4">
          {/* Header */}
          <div>
            <h3 className={`text-xl font-bold ${textPrimary}`}>
              {board?.brand || 'Unknown Brand'} {board?.model || ''}
            </h3>
            {board?.dimensions_display && (
              <p className={`${textSecondary} flex items-center gap-1`}>
                <Ruler className="w-4 h-4" />
                {board.dimensions_display}
              </p>
            )}
          </div>
          
          {/* Tags */}
          <div className="flex flex-wrap gap-2">
            {boardTypeInfo && (
              <Badge className="bg-cyan-500/20 text-cyan-400">{boardTypeInfo.label}</Badge>
            )}
            {finInfo && (
              <Badge className="bg-purple-500/20 text-purple-400">{finInfo.label}</Badge>
            )}
            {conditionInfo && (
              <Badge className={`bg-zinc-800 ${conditionInfo.color}`}>{conditionInfo.label}</Badge>
            )}
            {board?.year_acquired && (
              <Badge className="bg-zinc-800 text-gray-400">
                <Calendar className="w-3 h-3 mr-1" />
                {board.year_acquired}
              </Badge>
            )}
          </div>
          
          {/* Description */}
          {board?.description && (
            <p className={`text-sm ${textSecondary}`}>{board.description}</p>
          )}
          
          {/* Actions */}
          {isOwnProfile && (
            <div className="flex gap-2 pt-2 border-t border-zinc-800">
              <Button
                variant="outline"
                onClick={() => {
                  onClose();
                  onEdit(board);
                }}
                className="flex-1"
              >
                <Edit2 className="w-4 h-4 mr-2" />
                Edit
              </Button>
              {deleteConfirm ? (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setDeleteConfirm(false)}
                    size="sm"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="bg-red-500 hover:bg-red-600"
                    size="sm"
                  >
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setDeleteConfirm(true)}
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Main SurfboardsTab Component
export const SurfboardsTab = ({ userId, isOwnProfile }) => {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState(null);
  const [editingBoard, setEditingBoard] = useState(null);
  
  const fetchBoards = async () => {
    try {
      const response = await axios.get(`${API}/surfboards/user/${userId}`);
      setBoards(response.data.boards || []);
    } catch (error) {
      logger.error('Error fetching surfboards:', error);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    if (userId) {
      fetchBoards();
    }
  }, [userId]);
  
  const handleBoardClick = (board) => {
    setSelectedBoard(board);
    setShowDetailModal(true);
  };
  
  const handleEdit = (board) => {
    setEditingBoard(board);
    setShowAddModal(true);
  };
  
  const textPrimary = isLight ? 'text-gray-900' : 'text-white';
  const textSecondary = isLight ? 'text-gray-500' : 'text-gray-400';
  
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }
  
  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className={`font-bold ${textPrimary}`}>
            {isOwnProfile ? 'My Quiver' : 'Quiver'}
          </h3>
          <p className={`text-sm ${textSecondary}`}>
            {boards.length} board{boards.length !== 1 ? 's' : ''}
          </p>
        </div>
        {isOwnProfile && (
          <Button
            onClick={() => {
              setEditingBoard(null);
              setShowAddModal(true);
            }}
            size="sm"
            className="bg-gradient-to-r from-cyan-500 to-blue-600"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Board
          </Button>
        )}
      </div>
      
      {/* Grid */}
      {boards.length === 0 ? (
        <div className="text-center py-12">
          <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${isLight ? 'bg-gray-100' : 'bg-zinc-800'} flex items-center justify-center`}>
            <Waves className={`w-8 h-8 ${isLight ? 'text-gray-400' : 'text-gray-500'}`} />
          </div>
          <h4 className={`font-semibold ${textPrimary} mb-1`}>No Boards Yet</h4>
          <p className={`text-sm ${textSecondary} mb-4`}>
            {isOwnProfile 
              ? 'Add your surfboards to build your quiver' 
              : 'No surfboards in this quiver yet'}
          </p>
          {isOwnProfile && (
            <Button
              onClick={() => {
                setEditingBoard(null);
                setShowAddModal(true);
              }}
              className="bg-gradient-to-r from-cyan-500 to-blue-600"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Board
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {boards.map((board) => (
            <SurfboardCard
              key={board.id}
              board={board}
              onClick={() => handleBoardClick(board)}
              isLight={isLight}
            />
          ))}
          {/* Add board placeholder */}
          {isOwnProfile && (
            <div
              onClick={() => {
                setEditingBoard(null);
                setShowAddModal(true);
              }}
              className={`aspect-[3/4] rounded-xl border-2 border-dashed ${
                isLight ? 'border-gray-300 hover:border-cyan-400' : 'border-zinc-700 hover:border-cyan-500'
              } flex flex-col items-center justify-center cursor-pointer transition-colors`}
            >
              <Plus className={`w-8 h-8 ${isLight ? 'text-gray-400' : 'text-zinc-500'} mb-2`} />
              <span className={`text-sm ${textSecondary}`}>Add Board</span>
            </div>
          )}
        </div>
      )}
      
      {/* Modals */}
      <SurfboardModal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setEditingBoard(null);
        }}
        board={editingBoard}
        onSave={fetchBoards}
        userId={userId}
      />
      
      <SurfboardDetailModal
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedBoard(null);
        }}
        board={selectedBoard}
        onEdit={handleEdit}
        onDelete={fetchBoards}
        isOwnProfile={isOwnProfile}
        userId={userId}
      />
    </div>
  );
};

export default SurfboardsTab;
