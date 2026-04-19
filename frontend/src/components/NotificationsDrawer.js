import React, { useState, useEffect, useMemo, useCallback } from 'react';
import apiClient from '../lib/apiClient';
import { getNotifications, markRead, markAllRead } from '../services/notificationService';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
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

// ── Theme colour tokens (mirrors GoLiveModal pattern) ────────────────────────
const getThemeColors = (theme) => {
  if (theme === 'light') return {
    bg:           'bg-white',
    border:       'border-gray-200',
    headerBorder: 'border-gray-100',
    footerBorder: 'border-gray-200',
    title:        'text-gray-900',
    subtext:      'text-gray-500',
    body:         'text-gray-700',
    itemUnread:   'bg-blue-50 hover:bg-blue-100/70 border-l-2 border-yellow-400',
    itemRead:     'bg-gray-50 hover:bg-gray-100',
    tabActive:    'bg-yellow-500 text-black',
    tabInactive:  'bg-gray-100 text-gray-600 hover:bg-gray-200',
    tabBadge:     'bg-yellow-500 text-black',
    closeBtn:     'text-gray-500 hover:text-gray-900',
    footer:       'bg-white',
    footerBtn:    'bg-gray-100 border-gray-200 text-gray-800 hover:bg-gray-200',
    emptyIcon:    'text-gray-300',
    emptyText:    'text-gray-400',
    timeText:     'text-gray-400',
    chevron:      'text-gray-400',
    unreadDot:    'bg-yellow-400',
    markRead:     'text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50',
    iconBg:       'bg-gradient-to-br from-yellow-100 to-orange-100',
    iconColor:    'text-yellow-500',
  };
  if (theme === 'beach') return {
    bg:           'bg-zinc-950',
    border:       'border-amber-800/30',
    headerBorder: 'border-amber-800/20',
    footerBorder: 'border-amber-800/30',
    title:        'text-amber-100',
    subtext:      'text-amber-400/70',
    body:         'text-amber-200',
    itemUnread:   'bg-amber-900/30 hover:bg-amber-800/40 border-l-2 border-amber-400',
    itemRead:     'bg-zinc-900/40 hover:bg-zinc-800/40',
    tabActive:    'bg-amber-500 text-black',
    tabInactive:  'bg-zinc-800 text-amber-400/70 hover:bg-zinc-700',
    tabBadge:     'bg-amber-500 text-black',
    closeBtn:     'text-amber-400/70 hover:text-amber-100',
    footer:       'bg-zinc-950',
    footerBtn:    'bg-zinc-800 border-amber-800/30 text-amber-100 hover:bg-zinc-700',
    emptyIcon:    'text-zinc-600',
    emptyText:    'text-zinc-500',
    timeText:     'text-zinc-500',
    chevron:      'text-zinc-500',
    unreadDot:    'bg-amber-400',
    markRead:     'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10',
    iconBg:       'bg-gradient-to-br from-yellow-500/20 to-orange-500/20',
    iconColor:    'text-yellow-400',
  };
  // dark (default)
  return {
    bg:           'bg-zinc-900',
    border:       'border-zinc-700',
    headerBorder: 'border-zinc-800',
    footerBorder: 'border-zinc-800',
    title:        'text-white',
    subtext:      'text-gray-400',
    body:         'text-gray-300',
    itemUnread:   'bg-zinc-800/60 hover:bg-zinc-700/60 border-l-2 border-yellow-400',
    itemRead:     'bg-zinc-800/20 hover:bg-zinc-800/40',
    tabActive:    'bg-yellow-500 text-black',
    tabInactive:  'bg-zinc-800 text-gray-400 hover:bg-zinc-700',
    tabBadge:     'bg-yellow-500 text-black',
    closeBtn:     'text-gray-400 hover:text-white',
    footer:       'bg-zinc-900',
    footerBtn:    'bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700',
    emptyIcon:    'text-gray-600',
    emptyText:    'text-gray-400',
    timeText:     'text-gray-500',
    chevron:      'text-gray-500',
    unreadDot:    'bg-yellow-400',
    markRead:     'text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10',
    iconBg:       'bg-gradient-to-br from-yellow-500/20 to-orange-500/20',
    iconColor:    'text-yellow-400',
  };
};

