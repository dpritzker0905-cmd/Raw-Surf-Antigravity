import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  Bell, Users, MessageCircle, UserPlus, Check, CheckCheck, Camera, Tag, 
  Image as ImageIcon, CreditCard, Waves, Trophy, Calendar, X, Clock,
  ChevronRight, ChevronLeft, Trash2, Settings, BellOff, Filter, Shield
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import logger from '../utils/logger';
import { getNotificationDeepLink } from '../utils/notificationDeepLinks';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Notification type configurations
const NOTIFICATION_CONFIG = {
  // Sessions & Bookings
  session_join: { 
    icon: Users, 
    color: 'text-emerald-400', 
    bgColor: 'bg-emerald-500/20',
    category: 'sessions' 
  },
  session_reminder: { 
    icon: Clock, 
    color: 'text-blue-400', 
    bgColor: 'bg-blue-500/20',
    category: 'sessions' 
  },
  booking_cancelled: { 
    icon: X, 
    color: 'text-red-400', 
    bgColor: 'bg-red-500/20',
    category: 'sessions' 
  },
  booking_updated: { 
    icon: Calendar, 
    color: 'text-amber-400', 
    bgColor: 'bg-amber-500/20',
    category: 'sessions' 
  },
  booking_confirmed: { 
    icon: Calendar, 
    color: 'text-emerald-400', 
    bgColor: 'bg-emerald-500/20',
    category: 'sessions' 
  },
  session_booked: { 
    icon: Check, 
    color: 'text-emerald-400', 
    bgColor: 'bg-emerald-500/20',
    category: 'sessions' 
  },
  booking_confirmation: { 
    icon: Check, 
    color: 'text-emerald-400', 
    bgColor: 'bg-emerald-500/20',
    category: 'sessions' 
  },
  booking_request: { 
    icon: Calendar, 
    color: 'text-amber-400', 
    bgColor: 'bg-amber-500/20',
    category: 'sessions' 
  },
  dispatch_request: { 
    icon: Camera, 
    color: 'text-amber-400', 
    bgColor: 'bg-amber-500/20',
    category: 'sessions' 
  },
  dispatch_accepted: { 
    icon: Check, 
    color: 'text-emerald-400', 
    bgColor: 'bg-emerald-500/20',
    category: 'sessions' 
  },
  dispatch_arrived: { 
    icon: Camera, 
    color: 'text-emerald-400', 
    bgColor: 'bg-emerald-500/20',
    category: 'sessions' 
  },
  crew_payment_reminder: { 
    icon: CreditCard, 
    color: 'text-amber-400', 
    bgColor: 'bg-amber-500/20',
    category: 'sessions' 
  },
  
  // Payments & Credits
  payment_window_expired: { 
    icon: CreditCard, 
    color: 'text-red-400', 
    bgColor: 'bg-red-500/20',
    category: 'payments' 
  },
  payment_expiry_reminder: { 
    icon: Clock, 
    color: 'text-amber-400', 
    bgColor: 'bg-amber-500/20',
    category: 'payments' 
  },
  escrow_auto_released: { 
    icon: CreditCard, 
    color: 'text-green-400', 
    bgColor: 'bg-green-500/20',
    category: 'payments' 
  },
  escrow_released_to_photographer: { 
    icon: CreditCard, 
    color: 'text-green-400', 
    bgColor: 'bg-green-500/20',
    category: 'payments' 
  },
  credit_refund: { 
    icon: CreditCard, 
    color: 'text-cyan-400', 
    bgColor: 'bg-cyan-500/20',
    category: 'payments' 
  },
  
  // Photos & Gallery
  photo_tagged: { 
    icon: Tag, 
    color: 'text-purple-400', 
    bgColor: 'bg-purple-500/20',
    category: 'photos' 
  },
  gallery_item: { 
    icon: ImageIcon, 
    color: 'text-pink-400', 
    bgColor: 'bg-pink-500/20',
    category: 'photos' 
  },
  selection_auto_completed: { 
    icon: Check, 
    color: 'text-emerald-400', 
    bgColor: 'bg-emerald-500/20',
    category: 'photos' 
  },
  selection_forfeited: { 
    icon: X, 
    color: 'text-gray-400', 
    bgColor: 'bg-gray-500/20',
    category: 'photos' 
  },
  selection_expiry_warning: { 
    icon: Clock, 
    color: 'text-amber-400', 
    bgColor: 'bg-amber-500/20',
    category: 'photos' 
  },
  
  // Social
  new_follower: { 
    icon: UserPlus, 
    color: 'text-yellow-400', 
    bgColor: 'bg-yellow-500/20',
    category: 'social' 
  },
  new_message: { 
    icon: MessageCircle, 
    color: 'text-cyan-400', 
    bgColor: 'bg-cyan-500/20',
    category: 'social' 
  },
  badge_earned: { 
    icon: Trophy, 
    color: 'text-yellow-400', 
    bgColor: 'bg-yellow-500/20',
    category: 'social' 
  },
  
  // Surf Alerts - separate category
  surf_alert: { 
    icon: Waves, 
    color: 'text-cyan-400', 
    bgColor: 'bg-cyan-500/20',
    category: 'alerts' 
  },
  
  // Admin notifications
  new_pro_application: {
    icon: UserPlus,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    category: 'admin'
  },
  verification_approved: {
    icon: Check,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/20',
    category: 'admin'
  },
  verification_rejected: {
    icon: X,
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    category: 'admin'
  },
  user_reported: {
    icon: Bell,
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    category: 'admin'
  },
  content_flagged: {
    icon: Bell,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/20',
    category: 'admin'
  },
  support_ticket: {
    icon: MessageCircle,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/20',
    category: 'admin'
  },
  system_alert: {
    icon: Bell,
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    category: 'admin'
  },
  
  // Default
  default: { 
    icon: Bell, 
    color: 'text-gray-400', 
    bgColor: 'bg-gray-500/20',
    category: 'social' 
  }
};

