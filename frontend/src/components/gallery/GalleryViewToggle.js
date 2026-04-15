/**
 * GalleryViewToggle - Toggle between grid and list views
 * Extracted from GalleryPage.js for better organization
 */
import React from 'react';
import { Grid3X3, List, Folder } from 'lucide-react';

export const GalleryViewToggle = ({
  viewMode = 'grid',
  onViewChange,
  showFolders = false,
  onToggleFolders
}) => {
  return (
    <div className="flex items-center gap-1 bg-zinc-800 rounded-lg p-1">
      <button
        onClick={() => onViewChange('grid')}
        className={`p-2 rounded transition-colors ${
          viewMode === 'grid' 
            ? 'bg-zinc-700 text-white' 
            : 'text-gray-400 hover:text-white'
        }`}
        data-testid="view-grid"
      >
        <Grid3X3 className="w-4 h-4" />
      </button>
      <button
        onClick={() => onViewChange('list')}
        className={`p-2 rounded transition-colors ${
          viewMode === 'list' 
            ? 'bg-zinc-700 text-white' 
            : 'text-gray-400 hover:text-white'
        }`}
        data-testid="view-list"
      >
        <List className="w-4 h-4" />
      </button>
      {onToggleFolders && (
        <button
          onClick={onToggleFolders}
          className={`p-2 rounded transition-colors ${
            showFolders 
              ? 'bg-cyan-500/20 text-cyan-400' 
              : 'text-gray-400 hover:text-white'
          }`}
          data-testid="toggle-folders"
        >
          <Folder className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

export default GalleryViewToggle;
