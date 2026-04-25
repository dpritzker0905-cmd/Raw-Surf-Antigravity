/**
 * PermissionDeniedModal — Full-screen overlay shown when camera/mic is blocked.
 *
 * iOS Safari permanently remembers denied permissions. This modal guides the
 * user through re-enabling them, with a deep-link to Settings on iOS.
 */

import React, { useCallback } from 'react';
import { Settings, X, Shield, ChevronRight, Camera, Mic, RefreshCw } from 'lucide-react';

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function PermissionDeniedModal({ onRetry, onDismiss }) {

  const handleOpenSettings = useCallback(() => {
    // iOS deep-link: opens the Settings app.
    // From Safari, this opens directly to the Safari settings section.
    window.location.href = 'app-settings:';
  }, []);

  const handleRetry = useCallback(async () => {
    // Attempt to re-request permissions — this will show the native prompt
    // if the user hasn't permanently denied yet, or if they've re-enabled
    // in Settings and returned to the app.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Success! Stop the test stream and let the caller retry
      stream.getTracks().forEach(t => t.stop());
      if (onRetry) onRetry();
    } catch (err) {
      // Still denied — the modal stays open
      console.warn('[PermissionDenied] Retry failed:', err.name);
    }
  }, [onRetry]);

  return (
    <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center px-6"
      style={{
        background: 'linear-gradient(135deg, #0a0e1a 0%, #1a0a0a 40%, #0a1628 100%)',
      }}
    >
      {/* Dismiss button */}
      <button
        onClick={onDismiss}
        className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white transition-colors"
        aria-label="Close"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Shield icon with pulse */}
      <div className="relative mb-6">
        <div className="absolute inset-0 w-24 h-24 rounded-full bg-red-500/10 animate-ping" style={{ animationDuration: '3s' }} />
        <div className="w-24 h-24 rounded-full bg-red-500/20 border-2 border-red-500/40 flex items-center justify-center">
          <Shield className="w-12 h-12 text-red-400" />
        </div>
      </div>

      {/* Title */}
      <h2 className="text-2xl font-bold text-white mb-2 text-center">
        Camera & Mic Blocked
      </h2>
      <p className="text-gray-400 text-center mb-8 max-w-sm">
        Raw Surf needs camera and microphone access for calls. Permissions were previously denied and must be re-enabled.
      </p>

      {/* Platform-specific instructions */}
      {isIOS ? (
        <div className="w-full max-w-sm space-y-3 mb-8">
          {/* Step 1 */}
          <button
            onClick={handleOpenSettings}
            className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-left group"
          >
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Settings className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm">1. Open Settings</p>
              <p className="text-gray-500 text-xs">Tap here to open your iPhone Settings</p>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-500 group-hover:text-white transition-colors flex-shrink-0" />
          </button>

          {/* Step 2 */}
          <div className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-lg">🧭</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm">2. Find Safari</p>
              <p className="text-gray-500 text-xs">Scroll down and tap "Apps" → "Safari"</p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <Camera className="w-5 h-5 text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm">3. Enable Camera & Mic</p>
              <p className="text-gray-500 text-xs">Set Camera & Microphone to <span className="text-green-400 font-bold">"Allow"</span></p>
            </div>
          </div>

          {/* Step 4 */}
          <div className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
              <RefreshCw className="w-5 h-5 text-yellow-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm">4. Come back & try again</p>
              <p className="text-gray-500 text-xs">Return to Raw Surf and tap the button below</p>
            </div>
          </div>
        </div>
      ) : (
        /* Desktop / Android instructions */
        <div className="w-full max-w-sm space-y-3 mb-8">
          <div className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-lg">🔒</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm">1. Click the lock icon</p>
              <p className="text-gray-500 text-xs">In your browser's address bar, click the 🔒 or ⓘ icon</p>
            </div>
          </div>

          <div className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <Mic className="w-5 h-5 text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm">2. Allow Camera & Microphone</p>
              <p className="text-gray-500 text-xs">Change both to <span className="text-green-400 font-bold">"Allow"</span></p>
            </div>
          </div>

          <div className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
              <RefreshCw className="w-5 h-5 text-yellow-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-medium text-sm">3. Reload & try again</p>
              <p className="text-gray-500 text-xs">Refresh the page, then try your call again</p>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="w-full max-w-sm space-y-3">
        {isIOS && (
          <button
            onClick={handleOpenSettings}
            className="w-full py-3.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-semibold text-base transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30"
          >
            <Settings className="w-5 h-5" />
            Open Settings
          </button>
        )}

        <button
          onClick={handleRetry}
          className="w-full py-3.5 rounded-xl bg-green-500 hover:bg-green-400 text-white font-semibold text-base transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-green-500/30"
        >
          <RefreshCw className="w-5 h-5" />
          Try Again
        </button>

        <button
          onClick={onDismiss}
          className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 font-medium text-sm transition-colors"
        >
          Maybe Later
        </button>
      </div>
    </div>
  );
}
