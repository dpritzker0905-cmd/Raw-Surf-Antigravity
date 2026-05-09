import React, { useState, useEffect } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import apiClient from '../../lib/apiClient';
import { Edit2, Trash2, X, Loader2, ChevronLeft, ChevronRight, Ruler, Calendar, Waves } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { toast } from 'sonner';
import { BOARD_TYPES, FIN_SETUPS, CONDITIONS } from './constants';

export const SurfboardDetailModal = ({ isOpen, onClose, board, onEdit, onDelete, isOwnProfile, userId }) => {
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
      await apiClient.delete(`/surfboards/${board.id}`);
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
            <img loading="lazy" decoding="async" 
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
              <button aria-label="Previous"
                onClick={() => setCurrentPhotoIndex(i => (i - 1 + photos.length) % photos.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button aria-label="Next"
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
          <button aria-label="Close"
            onClick={onClose}
            className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center"
          ><X className="w-5 h-5" />
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
              <Button aria-label="Edit"
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
                  <Button aria-label="Loader2"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="bg-red-500 hover:bg-red-600"
                    size="sm"
                  >
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                  </Button>
                </div>
              ) : (
                <Button aria-label="Delete"
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