// Tab configurations - base tabs visible to all users
const BASE_TABS = [
  { id: 'all', label: 'All', icon: Bell, color: 'text-white' },
  { id: 'alerts', label: 'Alerts', icon: Waves, color: 'text-cyan-400' },
  { id: 'sessions', label: 'Sessions', icon: Camera, color: 'text-emerald-400' },
  { id: 'payments', label: 'Payments', icon: CreditCard, color: 'text-green-400' },
  { id: 'photos', label: 'Photos', icon: ImageIcon, color: 'text-purple-400' },
  { id: 'social', label: 'Social', icon: Users, color: 'text-yellow-400' },
];

// Admin tab - only shown to admin users
const ADMIN_TAB = { id: 'admin', label: 'Admin', icon: Shield, color: 'text-red-400' };

export const NotificationsPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  
  // Determine if user is admin
  const isAdmin = user?.is_admin || user?.role === 'admin' || user?.role === 'Admin';
  
  // Dynamic tabs - add Admin tab only for admin users
  const TABS = useMemo(() => {
    if (isAdmin) {
      return [...BASE_TABS, ADMIN_TAB];
    }
    return BASE_TABS;
  }, [isAdmin]);
  
  // Tabs carousel refs and state
  const tabsContainerRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  // Update arrow visibility on scroll
  const updateArrowVisibility = useCallback(() => {
    const container = tabsContainerRef.current;
    if (!container) return;
    
    const { scrollLeft, scrollWidth, clientWidth } = container;
    setShowLeftArrow(scrollLeft > 10);
    setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
  }, []);

  // Initialize arrow visibility on mount
  useEffect(() => {
    updateArrowVisibility();
    const container = tabsContainerRef.current;
    if (container) {
      container.addEventListener('scroll', updateArrowVisibility);
      window.addEventListener('resize', updateArrowVisibility);
    }
    return () => {
      if (container) {
        container.removeEventListener('scroll', updateArrowVisibility);
      }
      window.removeEventListener('resize', updateArrowVisibility);
    };
  }, [updateArrowVisibility]);

  // Scroll tabs left/right
  const scrollTabs = (direction) => {
    const container = tabsContainerRef.current;
    if (!container) return;
    
    const scrollAmount = 150;
    const newScrollLeft = direction === 'left' 
      ? container.scrollLeft - scrollAmount 
      : container.scrollLeft + scrollAmount;
    
    container.scrollTo({
      left: newScrollLeft,
      behavior: 'smooth'
    });
    
    // Update arrow visibility after scroll animation
    setTimeout(updateArrowVisibility, 350);
  };

  useEffect(() => {
    if (user?.id) {
      fetchNotifications();
    }
  }, [user?.id]);

  const fetchNotifications = async () => {
    try {
      const response = await axios.get(`${API}/notifications/${user.id}`);
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

  // Group notifications by date
  const groupedNotifications = useMemo(() => {
    const groups = {
      today: [],
      yesterday: [],
      thisWeek: [],
      older: []
    };
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    filteredNotifications.forEach(notification => {
      const date = new Date(notification.created_at);
      if (date >= today) {
        groups.today.push(notification);
      } else if (date >= yesterday) {
        groups.yesterday.push(notification);
      } else if (date >= weekAgo) {
        groups.thisWeek.push(notification);
      } else {
        groups.older.push(notification);
      }
    });
    
    return groups;
  }, [filteredNotifications]);

  // Count unread per tab
  const unreadCounts = useMemo(() => {
    const counts = { all: 0, alerts: 0, sessions: 0, payments: 0, photos: 0, social: 0, admin: 0 };
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

  const handleMarkAsRead = async (notificationId) => {
    try {
      await axios.post(`${API}/notifications/${notificationId}/read`);
      setNotifications(notifications.map(n => 
        n.id === notificationId ? { ...n, is_read: true } : n
      ));
    } catch (error) {
      logger.error('Failed to mark as read:', error);
    }
  };

  // Handle notification click - mark as read and navigate to deep link
  const handleNotificationClick = useCallback(async (notification) => {
    // Mark as read first
    if (!notification.is_read) {
      try {
        await axios.post(`${API}/notifications/${notification.id}/read`);
        setNotifications(prev => prev.map(n => 
          n.id === notification.id ? { ...n, is_read: true } : n
        ));
      } catch (error) {
        logger.error('Failed to mark as read:', error);
      }
    }
    
    // Get deep link and navigate
    const deepLink = getNotificationDeepLink(notification);
    if (deepLink) {
      if (deepLink.state) {
        navigate(deepLink.route, { state: deepLink.state });
      } else {
        navigate(deepLink.route);
      }
    }
  }, [navigate]);

  const handleMarkAllRead = async () => {
    try {
      await axios.post(`${API}/notifications/${user.id}/read-all`);
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
      toast.success('All notifications marked as read');
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
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  const NotificationItem = ({ notification }) => {
    const config = NOTIFICATION_CONFIG[notification.type] || NOTIFICATION_CONFIG.default;
    const Icon = config.icon;
    const deepLink = getNotificationDeepLink(notification);
    const isClickable = !!deepLink;
    
    return (
      <div
        onClick={() => handleNotificationClick(notification)}
        className={`flex items-start gap-3 p-4 rounded-xl transition-all ${
          isClickable ? 'cursor-pointer' : 'cursor-default'
        } group ${
          notification.is_read 
            ? 'bg-zinc-800/30 hover:bg-zinc-800/50' 
            : 'bg-zinc-800/70 hover:bg-zinc-700/70 border-l-2 border-yellow-400'
        }`}
      >
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${config.bgColor}`}>
          <Icon className={`w-5 h-5 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`font-medium text-sm ${notification.is_read ? 'text-gray-400' : 'text-white'}`}>
              {notification.title}
            </p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-gray-500">{formatTime(notification.created_at)}</span>
              {!notification.is_read && (
                <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
              )}
            </div>
          </div>
          {notification.body && (
            <p className="text-sm text-gray-400 mt-1 line-clamp-2">{notification.body}</p>
          )}
        </div>
        {isClickable && (
          <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors flex-shrink-0 mt-1" />
        )}
      </div>
    );
  };

  const NotificationGroup = ({ title, notifications }) => {
    if (notifications.length === 0) return null;
    
    return (
      <div className="mb-6">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">
          {title}
        </h3>
        <div className="space-y-2">
          {notifications.map(notification => (
            <NotificationItem key={notification.id} notification={notification} />
          ))}
        </div>
      </div>
    );
  };

  const EmptyState = () => {
    const activeTabConfig = TABS.find(t => t.id === activeTab);
    const Icon = activeTabConfig?.icon || Bell;
    
    return (
      <div className="text-center py-16">
        <div className={`w-16 h-16 mx-auto mb-4 rounded-full bg-zinc-800 flex items-center justify-center`}>
          <Icon className={`w-8 h-8 ${activeTabConfig?.color || 'text-gray-400'}`} />
        </div>
        <p className="text-gray-400 font-medium">No {activeTab === 'all' ? '' : activeTab + ' '}notifications</p>
        <p className="text-gray-500 text-sm mt-1">
          {activeTab === 'alerts' && "Surf alert notifications will appear here"}
          {activeTab === 'sessions' && "Session activity will appear here"}
          {activeTab === 'payments' && "Payment updates will appear here"}
          {activeTab === 'photos' && "Photo tags and gallery updates will appear here"}
          {activeTab === 'social' && "Followers, messages, and achievements will appear here"}
          {activeTab === 'admin' && "Pro applications, reports, and system alerts will appear here"}
          {activeTab === 'all' && "You're all caught up!"}
        </p>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 pb-24 md:pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
        <div className="px-4 py-4 max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 flex items-center justify-center">
                <Bell className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Notifications</h1>
                {unreadCounts.all > 0 && (
                  <p className="text-sm text-gray-400">{unreadCounts.all} unread</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {unreadCounts.all > 0 && (
                <Button
                  onClick={handleMarkAllRead}
                  variant="ghost"
                  size="sm"
                  className="text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10"
                >
                  <CheckCheck className="w-4 h-4 mr-1" />
                  <span className="hidden sm:inline">Mark all read</span>
                </Button>
              )}
              <Button
                onClick={() => navigate('/settings')}
                variant="ghost"
                size="icon"
                className="text-gray-400 hover:text-white hover:bg-zinc-800"
                title="Notification Settings"
              >
                <Settings className="w-5 h-5" />
              </Button>
            </div>
          </div>
          
          {/* Tabs with Arrow Navigation */}
          <div className="relative flex items-center">
            {/* Left Arrow - always show when scrolled */}
            <button
              onClick={() => scrollTabs('left')}
              className={`flex-shrink-0 w-8 h-8 rounded-full bg-zinc-800 border border-zinc-600 shadow-lg flex items-center justify-center text-white hover:bg-zinc-700 transition-all mr-2 ${
                showLeftArrow ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
              data-testid="notif-tabs-scroll-left"
              aria-label="Scroll tabs left"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            
            {/* Tabs Container */}
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
                      isActive 
                        ? 'bg-yellow-500 text-black' 
                        : 'bg-zinc-800 text-gray-400 hover:bg-zinc-700 hover:text-white'
                    }`}
                    data-testid={`notif-tab-${tab.id}`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                    {count > 0 && (
                      <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold flex items-center justify-center ${
                        isActive ? 'bg-black/20 text-black' : 'bg-yellow-500 text-black'
                      }`}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            
            {/* Right Arrow - always show when more content */}
            <button
              onClick={() => scrollTabs('right')}
              className={`flex-shrink-0 w-8 h-8 rounded-full bg-zinc-800 border border-zinc-600 shadow-lg flex items-center justify-center text-white hover:bg-zinc-700 transition-all ml-2 ${
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

      {/* Content */}
      <div className="px-4 py-4 max-w-2xl mx-auto">
        {filteredNotifications.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <NotificationGroup title="Today" notifications={groupedNotifications.today} />
            <NotificationGroup title="Yesterday" notifications={groupedNotifications.yesterday} />
            <NotificationGroup title="This Week" notifications={groupedNotifications.thisWeek} />
            <NotificationGroup title="Older" notifications={groupedNotifications.older} />
          </>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
