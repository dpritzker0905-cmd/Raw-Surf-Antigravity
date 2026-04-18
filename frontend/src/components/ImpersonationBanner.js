/**
 * ImpersonationBanner - Shows when admin is viewing as another user
 * 
 * Features:
 * - Fixed banner at top of screen
 * - Shows target user info
 * - Read-only mode indicator
 * - End impersonation button
 */
import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Eye, EyeOff, UserCircle, X, Shield, AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';
import { getFullUrl } from '../utils/media';

const ImpersonationBanner = () => {
  const { 
    impersonation, 
    originalUser, 
    endImpersonation, 
    isReadOnlyMode 
  } = useAuth();

  if (!impersonation || !originalUser) return null;

  const targetUser = impersonation.target_user;
  const isReadOnly = isReadOnlyMode();

  return (
    <div 
      className="fixed top-0 left-0 right-0 z-[100] bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 text-white shadow-lg"
      data-testid="impersonation-banner"
    >
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-4">
        {/* Left: Status icon and info */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white/20 rounded-full px-3 py-1">
            <Eye className="w-4 h-4" />
            <span className="text-sm font-medium">Admin View</span>
          </div>
          
          <div className="flex items-center gap-2">
            {targetUser.avatar_url ? (
              <img 
                src={getFullUrl(targetUser.avatar_url)} 
                alt="" 
                className="w-8 h-8 rounded-full border-2 border-white/50"
              />
            ) : (
              <UserCircle className="w-8 h-8" />
            )}
            <div className="hidden sm:block">
              <p className="text-sm font-semibold leading-tight">{targetUser.full_name || targetUser.email}</p>
              <p className="text-xs opacity-80">{targetUser.role} • {targetUser.email}</p>
            </div>
          </div>
        </div>

        {/* Center: Mode indicator */}
        <div className="hidden md:flex items-center gap-2">
          {isReadOnly ? (
            <div className="flex items-center gap-1.5 bg-white/20 rounded-full px-3 py-1">
              <EyeOff className="w-4 h-4" />
              <span className="text-xs font-medium">Read-Only Mode</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-red-600/50 rounded-full px-3 py-1">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-medium">Full Access Mode</span>
            </div>
          )}
          
          <div className="flex items-center gap-1.5 bg-white/10 rounded-full px-3 py-1">
            <Shield className="w-4 h-4" />
            <span className="text-xs">Admin: {originalUser.full_name || originalUser.email}</span>
          </div>
        </div>

        {/* Right: End button */}
        <Button
          onClick={endImpersonation}
          size="sm"
          className="bg-white text-orange-600 hover:bg-white/90 font-semibold"
          data-testid="end-impersonation-btn"
        >
          <X className="w-4 h-4 mr-1" />
          End Session
        </Button>
      </div>
      
      {/* Read-only warning bar */}
      {isReadOnly && (
        <div className="bg-black/20 text-center py-1 text-xs">
          Actions are disabled in read-only mode. You can only view the app as this user.
        </div>
      )}
    </div>
  );
};

export default ImpersonationBanner;
