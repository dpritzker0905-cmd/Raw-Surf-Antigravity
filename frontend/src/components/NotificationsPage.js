import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { getNotifications, markRead, markAllRead } from '../services/notificationService';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useNavigate } from 'react-router-dom';
import {
  Bell, Users, MessageCircle, UserPlus, Check, CheckCheck, Camera, Tag,
  Image as ImageIcon, CreditCard, Waves, Trophy, Calendar, X, Clock,
  ChevronRight, ChevronLeft, Settings, Shield
} from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getNotificationDeepLink } from '../utils/notificationDeepLinks';

// ── Theme colour tokens ───────────────────────────────────────────────────────
const getThemeColors = (theme) => {
  if (theme === 'light') return {
    pageBg:        'bg-gray-50',
    headerBg:      'bg-white/95',
    headerBorder:  'border-gray-200',
    title:         'text-gray-900',
    subtext:       'text-gray-500',
    tabActive:     'bg-yellow-500 text-black',
    tabInactive:   'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900',
    tabBadge:      'bg-yellow-500 text-black',
    arrowBtn:      'bg-white border-gray-300 text-gray-700 hover:bg-gray-100',
    itemUnread:    'bg-white hover:bg-blue-50/60 border-l-2 border-yellow-400 shadow-sm',
    itemRead:      'bg-white/60 hover:bg-gray-50',
    itemTitle:     'text-gray-900',
    itemTitleRead: 'text-gray-500',
    itemBody:      'text-gray-500',
    timeText:      'text-gray-400',
    chevron:       'text-gray-400 group-hover:text-gray-600',
    groupHeader:   'text-gray-400',
    emptyBg:       'bg-gray-100',
    emptyText:     'text-gray-500',
    emptySub:      'text-gray-400',
    settingsBtn:   'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
    markReadBtn:   'text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50',
    unreadDot:     'bg-yellow-400',
  };
  if (theme === 'beach') return {
    pageBg:        'bg-zinc-950',
    headerBg:      'bg-zinc-950/95',
    headerBorder:  'border-amber-900/30',
    title:         'text-amber-100',
    subtext:       'text-amber-400/60',
    tabActive:     'bg-amber-500 text-black',
    tabInactive:   'bg-zinc-800 text-amber-400/70 hover:bg-zinc-700 hover:text-amber-200',
    tabBadge:      'bg-amber-500 text-black',
    arrowBtn:      'bg-zinc-800 border-zinc-600 text-white hover:bg-zinc-700',
    itemUnread:    'bg-zinc-800/70 hover:bg-zinc-700/70 border-l-2 border-amber-400',
    itemRead:      'bg-zinc-800/30 hover:bg-zinc-800/50',
    itemTitle:     'text-amber-100',
    itemTitleRead: 'text-zinc-400',
    itemBody:      'text-zinc-400',
    timeText:      'text-zinc-500',
    chevron:       'text-zinc-600 group-hover:text-zinc-400',
    groupHeader:   'text-zinc-500',
    emptyBg:       'bg-zinc-800',
    emptyText:     'text-zinc-400',
    emptySub:      'text-zinc-500',
    settingsBtn:   'text-zinc-400 hover:text-amber-100 hover:bg-zinc-800',
    markReadBtn:   'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10',
    unreadDot:     'bg-amber-400',
  };
  // dark (default)
  return {
    pageBg:        'bg-zinc-950',
    headerBg:      'bg-zinc-950/95',
    headerBorder:  'border-zinc-800',
    title:         'text-white',
    subtext:       'text-gray-400',
    tabActive:     'bg-yellow-500 text-black',
    tabInactive:   'bg-zinc-800 text-gray-400 hover:bg-zinc-700 hover:text-white',
    tabBadge:      'bg-yellow-500 text-black',
    arrowBtn:      'bg-zinc-800 border-zinc-600 text-white hover:bg-zinc-700',
    itemUnread:    'bg-zinc-800/70 hover:bg-zinc-700/70 border-l-2 border-yellow-400',
    itemRead:      'bg-zinc-800/30 hover:bg-zinc-800/50',
    itemTitle:     'text-white',
    itemTitleRead: 'text-gray-400',
    itemBody:      'text-gray-400',
    timeText:      'text-gray-500',
    chevron:       'text-gray-600 group-hover:text-gray-400',
    groupHeader:   'text-gray-500',
    emptyBg:       'bg-zinc-800',
    emptyText:     'text-gray-400',
    emptySub:      'text-gray-500',
    settingsBtn:   'text-gray-400 hover:text-white hover:bg-zinc-800',
    markReadBtn:   'text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10',
    unreadDot:     'bg-yellow-400',
  };
};

