import { useState, useEffect, useCallback } from 'react';
import apiClient from '../lib/apiClient';
import logger from '../utils/logger';


export const usePushNotifications = (userId) => {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState('default');
  const [registration, setRegistration] = useState(null);
  const [error, setError] = useState(null);

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
      setError(null);
      logger.debug('[Push] Successfully subscribed');
      return true;
    } catch (err) {
      logger.error('[Push] Subscription failed:', err);
      setError(err.message || 'Failed to subscribe');
      return false;
    }
  }, [isSupported, registration, userId]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    if (!registration || !userId) return false;

    try {
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        // Unsubscribe from browser
        await subscription.unsubscribe();
        
        // Remove from server
        await apiClient.delete(`/push/unsubscribe?endpoint=${encodeURIComponent(subscription.endpoint)}`);
      }

      setIsSubscribed(false);
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
    subscribe,
    unsubscribe
  };
};

export default usePushNotifications;
