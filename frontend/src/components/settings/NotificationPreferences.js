import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Volume2, VolumeX, Mail, Clock, Loader2, Smartphone, MessageSquare, Heart, Users, Camera, Calendar, ShoppingBag, AlertTriangle, CheckCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import axios from 'axios';
import logger from '../../utils/logger';

const API = process.env.REACT_APP_BACKEND_URL;

/**
 * NotificationPreferences - Manage all notification settings
 * Features:
 * - Push notification type toggles (likes, comments, follows, etc.)
 * - In-app sound settings
 * - Digest mode (batch notifications)
 * - Email notification preferences
 */
export const NotificationPreferences = ({ userId, textPrimaryClass, textSecondaryClass, borderClass, cardBgClass }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preferences, setPreferences] = useState({
    // Push notification types
    push_enabled: true,
    push_likes: true,
    push_comments: true,
    push_follows: true,
    push_mentions: true,
    push_tags: true,
    push_messages: true,
    push_bookings: true,
    push_purchases: true,
    push_live: true,
    push_alerts: true,
    // Sound settings
    sound_enabled: true,
    vibration_enabled: true,
    // Digest mode
    digest_enabled: false,
    digest_frequency: 'daily', // 'hourly', 'daily', 'weekly'
    digest_time: '09:00',
    // Email preferences
    email_digest: false,
    email_marketing: false,
    email_updates: true
  });
  
  useEffect(() => {
    if (userId) {
      fetchPreferences();
    }
  }, [userId]);
  
  const fetchPreferences = async () => {
    try {
      const response = await axios.get(`${API}/api/notifications/preferences?user_id=${userId}`);
      if (response.data) {
        setPreferences(prev => ({ ...prev, ...response.data }));
      }
    } catch (error) {
      // Default preferences if none exist
      logger.debug('Using default notification preferences');
    } finally {
      setLoading(false);
    }
  };
  
  const updatePreference = async (key, value) => {
    const updated = { ...preferences, [key]: value };
    setPreferences(updated);
    
    try {
      await axios.put(`${API}/api/notifications/preferences?user_id=${userId}`, {
        [key]: value
      });
    } catch (error) {
      // Revert on error
      setPreferences(preferences);
      toast.error('Failed to save preference');
    }
  };
  
  const saveAllPreferences = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/api/notifications/preferences?user_id=${userId}`, preferences);
      toast.success('Notification preferences saved');
    } catch (error) {
      toast.error('Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };
  
  // Group toggle - toggle all in a category
  const toggleCategory = (keys, value) => {
    const updated = { ...preferences };
    keys.forEach(key => {
      updated[key] = value;
    });
    setPreferences(updated);
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
      </div>
    );
  }
  
  // Notification type categories
  const pushCategories = [
    {
      title: 'Social',
      icon: Heart,
      color: 'text-pink-400',
      items: [
        { key: 'push_likes', label: 'Likes', desc: 'When someone likes your content' },
        { key: 'push_comments', label: 'Comments', desc: 'New comments on your posts' },
        { key: 'push_follows', label: 'Follows', desc: 'New followers' },
        { key: 'push_mentions', label: 'Mentions', desc: 'When you\'re mentioned' },
        { key: 'push_tags', label: 'Photo Tags', desc: 'When you\'re tagged in photos' }
      ]
    },
    {
      title: 'Messaging',
      icon: MessageSquare,
      color: 'text-blue-400',
      items: [
        { key: 'push_messages', label: 'Direct Messages', desc: 'New messages from friends' }
      ]
    },
    {
      title: 'Activity',
      icon: Camera,
      color: 'text-cyan-400',
      items: [
        { key: 'push_bookings', label: 'Bookings', desc: 'Session bookings and updates' },
        { key: 'push_purchases', label: 'Purchases', desc: 'Photo purchases and credits' },
        { key: 'push_live', label: 'Live Sessions', desc: 'When photographers go live' }
      ]
    },
    {
      title: 'Alerts',
      icon: AlertTriangle,
      color: 'text-yellow-400',
      items: [
        { key: 'push_alerts', label: 'Surf Alerts', desc: 'Surf condition alerts for saved spots' }
      ]
    }
  ];
  
  return (
    <div className="space-y-4">
      {/* Master Push Toggle */}
      <div className={`flex items-center justify-between p-4 rounded-lg bg-muted`}>
        <div className="flex items-center gap-3">
          {preferences.push_enabled ? (
            <Bell className="w-5 h-5 text-cyan-400" />
          ) : (
            <BellOff className="w-5 h-5 text-muted-foreground" />
          )}
          <div>
            <p className={textPrimaryClass}>Push Notifications</p>
            <p className={`text-xs ${textSecondaryClass}`}>
              {preferences.push_enabled ? 'Receiving notifications' : 'All notifications paused'}
            </p>
          </div>
        </div>
        <Switch
          checked={preferences.push_enabled}
          onCheckedChange={(checked) => updatePreference('push_enabled', checked)}
          data-testid="push-master-toggle"
        />
      </div>
      
      {/* Sound & Vibration */}
      <div className={`border ${borderClass} rounded-lg overflow-hidden`}>
        <div className={`px-4 py-3 bg-muted/50 ${borderClass} border-b`}>
          <p className={`font-medium ${textPrimaryClass}`}>Sound & Haptics</p>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {preferences.sound_enabled ? (
                <Volume2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <VolumeX className="w-4 h-4 text-muted-foreground" />
              )}
              <Label>Notification Sounds</Label>
            </div>
            <Switch
              checked={preferences.sound_enabled}
              onCheckedChange={(checked) => updatePreference('sound_enabled', checked)}
              data-testid="sound-toggle"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-purple-400" />
              <Label>Vibration</Label>
            </div>
            <Switch
              checked={preferences.vibration_enabled}
              onCheckedChange={(checked) => updatePreference('vibration_enabled', checked)}
              data-testid="vibration-toggle"
            />
          </div>
        </div>
      </div>
      
      {/* Push Notification Categories */}
      {preferences.push_enabled && (
        <div className="space-y-3">
          {pushCategories.map((category) => {
            const CategoryIcon = category.icon;
            const allEnabled = category.items.every(item => preferences[item.key]);
            
            return (
              <div key={category.title} className={`border ${borderClass} rounded-lg overflow-hidden`}>
                <button
                  onClick={() => toggleCategory(category.items.map(i => i.key), !allEnabled)}
                  className={`w-full px-4 py-3 flex items-center justify-between bg-muted/50 ${borderClass} border-b hover:bg-muted transition-colors`}
                >
                  <div className="flex items-center gap-2">
                    <CategoryIcon className={`w-4 h-4 ${category.color}`} />
                    <span className={`font-medium ${textPrimaryClass}`}>{category.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${textSecondaryClass}`}>
                      {allEnabled ? 'All on' : 'Some off'}
                    </span>
                    {allEnabled && <CheckCircle className="w-4 h-4 text-emerald-400" />}
                  </div>
                </button>
                <div className="p-4 space-y-3">
                  {category.items.map((item) => (
                    <div key={item.key} className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm">{item.label}</Label>
                        <p className={`text-xs ${textSecondaryClass}`}>{item.desc}</p>
                      </div>
                      <Switch
                        checked={preferences[item.key]}
                        onCheckedChange={(checked) => updatePreference(item.key, checked)}
                        data-testid={`${item.key}-toggle`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      
      {/* Digest Mode */}
      <div className={`border ${borderClass} rounded-lg overflow-hidden`}>
        <div className={`px-4 py-3 bg-muted/50 ${borderClass} border-b`}>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-orange-400" />
            <p className={`font-medium ${textPrimaryClass}`}>Digest Mode</p>
          </div>
          <p className={`text-xs ${textSecondaryClass} mt-1`}>
            Batch notifications instead of instant delivery
          </p>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <Label>Enable Digest</Label>
            <Switch
              checked={preferences.digest_enabled}
              onCheckedChange={(checked) => updatePreference('digest_enabled', checked)}
              data-testid="digest-toggle"
            />
          </div>
          
          {preferences.digest_enabled && (
            <>
              <div className="space-y-2">
                <Label className="text-sm">Frequency</Label>
                <div className="flex gap-2">
                  {['hourly', 'daily', 'weekly'].map((freq) => (
                    <button
                      key={freq}
                      onClick={() => updatePreference('digest_frequency', freq)}
                      className={`flex-1 py-2 rounded-lg text-sm capitalize transition-colors ${
                        preferences.digest_frequency === freq
                          ? 'bg-cyan-500 text-black'
                          : 'bg-muted hover:bg-muted/80'
                      }`}
                      data-testid={`digest-${freq}`}
                    >
                      {freq}
                    </button>
                  ))}
                </div>
              </div>
              
              {preferences.digest_frequency !== 'hourly' && (
                <div className="space-y-2">
                  <Label className="text-sm">Delivery Time</Label>
                  <select
                    value={preferences.digest_time}
                    onChange={(e) => updatePreference('digest_time', e.target.value)}
                    className="w-full p-2 rounded-lg bg-muted border border-border text-foreground"
                    data-testid="digest-time"
                  >
                    {['06:00', '09:00', '12:00', '15:00', '18:00', '21:00'].map((time) => (
                      <option key={time} value={time}>{time}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Email Preferences */}
      <div className={`border ${borderClass} rounded-lg overflow-hidden`}>
        <div className={`px-4 py-3 bg-muted/50 ${borderClass} border-b`}>
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-blue-400" />
            <p className={`font-medium ${textPrimaryClass}`}>Email Notifications</p>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Daily Digest Email</Label>
              <p className={`text-xs ${textSecondaryClass}`}>Summary of your activity</p>
            </div>
            <Switch
              checked={preferences.email_digest}
              onCheckedChange={(checked) => updatePreference('email_digest', checked)}
              data-testid="email-digest-toggle"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Product Updates</Label>
              <p className={`text-xs ${textSecondaryClass}`}>New features and improvements</p>
            </div>
            <Switch
              checked={preferences.email_updates}
              onCheckedChange={(checked) => updatePreference('email_updates', checked)}
              data-testid="email-updates-toggle"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Marketing</Label>
              <p className={`text-xs ${textSecondaryClass}`}>Promotions and offers</p>
            </div>
            <Switch
              checked={preferences.email_marketing}
              onCheckedChange={(checked) => updatePreference('email_marketing', checked)}
              data-testid="email-marketing-toggle"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationPreferences;
