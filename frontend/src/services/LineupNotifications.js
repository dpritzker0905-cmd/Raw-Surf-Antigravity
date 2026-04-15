/**
 * LineupNotifications - Real-time notification service for lineup status changes
 * 
 * Features:
 * - WebSocket-based real-time updates
 * - In-app toast notifications (sonner)
 * - Browser push notifications (when permission granted)
 * - Sound alerts for urgent notifications
 */
import { toast } from 'sonner';
import logger from '../utils/logger';

// Notification sound (optional - using Web Audio API)
const playNotificationSound = () => {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.1;
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.15);
    
    setTimeout(() => {
      const oscillator2 = audioContext.createOscillator();
      oscillator2.connect(gainNode);
      oscillator2.frequency.value = 1000;
      oscillator2.type = 'sine';
      oscillator2.start();
      oscillator2.stop(audioContext.currentTime + 0.15);
    }, 150);
  } catch (e) {
    // Audio not supported
  }
};

// Request browser notification permission
export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) {
    logger.debug('Browser does not support notifications');
    return false;
  }
  
  if (Notification.permission === 'granted') {
    return true;
  }
  
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  
  return false;
};

// Send browser push notification
const sendPushNotification = (title, body, icon = '/favicon.ico') => {
  if (Notification.permission === 'granted') {
    try {
      const notification = new Notification(title, {
        body,
        icon,
        badge: '/favicon.ico',
        vibrate: [200, 100, 200],
        tag: 'lineup-notification',
        renotify: true
      });
      
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      
      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);
    } catch (e) {
      logger.error('Failed to send push notification:', e);
    }
  }
};

// Notification type configurations
const NOTIFICATION_CONFIG = {
  // Session status changes
  session_opened: {
    icon: '🟢',
    title: 'Session Opened',
    getMessage: (data) => `${data.session_name || 'A session'} is now open for new surfers!`,
    toastType: 'success',
    playSound: true,
    sendPush: true
  },
  session_closed: {
    icon: '🔴',
    title: 'Session Closed',
    getMessage: (data) => `${data.session_name || 'The session'} is now closed to new bookings`,
    toastType: 'info',
    playSound: false,
    sendPush: true
  },
  session_locked: {
    icon: '🔒',
    title: 'Session Locked',
    getMessage: (data) => `${data.session_name || 'The session'} has been locked and finalized!`,
    toastType: 'warning',
    playSound: true,
    sendPush: true
  },
  
  // Crew changes
  crew_joined: {
    icon: '🏄',
    title: 'New Crew Member!',
    getMessage: (data) => `${data.member_name || 'Someone'} joined ${data.session_name || 'your lineup'}!`,
    toastType: 'success',
    playSound: true,
    sendPush: true
  },
  crew_left: {
    icon: '👋',
    title: 'Crew Member Left',
    getMessage: (data) => `${data.member_name || 'Someone'} left ${data.session_name || 'the lineup'}`,
    toastType: 'info',
    playSound: false,
    sendPush: true
  },
  crew_removed: {
    icon: '❌',
    title: 'Removed from Lineup',
    getMessage: (data) => `You've been removed from ${data.session_name || 'a lineup'}`,
    toastType: 'error',
    playSound: true,
    sendPush: true
  },
  
  // Payment notifications
  payment_received: {
    icon: '💰',
    title: 'Payment Received!',
    getMessage: (data) => `${data.member_name || 'A crew member'} paid $${data.amount || '0'} for ${data.session_name || 'the session'}`,
    toastType: 'success',
    playSound: true,
    sendPush: true
  },
  payment_pending: {
    icon: '⏳',
    title: 'Payment Pending',
    getMessage: (data) => `Waiting for payment from ${data.member_name || 'crew members'}`,
    toastType: 'warning',
    playSound: false,
    sendPush: false
  },
  
  // Invite notifications
  invite_received: {
    icon: '✉️',
    title: 'Lineup Invite!',
    getMessage: (data) => `${data.inviter_name || 'Someone'} invited you to join ${data.session_name || 'a session'}`,
    toastType: 'success',
    playSound: true,
    sendPush: true
  },
  invite_accepted: {
    icon: '✅',
    title: 'Invite Accepted',
    getMessage: (data) => `${data.member_name || 'Someone'} accepted your invite to ${data.session_name || 'the session'}!`,
    toastType: 'success',
    playSound: true,
    sendPush: true
  },
  invite_declined: {
    icon: '😞',
    title: 'Invite Declined',
    getMessage: (data) => `${data.member_name || 'Someone'} declined your invite`,
    toastType: 'info',
    playSound: false,
    sendPush: false
  },
  
  // Session reminders
  session_reminder: {
    icon: '⏰',
    title: 'Session Reminder',
    getMessage: (data) => `Your session at ${data.location || 'the spot'} starts in ${data.time_until || '1 hour'}!`,
    toastType: 'info',
    playSound: true,
    sendPush: true
  },
  lineup_closing_soon: {
    icon: '⚠️',
    title: 'Lineup Closing Soon',
    getMessage: (data) => `Lineup for ${data.session_name || 'your session'} closes in ${data.time_until || '24 hours'}`,
    toastType: 'warning',
    playSound: true,
    sendPush: true
  },
  
  // Session cancellation
  session_cancelled: {
    icon: '🚫',
    title: 'Session Cancelled',
    getMessage: (data) => `${data.session_name || 'A session'} has been cancelled. ${data.refund_info || 'Refund processing.'}`,
    toastType: 'error',
    playSound: true,
    sendPush: true
  }
};