// ── Notification type configs ─────────────────────────────────────────────────
const NOTIFICATION_CONFIG = {
  session_join:                    { icon: Users,         color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  session_joined:                  { icon: Users,         color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  session_reminder:                { icon: Clock,         color: 'text-blue-400',    bgColor: 'bg-blue-500/20',    category: 'sessions' },
  booking_cancelled:               { icon: X,             color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'sessions' },
  booking_updated:                 { icon: Calendar,      color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'sessions' },
  booking_confirmed:               { icon: Calendar,      color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  session_booked:                  { icon: Check,         color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  booking_confirmation:            { icon: Check,         color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  booking_request:                 { icon: Calendar,      color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'sessions' },
  booking_invite:                  { icon: Users,         color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'sessions' },
  booking_participant_joined:      { icon: Users,         color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  lineup_join:                     { icon: Users,         color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  lineup_removed:                  { icon: X,             color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'sessions' },
  lineup_cancelled:                { icon: X,             color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'sessions' },
  live_session:                    { icon: Camera,        color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'sessions' },
  join_request:                    { icon: Users,         color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'sessions' },
  invite_accepted:                 { icon: Check,         color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  crew_session_invite:             { icon: Users,         color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'sessions' },
  dispatch_request:                { icon: Camera,        color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'sessions' },
  dispatch_accepted:               { icon: Check,         color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  dispatch_arrived:                { icon: Camera,        color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'sessions' },
  dispatch_declined:               { icon: X,             color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'sessions' },
  crew_payment_reminder:           { icon: CreditCard,    color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'sessions' },
  payment_window_expired:          { icon: CreditCard,    color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'payments' },
  payment_expiry_reminder:         { icon: Clock,         color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'payments' },
  payment_request:                 { icon: CreditCard,    color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'payments' },
  payment_received:                { icon: CreditCard,    color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  booking_payment:                 { icon: CreditCard,    color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  booking_payment_received:        { icon: CreditCard,    color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  booking_earning:                 { icon: CreditCard,    color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  escrow_auto_released:            { icon: CreditCard,    color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  escrow_released:                 { icon: CreditCard,    color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  escrow_released_to_photographer: { icon: CreditCard,    color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  credit_refund:                   { icon: CreditCard,    color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'payments' },
  booking_refund:                  { icon: CreditCard,    color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'payments' },
  crew_payment_request:            { icon: CreditCard,    color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'payments' },
  lineup_payment_due:              { icon: CreditCard,    color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'payments' },
  tip_received:                    { icon: CreditCard,    color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  gallery_sale:                    { icon: CreditCard,    color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  gallery_purchase:                { icon: CreditCard,    color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'payments' },
  photo_tagged:                    { icon: Tag,           color: 'text-purple-400',  bgColor: 'bg-purple-500/20',  category: 'photos' },
  gallery_item:                    { icon: ImageIcon,     color: 'text-pink-400',    bgColor: 'bg-pink-500/20',    category: 'photos' },
  selection_auto_completed:        { icon: Check,         color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'photos' },
  selection_forfeited:             { icon: X,             color: 'text-gray-400',    bgColor: 'bg-gray-500/20',    category: 'photos' },
  selection_expiry_warning:        { icon: Clock,         color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'photos' },
  photo_purchased:                 { icon: ImageIcon,     color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'photos' },
  photo_gifted:                    { icon: ImageIcon,     color: 'text-pink-400',    bgColor: 'bg-pink-500/20',    category: 'photos' },
  live_photo_purchase:             { icon: ImageIcon,     color: 'text-green-400',   bgColor: 'bg-green-500/20',   category: 'photos' },
  new_follower:                    { icon: UserPlus,      color: 'text-yellow-400',  bgColor: 'bg-yellow-500/20',  category: 'social' },
  new_message:                     { icon: MessageCircle, color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'social' },
  message_reaction:                { icon: MessageCircle, color: 'text-pink-400',    bgColor: 'bg-pink-500/20',    category: 'social' },
  mention:                         { icon: Tag,           color: 'text-purple-400',  bgColor: 'bg-purple-500/20',  category: 'social' },
  badge_earned:                    { icon: Trophy,        color: 'text-yellow-400',  bgColor: 'bg-yellow-500/20',  category: 'social' },
  shaka_received:                  { icon: Trophy,        color: 'text-yellow-400',  bgColor: 'bg-yellow-500/20',  category: 'social' },
  collaboration_invite:            { icon: Users,         color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'social' },
  collaboration_request:           { icon: Users,         color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'social' },
  crew_invite:                     { icon: Users,         color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'social' },
  friend_invite:                   { icon: UserPlus,      color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'social' },
  surf_alert:                      { icon: Waves,         color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'alerts' },
  grom_spending_alert:             { icon: CreditCard,    color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'alerts' },
  grom_link_request:               { icon: Users,         color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'alerts' },
  new_pro_application:             { icon: UserPlus,      color: 'text-yellow-400',  bgColor: 'bg-yellow-500/20',  category: 'admin' },
  verification_approved:           { icon: Check,         color: 'text-emerald-400', bgColor: 'bg-emerald-500/20', category: 'admin' },
  verification_rejected:           { icon: X,             color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'admin' },
  user_reported:                   { icon: Bell,          color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'admin' },
  content_flagged:                 { icon: Bell,          color: 'text-amber-400',   bgColor: 'bg-amber-500/20',   category: 'admin' },
  support_ticket:                  { icon: MessageCircle, color: 'text-cyan-400',    bgColor: 'bg-cyan-500/20',    category: 'admin' },
  system_alert:                    { icon: Bell,          color: 'text-red-400',     bgColor: 'bg-red-500/20',     category: 'admin' },
  default:                         { icon: Bell,          color: 'text-gray-400',    bgColor: 'bg-gray-500/20',    category: 'social' },
};

const BASE_TABS = [
  { id: 'all',      label: 'All',      icon: Bell,        color: 'text-white' },
  { id: 'alerts',   label: 'Alerts',   icon: Waves,       color: 'text-cyan-400' },
  { id: 'sessions', label: 'Sessions', icon: Camera,      color: 'text-emerald-400' },
  { id: 'payments', label: 'Payments', icon: CreditCard,  color: 'text-green-400' },
  { id: 'photos',   label: 'Photos',   icon: ImageIcon,   color: 'text-purple-400' },
  { id: 'social',   label: 'Social',   icon: Users,       color: 'text-yellow-400' },
];
const ADMIN_TAB = { id: 'admin', label: 'Admin', icon: Shield, color: 'text-red-400' };

export const NotificationsPage = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const colors = useMemo(() => getThemeColors(theme), [theme]);

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');

  const isAdmin = user?.is_admin || user?.role === 'admin' || user?.role === 'Admin';
  const TABS = useMemo(() => isAdmin ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS, [isAdmin]);

  const tabsContainerRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow]   = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  const updateArrowVisibility = useCallback(() => {
    const c = tabsContainerRef.current;
    if (!c) return;
    setShowLeftArrow(c.scrollLeft > 10);
    setShowRightArrow(c.scrollLeft < c.scrollWidth - c.clientWidth - 10);
  }, []);

  useEffect(() => {
    updateArrowVisibility();
    const c = tabsContainerRef.current;
    if (c) c.addEventListener('scroll', updateArrowVisibility);
    window.addEventListener('resize', updateArrowVisibility);
    return () => {
      if (c) c.removeEventListener('scroll', updateArrowVisibility);
      window.removeEventListener('resize', updateArrowVisibility);
    };
  }, [updateArrowVisibility]);

  const scrollTabs = (direction) => {
    const c = tabsContainerRef.current;
    if (!c) return;
    c.scrollTo({ left: c.scrollLeft + (direction === 'left' ? -150 : 150), behavior: 'smooth' });
    setTimeout(updateArrowVisibility, 350);
  };

  useEffect(() => { if (user?.id) fetchNotifications(); }, [user?.id]);

  const fetchNotifications = async () => {
    try {
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

  const groupedNotifications = useMemo(() => {
    const groups = { today: [], yesterday: [], thisWeek: [], older: [] };
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo   = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
    filteredNotifications.forEach(n => {
      const d = new Date(n.created_at);
      if (d >= today)     groups.today.push(n);
      else if (d >= yesterday) groups.yesterday.push(n);
      else if (d >= weekAgo)   groups.thisWeek.push(n);
      else                     groups.older.push(n);
    });
    return groups;
  }, [filteredNotifications]);

  const unreadCounts = useMemo(() => {
    const counts = { all: 0, alerts: 0, sessions: 0, payments: 0, photos: 0, social: 0, admin: 0 };
    notifications.forEach(n => {
      if (!n.is_read) {
        counts.all++;
        const config = NOTIFICATION_CONFIG[n.type] || NOTIFICATION_CONFIG.default;
        if (counts[config.category] !== undefined) counts[config.category]++;
      }
    });
    return counts;
  }, [notifications]);

  const handleNotificationClick = useCallback(async (notification) => {
    if (!notification.is_read) {
      try {
        await markRead(notification.id);
        setNotifications(prev => prev.map(n =>
          n.id === notification.id ? { ...n, is_read: true } : n
        ));
      } catch (error) {
        logger.error('Failed to mark as read:', error);
      }
    }
    const deepLink = getNotificationDeepLink(notification);
    if (deepLink) {
      if (deepLink.state) navigate(deepLink.route, { state: deepLink.state });
      else navigate(deepLink.route);
    }
  }, [navigate]);

  const handleMarkAllRead = async () => {
    try {
      await markAllRead(user.id);
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
      toast.success('All notifications marked as read');
    } catch {
      toast.error('Failed to mark all as read');
    }
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const diffMs   = Date.now() - date;
    const diffMins  = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    if (diffMins < 1)  return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  // ── Sub-components ──────────────────────────────────────────────────────────
  const NotificationItem = ({ notification }) => {
    const config = NOTIFICATION_CONFIG[notification.type] || NOTIFICATION_CONFIG.default;
    const Icon = config.icon;
    const isClickable = !!getNotificationDeepLink(notification);

    return (
      <div
        onClick={() => handleNotificationClick(notification)}
        className={`flex items-start gap-3 p-4 rounded-xl transition-all group ${
          isClickable ? 'cursor-pointer' : 'cursor-default'
        } ${notification.is_read ? colors.itemRead : colors.itemUnread}`}
      >
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${config.bgColor}`}>
          <Icon className={`w-5 h-5 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`font-medium text-sm ${notification.is_read ? colors.itemTitleRead : colors.itemTitle}`}>
              {notification.title}
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`text-xs ${colors.timeText}`}>{formatTime(notification.created_at)}</span>
              {!notification.is_read && (
                <div className={`w-2 h-2 rounded-full ${colors.unreadDot}`} />
              )}
            </div>
          </div>
          {notification.body && (
            <p className={`text-sm ${colors.itemBody} mt-1 line-clamp-2`}>{notification.body}</p>
          )}
        </div>
        {isClickable && (
          <ChevronRight className={`w-4 h-4 ${colors.chevron} transition-colors flex-shrink-0 mt-1`} />
        )}
      </div>
    );
  };

  const NotificationGroup = ({ title, notifications: items }) => {
    if (!items.length) return null;
    return (
      <div className="mb-6">
        <h3 className={`text-xs font-semibold ${colors.groupHeader} uppercase tracking-wider mb-3 px-1`}>
          {title}
        </h3>
        <div className="space-y-2">
          {items.map(n => <NotificationItem key={n.id} notification={n} />)}
        </div>
      </div>
    );
  };

  const EmptyState = () => {
    const tabConfig = TABS.find(t => t.id === activeTab);
    const Icon = tabConfig?.icon || Bell;
    return (
      <div className="text-center py-16">
        <div className={`w-16 h-16 mx-auto mb-4 rounded-full ${colors.emptyBg} flex items-center justify-center`}>
          <Icon className={`w-8 h-8 ${tabConfig?.color || colors.subtext}`} />
        </div>
        <p className={`${colors.emptyText} font-medium`}>
          No {activeTab === 'all' ? '' : activeTab + ' '}notifications
        </p>
        <p className={`${colors.emptySub} text-sm mt-1`}>
          {activeTab === 'alerts'   && 'Surf alert notifications will appear here'}
          {activeTab === 'sessions' && 'Session activity will appear here'}
          {activeTab === 'payments' && 'Payment updates will appear here'}
          {activeTab === 'photos'   && 'Photo tags and gallery updates will appear here'}
          {activeTab === 'social'   && 'Followers, messages, and achievements will appear here'}
          {activeTab === 'admin'    && 'Pro applications, reports, and system alerts will appear here'}
          {activeTab === 'all'      && "You're all caught up!"}
        </p>
      </div>
    );
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center h-64 ${colors.pageBg} min-h-screen`}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${colors.pageBg} pb-24 md:pb-8`}>
      {/* ── Sticky Header ── */}
      <div className={`sticky top-0 z-10 ${colors.headerBg} backdrop-blur-sm border-b ${colors.headerBorder}`}>
        <div className="px-4 py-4 max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 flex items-center justify-center">
                <Bell className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <h1 className={`text-xl font-bold ${colors.title}`}>Notifications</h1>
                {unreadCounts.all > 0 && (
                  <p className={`text-sm ${colors.subtext}`}>{unreadCounts.all} unread</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {unreadCounts.all > 0 && (
                <Button onClick={handleMarkAllRead} variant="ghost" size="sm" className={colors.markReadBtn}>
                  <CheckCheck className="w-4 h-4 mr-1" />
                  <span className="hidden sm:inline">Mark all read</span>
                </Button>
              )}
              <Button
                onClick={() => navigate('/settings')}
                variant="ghost"
                size="icon"
                className={colors.settingsBtn}
                title="Notification Settings"
              >
                <Settings className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* ── Tabs with Arrow Navigation ── */}
          <div className="relative flex items-center">
            <button
              onClick={() => scrollTabs('left')}
              className={`flex-shrink-0 w-8 h-8 rounded-full ${colors.arrowBtn} border shadow-lg flex items-center justify-center transition-all mr-2 ${
                showLeftArrow ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
              data-testid="notif-tabs-scroll-left"
              aria-label="Scroll tabs left"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div
              ref={tabsContainerRef}
              className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide scroll-smooth flex-1"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {TABS.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                const count = unreadCounts[tab.id];
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                      isActive ? colors.tabActive : colors.tabInactive
                    }`}
                    data-testid={`notif-tab-${tab.id}`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                    {count > 0 && (
                      <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold flex items-center justify-center ${
                        isActive ? 'bg-black/20 text-black' : colors.tabBadge
                      }`}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => scrollTabs('right')}
              className={`flex-shrink-0 w-8 h-8 rounded-full ${colors.arrowBtn} border shadow-lg flex items-center justify-center transition-all ml-2 ${
                showRightArrow ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
              data-testid="notif-tabs-scroll-right"
              aria-label="Scroll tabs right"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="px-4 py-4 max-w-2xl mx-auto">
        {filteredNotifications.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <NotificationGroup title="Today"     notifications={groupedNotifications.today} />
            <NotificationGroup title="Yesterday" notifications={groupedNotifications.yesterday} />
            <NotificationGroup title="This Week" notifications={groupedNotifications.thisWeek} />
            <NotificationGroup title="Older"     notifications={groupedNotifications.older} />
          </>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
