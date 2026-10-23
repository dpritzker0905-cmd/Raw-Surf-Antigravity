import { useState, useEffect, useCallback } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';

// Which accounts opted in to push ON THIS BROWSER (written only by a successful subscribe, which needs an Enable click).
// The browser's notification permission is per origin, not per account, and the backend keys subscriptions by
// (user, endpoint): PushNotificationInit used to subscribe whoever signed in on a browser where anyone had said yes.
const optInKey = (userId) => `rs-push-optin-${userId}`;
export const hasPushOptIn = (userId) => {
  try { return !!userId && localStorage.getItem(optInKey(userId)) === '1'; } catch (e) { return false; }
};
export const recordPushOptIn = (userId) => {
  try { if (userId) localStorage.setItem(optInKey(userId), '1'); } catch (e) { /* storage unavailable */ }
};
export const clearPushOptIn = (userId) => {
  try { if (userId) localStorage.removeItem(optInKey(userId)); } catch (e) { /* storage unavailable */ }
};

/** This browser's web-push endpoint (the device id the backend keys rows by), or null when it has none. */
export const getThisDeviceEndpoint = async (registration = null) => {
  try {
    const reg = registration
      || (typeof navigator !== 'undefined' && navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
    const subscription = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    return (subscription && subscription.endpoint) || null;
  } catch (e) {
    return null;
  }
};

/**
 * Logout: delete the LEAVING account's push row for this device, so its pushes stop arriving here (a shared browser
 * keeps its endpoint for whoever signs in next). Its token is passed in because logout clears the stored session
 * before this async call is sent. Its opt-in record stays: signing back in re-syncs it. Never throws.
 */
export const forgetThisDeviceForAccount = async (accessToken) => {
  if (!accessToken) return false;
  const endpoint = await getThisDeviceEndpoint();
  if (!endpoint) return false;
  try {
    await apiClient.delete(`/push/unsubscribe?endpoint=${encodeURIComponent(endpoint)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return true;
  } catch (e) {
    logger.debug('[Push] Logout could not remove this device for the account:', e);
    return false;
  }
};

/** `checkServer`: also ask the backend whether this account gets push on this device (Settings' switch). */
export const usePushNotifications = (userId, { checkServer = false } = {}) => {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState('default');
  const [registration, setRegistration] = useState(null);
  const [error, setError] = useState(null);
  const [serverSubscribed, setServerSubscribed] = useState(null);   // null = unknown or not asked
  const [serverStatusError, setServerStatusError] = useState(false);

  // Check if push notifications are supported
  useEffect(() => {
    const checkSupport = async () => {
      const supported = 'serviceWorker' in navigator && 
                       'PushManager' in window && 
                       'Notification' in window;
      
      setIsSupported(supported);
      
      if (supported) {
        setPermission(Notification.permission);

        // DEV GUARD (mirrors index.js `1dba14ce`): NEVER register the service worker on localhost.
        // This was the SECOND registration path that re-installed the SW after index.js unregistered
        // it — a resident SW silently pins an old build and serves stale JS across reloads (a whole
        // marine-render session was lost to that). Push notifications are a production capability;
        // on localhost we report unsupported and skip registration entirely.
        const _host = window.location.hostname;
        const _isLocalhost = _host === 'localhost' || _host === '127.0.0.1' || _host === '0.0.0.0' || _host === '[::1]';
        if (_isLocalhost) {
          logger.debug('[Push] Localhost — service worker registration skipped (dev always serves fresh code).');
          setIsSupported(false);
          return;
        }

        // Register service worker
        try {
          const reg = await navigator.serviceWorker.register('/service-worker.js');
          setRegistration(reg);
          logger.debug('[Push] Service worker registered:', reg);

          // Check existing subscription
          const subscription = await reg.pushManager.getSubscription();
          setIsSubscribed(!!subscription);
        } catch (err) {
          logger.error('[Push] Service worker registration failed:', err);
          setError('Failed to register service worker');
        }
      }
    };

    checkSupport();
  }, []);

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    if (!isSupported || !registration || !userId) {
      setError('Push notifications not available');
      return false;
    }

    try {
      // Request permission
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);
      
      if (permissionResult !== 'granted') {
        setError('Notification permission denied');
        return false;
      }

      // Get VAPID public key from server
      const vapidResponse = await apiClient.get(`/push/vapid-key`);
      const vapidPublicKey = vapidResponse.data.public_key;

      // Convert VAPID key to Uint8Array
      const urlBase64ToUint8Array = (base64String) => {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
          .replace(/-/g, '+')
          .replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
          outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
      };

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

      // Send subscription to server
      const subJson = subscription.toJSON();
      await apiClient.post(`/push/subscribe?user_id=${encodeURIComponent(userId)}`, {
        endpoint: subJson.endpoint,
        p256dh_key: subJson.keys?.p256dh || '',
        auth_key: subJson.keys?.auth || '',
        user_agent: navigator.userAgent
      });

      setIsSubscribed(true);
      setServerSubscribed(true);
      setError(null);
      recordPushOptIn(userId);
      logger.debug('[Push] Successfully subscribed');
      return true;
    } catch (err) {
      logger.error('[Push] Subscription failed:', err);
      setError(err.message || 'Failed to subscribe');
      return false;
    }
  }, [isSupported, registration, userId]);

  // Ask the backend whether THIS account gets push on this device (only where asked: Settings' switch).
  const refreshServerStatus = useCallback(async () => {
    if (!checkServer || !registration || !userId) return null;
    const endpoint = await getThisDeviceEndpoint(registration);
    if (!endpoint) { setServerSubscribed(false); setServerStatusError(false); return false; }
    try {
      const response = await apiClient.get(`/push/status?endpoint=${encodeURIComponent(endpoint)}`);
      const subscribed = !!(response.data && response.data.subscribed);
      setServerSubscribed(subscribed);
      setServerStatusError(false);
      return subscribed;
    } catch (err) {
      logger.debug('[Push] Status check failed:', err);
      setServerSubscribed(null);
      setServerStatusError(true);
      return null;
    }
  }, [checkServer, registration, userId]);

  useEffect(() => { refreshServerStatus(); }, [refreshServerStatus]);

  // Turn push OFF for this account on this device: delete ITS row only. The browser's subscription stays, because
  // other accounts on a shared browser may still use the same endpoint.
  const unsubscribe = useCallback(async () => {
    if (!registration || !userId) return false;

    try {
      const endpoint = await getThisDeviceEndpoint(registration);
      if (endpoint) {
        await apiClient.delete(`/push/unsubscribe?endpoint=${encodeURIComponent(endpoint)}`);
      }

      setServerSubscribed(false);
      clearPushOptIn(userId);
      logger.debug('[Push] Successfully unsubscribed');
      return true;
    } catch (err) {
      logger.error('[Push] Unsubscribe failed:', err);
      setError(err.message || 'Failed to unsubscribe');
      return false;
    }
  }, [registration, userId]);

  return {
    isSupported,
    isSubscribed,
    permission,
    error,
    serverSubscribed,
    serverStatusError,
    subscribe,
    unsubscribe,
    refreshServerStatus
  };
};

export default usePushNotifications;