// Main notification handler
export const handleLineupNotification = (type, data, options = {}) => {
  const config = NOTIFICATION_CONFIG[type];
  
  if (!config) {
    logger.warn(`Unknown notification type: ${type}`);
    return;
  }
  
  const message = config.getMessage(data);
  const title = `${config.icon} ${config.title}`;
  
  // In-app toast notification
  const toastOptions = {
    duration: options.duration || 5000,
    position: options.position || 'top-right',
    description: message
  };
  
  switch (config.toastType) {
    case 'success':
      toast.success(title, toastOptions);
      break;
    case 'error':
      toast.error(title, toastOptions);
      break;
    case 'warning':
      toast.warning(title, toastOptions);
      break;
    default:
      toast.info(title, toastOptions);
  }
  
  // Play sound if enabled
  if (config.playSound && options.soundEnabled !== false) {
    playNotificationSound();
  }
  
  // Send push notification if enabled and we have permission
  if (config.sendPush && options.pushEnabled !== false) {
    sendPushNotification(config.title, message);
  }
  
  // Log for debugging
  logger.debug(`[LineupNotification] ${type}:`, data);
};

// Helper to process WebSocket lineup events
export const processLineupWebSocketEvent = (event, currentUserId) => {
  const { type, data } = event;
  
  // Map WebSocket event types to notification types
  const eventTypeMapping = {
    'lineup_status_changed': () => {
      if (data.new_status === 'open') return 'session_opened';
      if (data.new_status === 'closed') return 'session_closed';
      if (data.new_status === 'locked') return 'session_locked';
      return null;
    },
    'member_joined': () => 'crew_joined',
    'member_left': () => 'crew_left',
    'member_removed': () => data.removed_user_id === currentUserId ? 'crew_removed' : null,
    'payment_received': () => 'payment_received',
    'invite_sent': () => data.invitee_id === currentUserId ? 'invite_received' : null,
    'invite_accepted': () => 'invite_accepted',
    'invite_declined': () => 'invite_declined',
    'session_cancelled': () => 'session_cancelled'
  };
  
  const getNotificationType = eventTypeMapping[type];
  if (!getNotificationType) return null;
  
  const notificationType = getNotificationType();
  if (!notificationType) return null;
  
  return { type: notificationType, data };
};

// Export notification types for external use
export const LINEUP_NOTIFICATION_TYPES = Object.keys(NOTIFICATION_CONFIG);

export default {
  handleLineupNotification,
  processLineupWebSocketEvent,
  requestNotificationPermission,
  LINEUP_NOTIFICATION_TYPES
};
