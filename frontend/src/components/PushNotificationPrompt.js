/**
 * PushNotificationPrompt.js - Contextual push notification opt-in banner.
 *
 * Shows a beautiful, non-intrusive slide-up prompt asking users to enable
 * push notifications. Appears contextually (not on page load) after the
 * user has been active for a few moments, and only if:
 *   1. Push is supported in their browser
 *   2. They haven't already granted or denied permission
 *   3. They haven't dismissed the prompt before
 *
 * Uses the existing usePushNotifications hook for subscription logic.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Bell, X, Camera, Waves } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { toast } from 'sonner';

var DISMISS_KEY = 'rs-push-prompt-dismissed';
var DISMISS_EXPIRY = 7 * 24 * 60 * 60 * 1000; // Re-show after 7 days if not subscribed

var PushNotificationPrompt = () => {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { isSupported, isSubscribed, permission, subscribe } = usePushNotifications(user?.id);
  const [visible, setVisible] = useState(false);
  const [animatingOut, setAnimatingOut] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  const isLight = theme === 'light';

  // Determine if prompt should show
  useEffect(() => {
    if (!user?.id || !isSupported) return;
    if (isSubscribed) return;
    if (permission === 'denied') return;
    if (permission === 'granted') return; // Already granted, PushNotificationInit handles it

    // Check localStorage for dismissal
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt) {
      const elapsed = Date.now() - parseInt(dismissedAt, 10);
      if (elapsed < DISMISS_EXPIRY) return; // Still within cool-off period
    }

    // Delay showing - don't show immediately on load.
    // Wait until the user has been active for a few seconds.
    const timer = setTimeout(() => {
      setVisible(true);
    }, 4000); // 4 second delay - user has settled into the page

    return () => clearTimeout(timer);
  }, [user?.id, isSupported, isSubscribed, permission]);

  const dismiss = useCallback(() => {
    setAnimatingOut(true);
    localStorage.setItem(DISMISS_KEY, Date.now().toString());
    setTimeout(() => setVisible(false), 300);
  }, []);

  const handleEnable = useCallback(async () => {
    setSubscribing(true);
    const success = await subscribe();
    setSubscribing(false);
    if (success) {
      toast.success('Push notifications enabled! \uD83D\uDD14\uD83C\uDF0A');
    } else {
      // If denied, dismiss permanently (can't ask again)
      if (Notification.permission === 'denied') {
        toast.error('Notifications blocked. You can enable them in your browser settings.');
      }
    }
    dismiss();
  }, [subscribe, dismiss]);

  if (!visible) return null;

  return (
    <div
      className={`fixed bottom-24 left-4 right-4 z-50 md:left-auto md:right-6 md:bottom-6 md:max-w-sm transition-all duration-300 ${
        animatingOut ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'
      }`}
      style={{ animation: animatingOut ? 'none' : 'slideUpBounce 0.5s ease-out', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      role="dialog"
      aria-label="Enable push notifications"
    >
      <div
        className={`relative overflow-hidden rounded-2xl shadow-2xl border backdrop-blur-xl ${
          isLight
            ? 'bg-white/95 border-gray-200/80 shadow-gray-200/50'
            : 'bg-zinc-900/95 border-zinc-700/50 shadow-black/40'
        }`}
      >
        {/* Gradient accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500" />

        {/* Close button */}
        <button
          onClick={dismiss}
          className={`absolute top-3 right-3 p-1 rounded-full transition-colors ${
            isLight ? 'hover:bg-gray-100 text-gray-400' : 'hover:bg-zinc-800 text-zinc-500'
          }`}
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-4 pt-5">
          {/* Icon row */}
          <div className="flex items-center gap-3 mb-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                <Bell className="w-5 h-5 text-white" />
              </div>
              {/* Ping indicator */}
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full border-2 border-white dark:border-zinc-900 animate-pulse" />
            </div>
            <div>
              <h3 className={`text-sm font-semibold ${isLight ? 'text-gray-900' : 'text-white'}`}>
                Never miss your shots
              </h3>
              <p className={`text-xs ${isLight ? 'text-gray-500' : 'text-zinc-400'}`}>
                Stay in the loop
              </p>
            </div>
          </div>

          {/* Value props */}
          <div className="space-y-1.5 mb-4">
            <div className="flex items-center gap-2">
              <Camera className={`w-3.5 h-3.5 flex-shrink-0 ${isLight ? 'text-cyan-600' : 'text-cyan-400'}`} />
              <p className={`text-xs ${isLight ? 'text-gray-600' : 'text-zinc-300'}`}>
                Get notified when your session photos are ready
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Waves className={`w-3.5 h-3.5 flex-shrink-0 ${isLight ? 'text-blue-600' : 'text-blue-400'}`} />
              <p className={`text-xs ${isLight ? 'text-gray-600' : 'text-zinc-300'}`}>
                Swell alerts, booking updates & messages
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={dismiss}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-xl transition-colors ${
                isLight
                  ? 'text-gray-600 hover:bg-gray-100'
                  : 'text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              Not now
            </button>
            <button aria-label="span"
              onClick={handleEnable}
              disabled={subscribing}
              className="flex-[2] px-4 py-2 text-xs font-bold rounded-xl text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-lg shadow-cyan-500/25 transition-all active:scale-[0.97] disabled:opacity-70 flex items-center justify-center gap-1.5"
            >
              {subscribing ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Enabling...
                </>
              ) : (
                <>
                  <Bell className="w-3.5 h-3.5" />
                  Enable Notifications
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Keyframe animation (injected inline for portability) */}
      <style>{`
        @keyframes slideUpBounce {
          0% { transform: translateY(100%); opacity: 0; }
          60% { transform: translateY(-4%); opacity: 1; }
          80% { transform: translateY(2%); }
          100% { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default PushNotificationPrompt;