// Notification type configurations
const NOTIFICATION_CONFIG = {
  session_join:                    { icon: Users,        color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  session_joined:                  { icon: Users,        color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  session_reminder:                { icon: Clock,        color: 'text-blue-400',    bgColor: 'bg-blue-500/20',    category: 'sessions' },
  booking_request:                 { icon: Calendar,     color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'sessions' },
  booking_confirmed:               { icon: Check,        color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  session_booked:                  { icon: Check,        color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  booking_confirmation:            { icon: Check,        color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  booking_cancelled:               { icon: X,            color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'sessions' },
  booking_updated:                 { icon: Calendar,     color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'sessions' },
  booking_invite:                  { icon: Users,        color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'sessions' },
  booking_participant_joined:      { icon: Users,        color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  lineup_join:                     { icon: Users,        color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  lineup_removed:                  { icon: X,            color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'sessions' },
  lineup_cancelled:                { icon: X,            color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'sessions' },
  live_session:                    { icon: Camera,       color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'sessions' },
  join_request:                    { icon: Users,        color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'sessions' },
  invite_accepted:                 { icon: Check,        color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  crew_session_invite:             { icon: Users,        color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'sessions' },
  dispatch_declined:               { icon: X,            color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'sessions' },
  payment_window_expired:          { icon: CreditCard,   color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'payments' },
  payment_expiry_reminder:         { icon: Clock,        color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'payments' },
  payment_request:                 { icon: CreditCard,   color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'payments' },
  payment_received:                { icon: CreditCard,   color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  booking_payment:                 { icon: CreditCard,   color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  booking_payment_received:        { icon: CreditCard,   color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  booking_earning:                 { icon: CreditCard,   color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  escrow_auto_released:            { icon: CreditCard,   color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  escrow_released:                 { icon: CreditCard,   color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  escrow_released_to_photographer: { icon: CreditCard,   color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  credit_refund:                   { icon: CreditCard,   color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'payments' },
  booking_refund:                  { icon: CreditCard,   color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'payments' },
  crew_payment_request:            { icon: CreditCard,   color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'payments' },
  lineup_payment_due:              { icon: CreditCard,   color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'payments' },
  tip_received:                    { icon: CreditCard,   color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  gallery_sale:                    { icon: CreditCard,   color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  gallery_purchase:                { icon: CreditCard,   color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  photo_tagged:                    { icon: Tag,          color: 'text-purple-400',  bgColor: 'bg-purple-500/20',  category: 'photos' },
  gallery_item:                    { icon: ImageIcon,    color: 'text-pink-400',    bgColor: 'bg-pink-500/20',    category: 'photos' },
  selection_auto_completed:        { icon: Check,        color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'photos' },
  selection_forfeited:             { icon: X,            color: 'text-gray-400',    bgColor: 'bg-gray-500/20',    category: 'photos' },
  selection_expiry_warning:        { icon: Clock,        color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'photos' },
  photo_purchased:                 { icon: ImageIcon,    color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'photos' },
  photo_gifted:                    { icon: ImageIcon,    color: 'text-pink-400',    bgColor: 'bg-pink-500/20',    category: 'photos' },
  live_photo_purchase:             { icon: ImageIcon,    color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'photos' },
  new_follower:                    { icon: UserPlus,     color: 'text-yellow-400',  bgColor: 'bg-yellow-500/20',  category: 'social' },
  new_message:                     { icon: MessageCircle,color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'social' },
  message_reaction:                { icon: MessageCircle,color: 'text-pink-400',    bgColor: 'bg-pink-500/20',    category: 'social' },
  mention:                         { icon: Tag,          color: 'text-purple-400',  bgColor: 'bg-purple-500/20',  category: 'social' },
  badge_earned:                    { icon: Trophy,       color: 'text-yellow-400',  bgColor: 'bg-yellow-500/20',  category: 'social' },
  shaka_received:                  { icon: Trophy,       color: 'text-yellow-400',  bgColor: 'bg-yellow-500/20',  category: 'social' },
  collaboration_invite:            { icon: Users,        color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'social' },
  collaboration_request:           { icon: Users,        color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'social' },
  crew_invite:                     { icon: Users,        color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'social' },
  friend_invite:                   { icon: UserPlus,     color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'social' },
  surf_alert:                      { icon: Waves,        color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'alerts' },
  grom_spending_alert:             { icon: CreditCard,   color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'alerts' },
  grom_link_request:               { icon: Users,        color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'alerts' },
  new_pro_application:             { icon: UserPlus,     color: 'text-yellow-400',  bgColor: 'bg-yellow-500/20',  category: 'admin' },
  verification_approved:           { icon: Check,        color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'admin' },
  default:                         { icon: Bell,         color: 'text-gray-400',    bgColor: 'bg-gray-500/20',    category: 'social' },
};

const TABS = [
  { id: 'all',      label: 'All',      icon: Bell },
  { id: 'alerts',   label: 'Alerts',   icon: Waves },
  { id: 'sessions', label: 'Sessions', icon: Camera },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'photos',   label: 'Photos',   icon: ImageIcon },
  { id: 'social',   label: 'Social',   icon: Users },
];

export const NotificationsDrawer = ({ isOpen, onClose, onCountUpdate }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const colors = useMemo(() => getThemeColors(theme), [theme]);

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    if (isOpen && user?.id) fetchNotifications();
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

  const filteredNotifications = useMemo(() => {
    if (activeTab === 'all') return notifications;
    return notifications.filter(n => {
      const config = NOTIFICATION_CONFIG[n.type] || NOTIFICATION_CONFIG.default;
      return config.category === activeTab;
    });
  }, [notifications, activeTab]);

  const unreadCounts = useMemo(() => {
    const counts = { all: 0, alerts: 0, sessions: 0, payments: 0, photos: 0, social: 0 };
    notifications.forEach(n => {
      if (!n.is_read) {
        counts.all++;
        const config = NOTIFICATION_CONFIG[n.type] || NOTIFICATION_CONFIG.default;
        if (counts[config.category] !== undefined) counts[config.category]++;
      }
    });
    return counts;
  }, [notifications]);

  const handleMarkAllRead = async () => {
    try {
      await markAllRead(user.id);
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
      toast.success('All marked as read');
      if (onCountUpdate) onCountUpdate();
    } catch {
      toast.error('Failed to mark all as read');
    }
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const diffMs = Date.now() - date;
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

  const handleNotificationClick = useCallback(async (notification) => {
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
    const deepLink = getNotificationDeepLink(notification);
    if (deepLink) {
      onClose();
      if (deepLink.state) navigate(deepLink.route, { state: deepLink.state });
      else navigate(deepLink.route);
    }
  }, [navigate, onClose, onCountUpdate]);

  // ── Notification Item ─────────────────────────────────────────────────────
  const NotificationItem = ({ notification }) => {
    const config = NOTIFICATION_CONFIG[notification.type] || NOTIFICATION_CONFIG.default;
    const Icon = config.icon;
    const isClickable = !!getNotificationDeepLink(notification);

    return (
      <div
        onClick={() => handleNotificationClick(notification)}
        className={`flex items-start gap-3 p-3 rounded-xl transition-all ${
          isClickable ? 'cursor-pointer' : 'cursor-default'
        } ${notification.is_read ? colors.itemRead : colors.itemUnread}`}
      >
        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${config.bgColor}`}>
          <Icon className={`w-4 h-4 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`font-medium text-sm leading-tight ${notification.is_read ? colors.subtext : colors.title}`}>
              {notification.title}
            </p>
            <span className={`text-[10px] ${colors.timeText} flex-shrink-0`}>{formatTime(notification.created_at)}</span>
          </div>
          {notification.body && (
            <p className={`text-xs ${colors.subtext} mt-0.5 line-clamp-2`}>{notification.body}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!notification.is_read && (
            <div className={`w-2 h-2 rounded-full ${colors.unreadDot} mt-1.5`} />
          )}
          {isClickable && (
            <ChevronRight className={`w-4 h-4 ${colors.chevron}`} />
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
        className={`
          ${colors.bg} ${colors.border} border-t
          rounded-t-3xl overflow-hidden flex flex-col
          /* ── FIX 1: clamp height so it never bleeds above viewport on mobile ── */
          max-h-[92dvh]
          /* fallback for browsers without dvh */
          max-h-[92vh]
          /* desktop: float slightly above bottom edge */
          md:!bottom-4 md:!left-4 md:!right-4 md:rounded-2xl md:max-h-[78vh]
        `}
        style={{ maxHeight: 'min(92dvh, 92vh)' }}
      >
        {/* ── Handle bar (mobile drag indicator) ── */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className={`w-10 h-1 rounded-full ${theme === 'light' ? 'bg-gray-300' : 'bg-zinc-600'}`} />
        </div>

        {/* ── Header ── */}
        <SheetHeader className={`pb-2 shrink-0 px-4 border-b ${colors.headerBorder}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${colors.iconBg} flex items-center justify-center`}>
                <Bell className={`w-5 h-5 ${colors.iconColor}`} />
              </div>
              <div>
                <SheetTitle className={`text-lg font-bold ${colors.title}`}>Notifications</SheetTitle>
                {unreadCounts.all > 0 && (
                  <p className={`text-xs ${colors.subtext}`}>{unreadCounts.all} unread</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {unreadCounts.all > 0 && (
                <Button
                  onClick={handleMarkAllRead}
                  variant="ghost"
                  size="sm"
                  className={`${colors.markRead} h-8 px-2`}
                >
                  <CheckCheck className="w-4 h-4" />
                </Button>
              )}
              <button onClick={onClose} className={`${colors.closeBtn} p-2 rounded-full transition-colors`}>
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </SheetHeader>

        {/* ── Filter Tabs ── */}
        <div className="flex gap-1.5 overflow-x-auto py-3 px-4 shrink-0 scrollbar-hide">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const count = unreadCounts[tab.id];
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  isActive ? colors.tabActive : colors.tabInactive
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {count > 0 && (
                  <span className={`min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${
                    isActive ? 'bg-black/20 text-black' : colors.tabBadge
                  }`}>
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Notification List — no arbitrary cap, natural scroll ── */}
        {/* Best practice: show all items, let overflow-y-auto + max-h handle it */}
        {/* "View All" footer still available for full-page experience */}
        <div className="overflow-y-auto flex-1 space-y-1.5 px-3 pb-2 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className={`animate-spin rounded-full h-6 w-6 border-b-2 ${colors.iconColor.replace('text-', 'border-')}`} />
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="text-center py-12">
              <Bell className={`w-10 h-10 ${colors.emptyIcon} mx-auto mb-3`} />
              <p className={`${colors.emptyText} text-sm font-medium`}>
                {activeTab === 'all' ? 'No notifications yet' : `No ${activeTab} notifications`}
              </p>
              <p className={`${colors.subtext} text-xs mt-1`}>We'll let you know when something happens</p>
            </div>
          ) : (
            <>
              {filteredNotifications.slice(0, 10).map(notification => (
                <NotificationItem key={notification.id} notification={notification} />
              ))}
              {filteredNotifications.length > 10 && (
                <button
                  onClick={handleViewAll}
                  className={`w-full py-3 text-sm font-semibold flex items-center justify-center gap-2 rounded-xl transition-all mt-1 ${
                    theme === 'light'
                      ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 active:bg-blue-200'
                      : theme === 'beach'
                      ? 'text-amber-400 bg-amber-900/20 hover:bg-amber-900/30'
                      : 'text-yellow-400 bg-zinc-800/60 hover:bg-zinc-700/60'
                  }`}
                >
                  <Bell className="w-4 h-4" />
                  See all {filteredNotifications.length - 10} more notifications
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className={`border-t ${colors.footerBorder} p-3 shrink-0 ${colors.footer}`}>
          <Button
            onClick={handleViewAll}
            variant="outline"
            className={`w-full ${colors.footerBtn}`}
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
