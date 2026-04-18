import React, { useState, useEffect, useMemo, useCallback } from 'react';
import apiClient, { BACKEND_URL } from '../lib/apiClient';
import { getNotifications, getUnreadCount, markRead, markAllRead, sendNotification, sendPhotographerAlert, createNotification, markAlertRead } from '../services/notificationService';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  Bell, Users, MessageCircle, UserPlus, Check, CheckCheck, Camera, Tag, 
  Image as ImageIcon, CreditCard, Waves, Trophy, Calendar, X, Clock,
  ChevronRight, ExternalLink
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { Button } from './ui/button';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getNotificationDeepLink } from '../utils/notificationDeepLinks';


// Notification type configurations
const NOTIFICATION_CONFIG = {
  // Sessions & Bookings
  session_join: { icon: Users, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  session_joined: { icon: Users, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  session_reminder: { icon: Clock, color: 'text-blue-400', bgColor: 'bg-blue-500/20', category: 'sessions' },
  booking_request: { icon: Calendar, color: 'text-amber-400', bgColor: 'bg-amber-500/20', category: 'sessions' },
  booking_confirmed: { icon: Check, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  session_booked: { icon: Check, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  booking_confirmation: { icon: Check, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  booking_cancelled: { icon: X, color: 'text-red-400', bgColor: 'bg-red-500/20', category: 'sessions' },
  booking_updated: { icon: Calendar, color: 'text-amber-400', bgColor: 'bg-amber-500/20', category: 'sessions' },
  booking_invite: { icon: Users, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', category: 'sessions' },
  booking_participant_joined: { icon: Users, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  lineup_join: { icon: Users, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  lineup_removed: { icon: X, color: 'text-red-400', bgColor: 'bg-red-500/20', category: 'sessions' },
  lineup_cancelled: { icon: X, color: 'text-red-400', bgColor: 'bg-red-500/20', category: 'sessions' },
  live_session: { icon: Camera, color: 'text-red-400', bgColor: 'bg-red-500/20', category: 'sessions' },
  join_request: { icon: Users, color: 'text-amber-400', bgColor: 'bg-amber-500/20', category: 'sessions' },
  invite_accepted: { icon: Check, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  
  // Payments
  payment_window_expired: { icon: CreditCard, color: 'text-red-400', bgColor: 'bg-red-500/20', category: 'payments' },
  payment_expiry_reminder: { icon: Clock, color: 'text-amber-400', bgColor: 'bg-amber-500/20', category: 'payments' },
  payment_request: { icon: CreditCard, color: 'text-amber-400', bgColor: 'bg-amber-500/20', category: 'payments' },
  payment_received: { icon: CreditCard, color: 'text-green-400', bgColor: 'bg-green-500/20', category: 'payments' },
  booking_payment: { icon: CreditCard, color: 'text-green-400', bgColor: 'bg-green-500/20', category: 'payments' },
  booking_payment_received: { icon: CreditCard, color: 'text-green-400', bgColor: 'bg-green-500/20', category: 'payments' },
  booking_earning: { icon: CreditCard, color: 'text-green-400', bgColor: 'bg-green-500/20', category: 'payments' },
  escrow_auto_released: { icon: CreditCard, color: 'text-green-400', bgColor: 'bg-green-500/20', category: 'payments' },
  escrow_released: { icon: CreditCard, color: 'text-green-400', bgColor: 'bg-green-500/20', category: 'payments' },
  escrow_released_to_photographer: { icon: CreditCard, color: 'text-green-400', bgColor: 'bg-green-500/20', category: 'payments' },
  credit_refund: { icon: CreditCard, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', category: 'payments' },
  booking_refund: { icon: CreditCard, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', category: 'payments' },
  crew_payment_request: { icon: CreditCard, color: 'text-amber-400', bgColor: 'bg-amber-500/20', category: 'payments' },
  lineup_payment_due: { icon: CreditCard, color: 'text-amber-400', bgColor: 'bg-amber-500/20', category: 'payments' },
  tip_received: { icon: CreditCard, color: 'text-green-400', bgColor: 'bg-green-500/20', category: 'payments' },
  gallery_sale: { icon: CreditCard, color: 'text-green-400', bgColor: 'bg-green-500/20', category: 'payments' },
  gallery_purchase: { icon: CreditCard, color: 'text-green-400', bgColor: 'bg-green-500/20', category: 'payments' },
  
  // Photos & Gallery
  photo_tagged: { icon: Tag, color: 'text-purple-400', bgColor: 'bg-purple-500/20', category: 'photos' },
  gallery_item: { icon: ImageIcon, color: 'text-pink-400', bgColor: 'bg-pink-500/20', category: 'photos' },
  selection_auto_completed: { icon: Check, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'photos' },
  selection_forfeited: { icon: X, color: 'text-gray-400', bgColor: 'bg-gray-500/20', category: 'photos' },
  selection_expiry_warning: { icon: Clock, color: 'text-amber-400', bgColor: 'bg-amber-500/20', category: 'photos' },
  photo_purchased: { icon: ImageIcon, color: 'text-green-400', bgColor: 'bg-green-500/20', category: 'photos' },
  photo_gifted: { icon: ImageIcon, color: 'text-pink-400', bgColor: 'bg-pink-500/20', category: 'photos' },
  live_photo_purchase: { icon: ImageIcon, color: 'text-green-400', bgColor: 'bg-green-500/20', category: 'photos' },
  
  // Social
  new_follower: { icon: UserPlus, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', category: 'social' },
  new_message: { icon: MessageCircle, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', category: 'social' },
  message_reaction: { icon: MessageCircle, color: 'text-pink-400', bgColor: 'bg-pink-500/20', category: 'social' },
  mention: { icon: Tag, color: 'text-purple-400', bgColor: 'bg-purple-500/20', category: 'social' },
  badge_earned: { icon: Trophy, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', category: 'social' },
  shaka_received: { icon: Trophy, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', category: 'social' },
  collaboration_invite: { icon: Users, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', category: 'social' },
  collaboration_request: { icon: Users, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', category: 'social' },
  crew_invite: { icon: Users, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', category: 'social' },
  friend_invite: { icon: UserPlus, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', category: 'social' },
  
  // Alerts
  surf_alert: { icon: Waves, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', category: 'alerts' },
  grom_spending_alert: { icon: CreditCard, color: 'text-amber-400', bgColor: 'bg-amber-500/20', category: 'alerts' },
  grom_link_request: { icon: Users, color: 'text-amber-400', bgColor: 'bg-amber-500/20', category: 'alerts' },
  
  // Admin
  new_pro_application: { icon: UserPlus, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', category: 'admin' },
  verification_approved: { icon: Check, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'admin' },
  
  // On-Demand
  crew_session_invite: { icon: Users, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', category: 'sessions' },
  dispatch_declined: { icon: X, color: 'text-red-400', bgColor: 'bg-red-500/20', category: 'sessions' },
  
  default: { icon: Bell, color: 'text-gray-400', bgColor: 'bg-gray-500/20', category: 'social' }
};

// Tab configurations
const TABS = [
  { id: 'all', label: 'All', icon: Bell },
  { id: 'alerts', label: 'Alerts', icon: Waves },
  { id: 'sessions', label: 'Sessions', icon: Camera },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'photos', label: 'Photos', icon: ImageIcon },
  { id: 'social', label: 'Social', icon: Users },
];

export const NotificationsDrawer = ({ isOpen, onClose, onCountUpdate }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    if (isOpen && user?.id) {
      fetchNotifications();
    }
  }, [isOpen, user?.id]);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const response = await getNotifications(user.id);
      setNotifications(response.data);
    } catch (error) {
      logger.error('Failed to fetch notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter notifications by active tab
  const filteredNotifications = useMemo(() => {
    if (activeTab === 'all') return notifications;
    return notifications.filter(n => {
      const config = NOTIFICATION_CONFIG[n.type] || NOTIFICATION_CONFIG.default;
      return config.category === activeTab;
    });
  }, [notifications, activeTab]);

  // Count unread per tab
  const unreadCounts = useMemo(() => {
    const counts = { all: 0, alerts: 0, sessions: 0, payments: 0, photos: 0, social: 0 };
    notifications.forEach(n => {
      if (!n.is_read) {
        counts.all++;
        const config = NOTIFICATION_CONFIG[n.type] || NOTIFICATION_CONFIG.default;
        if (counts[config.category] !== undefined) {
          counts[config.category]++;
        }
      }
    });
    return counts;
  }, [notifications]);

  const _handleMarkAsRead = async (notificationId) => {
    try {
      await markRead(notificationId);
      setNotifications(notifications.map(n => 
        n.id === notificationId ? { ...n, is_read: true } : n
      ));
      if (onCountUpdate) onCountUpdate();
    } catch (error) {
      logger.error('Failed to mark as read:', error);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllRead(user.id);
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
      toast.success('All marked as read');
      if (onCountUpdate) onCountUpdate();
    } catch (error) {
      toast.error('Failed to mark all as read');
    }
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const handleViewAll = () => {
    onClose();
    navigate('/notifications');
  };

  // Handle notification click - mark as read and navigate to deep link
  const handleNotificationClick = useCallback(async (notification) => {
    // Mark as read first
    if (!notification.is_read) {
      try {
        await markRead(notification.id);
        setNotifications(prev => prev.map(n => 
          n.id === notification.id ? { ...n, is_read: true } : n
        ));
        if (onCountUpdate) onCountUpdate();
      } catch (error) {
        logger.error('Failed to mark as read:', error);
      }
    }
    
    // Get deep link and navigate
    const deepLink = getNotificationDeepLink(notification);
    if (deepLink) {
      onClose(); // Close the drawer first
      if (deepLink.state) {
        navigate(deepLink.route, { state: deepLink.state });
      } else {
        navigate(deepLink.route);
      }
    }
  }, [navigate, onClose, onCountUpdate]);

  const NotificationItem = ({ notification }) => {
    const config = NOTIFICATION_CONFIG[notification.type] || NOTIFICATION_CONFIG.default;
    const Icon = config.icon;
    const deepLink = getNotificationDeepLink(notification);
    const isClickable = !!deepLink;
    
    return (
      <div
        onClick={() => handleNotificationClick(notification)}
        className={`flex items-start gap-3 p-3 rounded-lg transition-all ${
          isClickable ? 'cursor-pointer' : 'cursor-default'
        } ${
          notification.is_read 
            ? 'bg-zinc-800/20 hover:bg-zinc-800/40' 
            : 'bg-zinc-800/60 hover:bg-zinc-700/60 border-l-2 border-yellow-400'
        }`}
      >
        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${config.bgColor}`}>
          <Icon className={`w-4 h-4 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`font-medium text-sm leading-tight ${notification.is_read ? 'text-gray-400' : 'text-white'}`}>
              {notification.title}
            </p>
            <span className="text-[10px] text-gray-500 flex-shrink-0">{formatTime(notification.created_at)}</span>
          </div>
          {notification.body && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{notification.body}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!notification.is_read && (
            <div className="w-2 h-2 rounded-full bg-yellow-400 mt-1.5"></div>
          )}
          {isClickable && (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </div>
    );
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent 
        side="bottom"
        hideCloseButton
        className="bg-zinc-900 border-zinc-700 rounded-t-3xl sheet-safe-bottom md:!bottom-4 overflow-hidden flex flex-col"
      >
        <SheetHeader className="pb-2 shrink-0 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 flex items-center justify-center">
                <Bell className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <SheetTitle className="text-lg font-bold text-white">Notifications</SheetTitle>
                {unreadCounts.all > 0 && (
                  <p className="text-xs text-gray-400">{unreadCounts.all} unread</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {unreadCounts.all > 0 && (
                <Button
                  onClick={handleMarkAllRead}
                  variant="ghost"
                  size="sm"
                  className="text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 h-8 px-2"
                >
                  <CheckCheck className="w-4 h-4" />
                </Button>
              )}
              <button 
                onClick={onClose}
                className="text-gray-400 hover:text-white p-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </SheetHeader>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto py-2 px-1 shrink-0 scrollbar-hide">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const count = unreadCounts[tab.id];
            
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  isActive 
                    ? 'bg-yellow-500 text-black' 
                    : 'bg-zinc-800 text-gray-400 hover:bg-zinc-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {count > 0 && (
                  <span className={`min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                    isActive ? 'bg-black/20 text-black' : 'bg-yellow-500 text-black'
                  }`}>
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 space-y-1.5 px-1 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-yellow-400"></div>
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="text-center py-12">
              <Bell className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">No notifications</p>
            </div>
          ) : (
            <>
              {filteredNotifications.slice(0, 10).map(notification => (
                <NotificationItem key={notification.id} notification={notification} />
              ))}
              
              {filteredNotifications.length > 10 && (
                <p className="text-center text-xs text-gray-500 py-2">
                  +{filteredNotifications.length - 10} more notifications
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 p-3 shrink-0">
          <Button
            onClick={handleViewAll}
            variant="outline"
            className="w-full bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700"
          >
            View All Notifications
            <ExternalLink className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default NotificationsDrawer;
