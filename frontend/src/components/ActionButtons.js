import React from 'react';
import { Edit3, Trash2, Download, Share2, Eye, ShoppingCart, Plus, Loader2, UserPlus } from 'lucide-react';
import { Button } from './ui/button';

/**
 * ActionButtons - Reusable action button components
 * Extracted from GalleryPage.js and Bookings.js monoliths
 * 
 * Supports: Edit, Delete, Download, Share, View, Purchase, Add, TagGrom
 */

export const EditButton = ({ onClick, disabled = false, loading = false, size = 'sm', variant = 'outline' }) => (
  <Button
    onClick={onClick}
    disabled={disabled || loading}
    variant={variant}
    size={size}
    className="border-white/50 text-white hover:bg-white/20"
  >
    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4 mr-1" />}
    {!loading && 'Edit'}
  </Button>
);

export const DeleteButton = ({ onClick, disabled = false, loading = false, size = 'sm', showText = true }) => (
  <Button
    onClick={onClick}
    disabled={disabled || loading}
    variant="destructive"
    size={size}
    className="bg-red-500 hover:bg-red-600"
  >
    {loading ? (
      <Loader2 className="w-4 h-4 animate-spin" />
    ) : (
      <>
        <Trash2 className="w-4 h-4" />
        {showText && <span className="ml-1">Delete</span>}
      </>
    )}
  </Button>
);

export const DownloadButton = ({ onClick, disabled = false, loading = false, size = 'sm', variant = 'outline' }) => (
  <Button
    onClick={onClick}
    disabled={disabled || loading}
    variant={variant}
    size={size}
    className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/20"
  >
    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Download className="w-4 h-4 mr-1" />}
    Download
  </Button>
);

export const ShareButton = ({ onClick, disabled = false, size = 'sm', variant = 'outline' }) => (
  <Button
    onClick={onClick}
    disabled={disabled}
    variant={variant}
    size={size}
  >
    <Share2 className="w-4 h-4 mr-1" />
    Share
  </Button>
);

export const ViewButton = ({ onClick, disabled = false, size = 'sm', variant = 'outline' }) => (
  <Button
    onClick={onClick}
    disabled={disabled}
    variant={variant}
    size={size}
    className="border-white/50 text-white hover:bg-white/20"
  >
    <Eye className="w-4 h-4 mr-1" />
    View
  </Button>
);

export const PurchaseButton = ({ 
  onClick, 
  disabled = false, 
  loading = false, 
  price, 
  size = 'sm',
  fullWidth = false 
}) => (
  <Button
    onClick={onClick}
    disabled={disabled || loading}
    size={size}
    className={`bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold hover:from-yellow-300 hover:to-orange-300 ${fullWidth ? 'w-full' : ''}`}
  >
    {loading ? (
      <Loader2 className="w-4 h-4 animate-spin mr-1" />
    ) : (
      <ShoppingCart className="w-4 h-4 mr-1" />
    )}
    {price ? `Buy $${price}` : 'Purchase'}
  </Button>
);

export const AddButton = ({ onClick, disabled = false, size = 'sm', variant = 'outline', children }) => (
  <Button
    onClick={onClick}
    disabled={disabled}
    variant={variant}
    size={size}
  >
    <Plus className="w-4 h-4 mr-1" />
    {children || 'Add'}
  </Button>
);

export const TagGromButton = ({ onClick, disabled = false, loading = false, size = 'sm' }) => (
  <Button
    onClick={onClick}
    disabled={disabled || loading}
    size={size}
    className="bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:from-cyan-400 hover:to-blue-400"
  >
    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <UserPlus className="w-4 h-4 mr-1" />}
    Tag Grom
  </Button>
);

/**
 * ActionButtonGroup - Pre-composed button groups for common scenarios
 */

export const MediaActionButtons = ({ 
  onEdit, 
  onDelete, 
  onDownload,
  showEdit = true,
  showDelete = true,
  showDownload = false,
  isDeleting = false,
  isDownloading = false 
}) => (
  <div className="flex items-center gap-2">
    {showEdit && onEdit && <EditButton onClick={onEdit} />}
    {showDownload && onDownload && <DownloadButton onClick={onDownload} loading={isDownloading} />}
    {showDelete && onDelete && <DeleteButton onClick={onDelete} loading={isDeleting} showText={false} />}
  </div>
);

export const PurchaseActionButtons = ({ 
  onPurchase, 
  onPreview,
  price,
  isPurchased = false,
  isPurchasing = false 
}) => (
  <div className="flex items-center gap-2">
    {onPreview && <ViewButton onClick={onPreview} />}
    {!isPurchased && onPurchase && (
      <PurchaseButton onClick={onPurchase} price={price} loading={isPurchasing} />
    )}
  </div>
);

export default {
  EditButton,
  DeleteButton,
  DownloadButton,
  ShareButton,
  ViewButton,
  PurchaseButton,
  AddButton,
  TagGromButton,
  MediaActionButtons,
  PurchaseActionButtons
};
