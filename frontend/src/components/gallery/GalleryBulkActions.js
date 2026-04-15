/**
 * GalleryBulkActions - Bulk action toolbar for gallery items
 * Extracted from GalleryPage.js for better organization
 */
import React from 'react';
import { Check, X, Folder, Copy, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';

export const GalleryBulkActions = ({
  selectedCount,
  onMove,
  onCopy,
  onDelete,
  onCancel,
  isLoading = false
}) => {
  if (selectedCount === 0) return null;

  return (
    <div 
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 md:bottom-4"
      data-testid="bulk-actions-toolbar"
    >
      <div className="flex items-center gap-2 px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-full shadow-xl">
        <span className="text-sm text-gray-300 mr-2">
          <Check className="w-4 h-4 inline mr-1 text-cyan-400" />
          {selectedCount} selected
        </span>
        
        <div className="h-4 w-px bg-zinc-700" />
        
        <Button
          size="sm"
          variant="ghost"
          onClick={onMove}
          disabled={isLoading}
          className="text-white hover:bg-zinc-800"
        >
          <Folder className="w-4 h-4 mr-1" />
          Move
        </Button>
        
        <Button
          size="sm"
          variant="ghost"
          onClick={onCopy}
          disabled={isLoading}
          className="text-white hover:bg-zinc-800"
        >
          <Copy className="w-4 h-4 mr-1" />
          Copy
        </Button>
        
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          disabled={isLoading}
          className="text-red-400 hover:bg-red-900/30"
        >
          <Trash2 className="w-4 h-4 mr-1" />
          Delete
        </Button>
        
        <div className="h-4 w-px bg-zinc-700" />
        
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className="text-gray-400 hover:text-white"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

export default GalleryBulkActions;
