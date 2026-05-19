import React from 'react';
import { MessageSquare, Heart, UserPlus, Camera, CalendarCheck,
  DollarSign, Mail, VolumeX, Volume2, Activity, Clock
} from 'lucide-react';

/**
 * NotificationSection -- Extracted from Settings.js
 * Handles all push notification, email, sound/haptics, quiet hours,
 * and digest mode toggles.
 */
export const NotificationSection = ({
  notifPrefs,
  notifLoading,
  updateNotifPref,
  isPhotographer,
  isGromParent,
  textPrimaryClass,
  textSecondaryClass,
  borderClass,
}) => {
  const ToggleButton = ({ enabled, onClick, disabled, color = 'bg-cyan-400', testId }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-12 h-6 rounded-full transition-colors ${
        enabled ? color : 'bg-zinc-600'
      }`}
      data-testid={testId}
    >
      <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
        enabled ? 'translate-x-6' : 'translate-x-0.5'
      }`} />
    </button>
  );

  const NotifRow = ({ icon: Icon, label, description, prefKey, color = 'bg-cyan-400', testId }) => (
    <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <div>
          <span className={textPrimaryClass}>{label}</span>
          <p className={`text-xs ${textSecondaryClass}`}>{description}</p>
        </div>
      </div>
      <ToggleButton
        enabled={notifPrefs[prefKey]}
        onClick={() => updateNotifPref(prefKey, !notifPrefs[prefKey])}
        disabled={notifLoading}
        color={color}
        testId={testId}
      />
    </div>
  );

  return (
    <>
      {/* Push Notifications Header */}
      <div className="flex items-center gap-2 mb-2">
        <Volume2 className="w-4 h-4 text-cyan-400" />
        <span className={`text-sm font-medium ${textSecondaryClass}`}>Push Notifications</span>
      </div>
      
      <NotifRow icon={MessageSquare} label="Messages" description="New messages from other users" prefKey="push_messages" testId="toggle-push-messages" />
      <NotifRow icon={Heart} label="Reactions" description="When someone reacts to your posts" prefKey="push_reactions" testId="toggle-push-reactions" />
      <NotifRow icon={UserPlus} label="New Followers" description="When someone follows you" prefKey="push_follows" testId="toggle-push-follows" />
      
      {/* Dispatch Alerts (for photographers) */}
      {isPhotographer && (
        <NotifRow icon={Camera} label="Photo Requests" description="Dispatch alerts from surfers" prefKey="push_dispatch" testId="toggle-push-dispatch" />
      )}
      
      <NotifRow icon={CalendarCheck} label="Bookings" description="Session confirmations & updates" prefKey="push_bookings" testId="toggle-push-bookings" />
      
      {/* Payments - NOT shown to Grom Parents (no commerce) */}
      {!isGromParent && (
        <NotifRow icon={DollarSign} label="Payments" description="Tips, purchases & payouts" prefKey="push_payments" testId="toggle-push-payments" />
      )}
      
      {/* Email Preferences Header */}
      <div className="flex items-center gap-2 mt-4 mb-2">
        <Mail className="w-4 h-4 text-cyan-400" />
        <span className={`text-sm font-medium ${textSecondaryClass}`}>Email Notifications</span>
      </div>
      
      <NotifRow icon={Mail} label="Weekly Digest" description="Summary of activity & highlights" prefKey="email_digest" testId="toggle-email-digest" />
      
      {/* Quiet Hours */}
      <div className="mt-4">
        <div className={`flex items-center justify-between py-2`}>
          <div className="flex items-center gap-2">
            <VolumeX className="w-4 h-4 text-muted-foreground" />
            <div>
              <span className={textPrimaryClass}>Quiet Hours</span>
              <p className={`text-xs ${textSecondaryClass}`}>Pause push notifications</p>
            </div>
          </div>
          <ToggleButton
            enabled={notifPrefs.quiet_hours_enabled}
            onClick={() => updateNotifPref('quiet_hours_enabled', !notifPrefs.quiet_hours_enabled)}
            disabled={notifLoading}
            testId="toggle-quiet-hours"
          />
        </div>
        {notifPrefs.quiet_hours_enabled && (
          <div className={`flex items-center gap-2 mt-2 pl-6 ${textSecondaryClass}`}>
            <input aria-label="Time"
              type="time"
              value={notifPrefs.quiet_hours_start}
              onChange={(e) => updateNotifPref('quiet_hours_start', e.target.value)}
              className="px-2 py-1 rounded text-sm bg-muted text-foreground"
            />
            <span>to</span>
            <input aria-label="Time"
              type="time"
              value={notifPrefs.quiet_hours_end}
              onChange={(e) => updateNotifPref('quiet_hours_end', e.target.value)}
              className="px-2 py-1 rounded text-sm bg-muted text-foreground"
            />
          </div>
        )}
      </div>
      
      {/* Sound & Haptics Section */}
      <div className="flex items-center gap-2 mt-4 mb-2">
        <Volume2 className="w-4 h-4 text-emerald-400" />
        <span className={`text-sm font-medium ${textSecondaryClass}`}>Sound & Haptics</span>
      </div>
      
      <NotifRow icon={Volume2} label="Notification Sounds" description="Play sounds for notifications" prefKey="sound_enabled" color="bg-emerald-400" testId="toggle-sound-enabled" />
      <NotifRow icon={Activity} label="Vibration" description="Vibrate for notifications" prefKey="vibration_enabled" color="bg-emerald-400" testId="toggle-vibration-enabled" />
      
      {/* Digest Mode Section */}
      <div className="flex items-center gap-2 mt-4 mb-2">
        <Clock className="w-4 h-4 text-orange-400" />
        <span className={`text-sm font-medium ${textSecondaryClass}`}>Digest Mode</span>
      </div>
      
      {/* Digest Toggle */}
      <div className={`flex items-center justify-between py-2 border-b ${borderClass}`}>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <div>
            <span className={textPrimaryClass}>Batch Notifications</span>
            <p className={`text-xs ${textSecondaryClass}`}>Group notifications and deliver periodically</p>
          </div>
        </div>
        <ToggleButton
          enabled={notifPrefs.digest_enabled}
          onClick={() => updateNotifPref('digest_enabled', !notifPrefs.digest_enabled)}
          disabled={notifLoading}
          color="bg-orange-400"
          testId="toggle-digest-enabled"
        />
      </div>
      
      {/* Digest Frequency */}
      {notifPrefs.digest_enabled && (
        <div className={`py-2 pl-6`}>
          <p className={`text-sm mb-2 ${textSecondaryClass}`}>Delivery Frequency</p>
          <div className="flex gap-2">
            {['hourly', 'daily', 'weekly'].map((freq) => (
              <button
                key={freq}
                onClick={() => updateNotifPref('digest_frequency', freq)}
                className={`flex-1 py-2 rounded-lg text-sm capitalize transition-colors ${
                  notifPrefs.digest_frequency === freq
                    ? 'bg-orange-400 text-black'
                    : 'bg-muted hover:bg-muted/80 text-foreground'
                }`}
                data-testid={`digest-${freq}`}
              >
                {freq}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
};
