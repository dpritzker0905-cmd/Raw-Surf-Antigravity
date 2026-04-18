/**
 * DownloadButton & VisibilityToggle - TICKET-008
 * Shows remaining downloads (X/5) and Lock vs Globe visibility icons
 */
import React from 'react';
import { Download, Lock, Globe, AlertCircle, Info } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/tooltip';

/**
 * Download button with remaining count display
 * Shows X/5 downloads remaining with color-coded warnings
 */
export const DownloadButton = ({
  item,
  onDownload,
  disabled = false,
  size = 'default',
  showLabel = true,
  className = ''
}) => {
  const maxDownloads = item.max_downloads || 5;
  const downloadCount = item.download_count || 0;
  const remaining = maxDownloads - downloadCount;
  
  // Determine urgency level
  const isLow = remaining <= 2 && remaining > 0;
  const isDepleted = remaining <= 0;
  
  // Color classes based on remaining
  const _countColorClass = isDepleted 
    ? 'text-red-400' 
    : isLow 
      ? 'text-amber-400' 
      : 'text-zinc-400';
  
  const _buttonSizeClass = size === 'sm' ? 'h-8 px-2 text-xs' : 'h-10 px-4 text-sm';
  
  if (isDepleted) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size={size}
              disabled
              className={`border-red-500/30 text-red-400 cursor-not-allowed ${className}`}
              data-testid="download-btn-depleted"
            >
              <AlertCircle className="w-4 h-4 mr-1" />
              {showLabel && 'No Downloads Left'}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="bg-zinc-800 border-zinc-700 max-w-[200px]">
            <p className="text-xs text-white">You've used all {maxDownloads} downloads for this item.</p>
            <p className="text-xs text-zinc-400 mt-1">Contact support if you need additional downloads.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isLow ? 'outline' : 'default'}
            size={size}
            onClick={() => onDownload?.(item)}
            disabled={disabled}
            className={`
              ${isLow 
                ? 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10' 
                : 'bg-cyan-500 hover:bg-cyan-600 text-white'
              }
              ${className}
            `}
            data-testid="download-btn"
          >
            <Download className="w-4 h-4 mr-1" />
            {showLabel && 'Download'}
            <Badge 
              className={`ml-2 ${
                isLow 
                  ? 'bg-amber-500/20 text-amber-400' 
                  : 'bg-white/20 text-white'
              } text-[10px]`}
            >
              {remaining}/{maxDownloads}
            </Badge>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="bg-zinc-800 border-zinc-700">
          <p className="text-xs text-white">
            {remaining} download{remaining !== 1 ? 's' : ''} remaining
          </p>
          {isLow && (
            <p className="text-xs text-amber-400 mt-1">
              Limited downloads remaining!
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/**
 * Compact download indicator for list/grid views
 */
export const DownloadIndicator = ({ item, className = '' }) => {
  const maxDownloads = item.max_downloads || 5;
  const downloadCount = item.download_count || 0;
  const remaining = maxDownloads - downloadCount;
  
  const isLow = remaining <= 2 && remaining > 0;
  const isDepleted = remaining <= 0;
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div 
            className={`
              inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium
              ${isDepleted 
                ? 'bg-red-500/20 text-red-400' 
                : isLow 
                  ? 'bg-amber-500/20 text-amber-400' 
                  : 'bg-zinc-700 text-zinc-300'
              }
              ${className}
            `}
            data-testid="download-indicator"
          >
            <Download className="w-3 h-3" />
            {remaining}/{maxDownloads}
          </div>
        </TooltipTrigger>
        <TooltipContent className="bg-zinc-800 border-zinc-700">
          <p className="text-xs">
            {isDepleted 
              ? 'No downloads remaining' 
              : `${remaining} download${remaining !== 1 ? 's' : ''} remaining`
            }
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

/**
 * Visibility toggle with Lock vs Globe icons
 * Shows clear visual distinction between private (Locker) and public (Sessions)
 */
export const VisibilityToggle = ({
  isPublic,
  onChange,
  disabled = false,
  showLabels = true,
  size = 'default',
  className = ''
}) => {
  const sizeClasses = {
    sm: 'h-8 px-2 text-xs gap-1',
    default: 'h-10 px-3 text-sm gap-2',
    lg: 'h-12 px-4 text-base gap-2'
  };
  
  const iconSizes = {
    sm: 'w-3.5 h-3.5',
    default: 'w-4 h-4',
    lg: 'w-5 h-5'
  };
  
  return (
    <div 
      className={`inline-flex rounded-lg border border-zinc-700 overflow-hidden ${className}`}
      data-testid="visibility-toggle"
    >
      {/* Private (Locker) option */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => !disabled && onChange?.(false)}
              disabled={disabled}
              className={`
                flex items-center ${sizeClasses[size]} transition-all
                ${!isPublic 
                  ? 'bg-cyan-500 text-white' 
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              data-testid="visibility-private"
            >
              <Lock className={iconSizes[size]} />
              {showLabels && <span>Locker</span>}
            </button>
          </TooltipTrigger>
          <TooltipContent className="bg-zinc-800 border-zinc-700 max-w-[180px]">
            <div className="flex items-start gap-2">
              <Lock className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-white">Private Locker</p>
                <p className="text-xs text-zinc-400 mt-0.5">Only you can see this photo</p>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      {/* Public (Sessions) option */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => !disabled && onChange?.(true)}
              disabled={disabled}
              className={`
                flex items-center ${sizeClasses[size]} transition-all
                ${isPublic 
                  ? 'bg-green-500 text-white' 
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              data-testid="visibility-public"
            >
              <Globe className={iconSizes[size]} />
              {showLabels && <span>Public</span>}
            </button>
          </TooltipTrigger>
          <TooltipContent className="bg-zinc-800 border-zinc-700 max-w-[180px]">
            <div className="flex items-start gap-2">
              <Globe className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-white">Public Sessions</p>
                <p className="text-xs text-zinc-400 mt-0.5">Visible on your Sessions tab for followers</p>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};

/**
 * First-time visibility onboarding tooltip
 */
export const VisibilityOnboarding = ({ onDismiss, className = '' }) => {
  return (
    <div 
      className={`p-4 rounded-lg bg-gradient-to-r from-cyan-500/10 to-green-500/10 border border-cyan-500/30 ${className}`}
      data-testid="visibility-onboarding"
    >
      <div className="flex items-start gap-3">
        <Info className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-white mb-2">
            Understanding Photo Visibility
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-cyan-500/20">
                <Lock className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div>
                <span className="text-xs font-medium text-cyan-400">Locker</span>
                <span className="text-xs text-zinc-400 ml-1">- Private, only you can see</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded bg-green-500/20">
                <Globe className="w-3.5 h-3.5 text-green-400" />
              </div>
              <div>
                <span className="text-xs font-medium text-green-400">Public</span>
                <span className="text-xs text-zinc-400 ml-1">- Shows on your Sessions tab</span>
              </div>
            </div>
          </div>
        </div>
        <button 
          onClick={onDismiss}
          className="text-xs text-cyan-400 hover:text-cyan-300 whitespace-nowrap"
        >
          Got it
        </button>
      </div>
    </div>
  );
};

export default DownloadButton;
