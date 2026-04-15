/**
 * OneSignal Push Notifications Hook
 * Initialize OneSignal and manage user subscriptions
 */
import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import logger from '../utils/logger';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Dynamic import for OneSignal to avoid SSR issues
let OneSignal = null;

export const useOneSignal = (userId, userEmail) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState('default');

  // Initialize OneSignal
  useEffect(() => {
    const initOneSignal = async () => {
      if (typeof window === 'undefined') return;
      
      try {
        // Fetch config from backend
        const response = await axios.get(`${API}/push/onesignal/config`);
        const { app_id, enabled } = response.data;
        
        if (!enabled || !app_id) {
          logger.debug('OneSignal not enabled');
          return;
        }

        // Dynamic import
        const OneSignalModule = await import('react-onesignal');
        OneSignal = OneSignalModule.default;
        
        await OneSignal.init({
          appId: app_id,
          allowLocalhostAsSecureOrigin: process.env.NODE_ENV === 'development',
          serviceWorkerPath: '/OneSignalSDKWorker.js',
          notifyButton: {
            enable: false // We'll use our own UI
          },
          promptOptions: {
            slidedown: {
              prompts: [
                {
                  type: 'push',
                  autoPrompt: false,
                  text: {
                    actionMessage: 'Get notified about new messages, dispatch requests, and more!',
                    acceptButton: 'Allow',
                    cancelButton: 'Maybe Later'
                  },
                  delay: {
                    pageViews: 2,
                    timeDelay: 10
                  }
                }
              ]
            }
          }
        });
        
        setIsInitialized(true);
        logger.debug('OneSignal initialized');
        
        // Check current permission
        const permission = await OneSignal.Notifications.permission;
        setPermissionStatus(permission ? 'granted' : 'default');
        
        // Check if already subscribed
        const subscriptionState = await OneSignal.User.PushSubscription.optedIn;
        setIsSubscribed(subscriptionState);
        
      } catch (error) {
        logger.error('OneSignal init error:', error);
      }
    };

    initOneSignal();
  }, []);

  // Login user to OneSignal when userId changes
  useEffect(() => {
    const loginUser = async () => {
      if (!isInitialized || !userId || !OneSignal) return;
      
      try {
        // Set external ID (our user ID)
        await OneSignal.login(userId);
        logger.debug(`OneSignal user logged in: ${userId}`);
        
        // Set email if available
        if (userEmail) {
          await OneSignal.User.addEmail(userEmail);
        }
        
        // Save subscription to our backend
        const subscriptionId = await OneSignal.User.PushSubscription.id;
        if (subscriptionId) {
          await axios.post(`${API}/push/onesignal/subscribe`, {
            user_id: userId,
            subscription_id: subscriptionId
          });
        }
      } catch (error) {
        logger.error('OneSignal login error:', error);
      }
    };

    loginUser();
  }, [isInitialized, userId, userEmail]);

  // Request push permission
  const requestPermission = useCallback(async () => {
    if (!isInitialized || !OneSignal) {
      logger.warn('OneSignal not initialized');
      return false;
    }
    
    try {
      await OneSignal.Slidedown.promptPush();
      
      // Check if permission was granted
      const permission = await OneSignal.Notifications.permission;
      setPermissionStatus(permission ? 'granted' : 'denied');
      
      if (permission) {
        const subscriptionState = await OneSignal.User.PushSubscription.optedIn;
        setIsSubscribed(subscriptionState);
      }
      
      return permission;
    } catch (error) {
      logger.error('Permission request error:', error);
      return false;
    }
  }, [isInitialized]);

  // Logout from OneSignal
  const logout = useCallback(async () => {
    if (!OneSignal) return;
    
    try {
      await OneSignal.logout();
      setIsSubscribed(false);
      logger.debug('OneSignal logged out');
    } catch (error) {
      logger.error('OneSignal logout error:', error);
    }
  }, []);

  return {
    isInitialized,
    isSubscribed,
    permissionStatus,
    requestPermission,
    logout
  };
};

export default useOneSignal;
