/**
 * Shared time formatting utilities.
 * Consolidates duplicated formatTimeAgo implementations from:
 *   PostCard, PostModal, MessagesPage, ConversationItem, 
 *   Feed, SinglePost, SurferRosterCard
 */

/**
 * Formats a date/ISO-8601 string into a human-readable relative time.
 * Examples: "just now", "5m", "3h", "2d", "4w", "Jan 2025"
 * 
 * @param {string|Date} dateInput - ISO date string or Date object
 * @returns {string} Relative time string
 */
export var formatTimeAgo = (dateInput) => {
  if (!dateInput) return '';
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  if (diffWeeks < 52) return `${diffWeeks}w`;
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

/**
 * Compact variant for tight UI spaces (e.g. message lists).
 * Uses "now" instead of "just now".
 * 
 * @param {string|Date} dateInput - ISO date string or Date object
 * @returns {string} Compact relative time string
 */
export var formatTimeAgoCompact = (dateInput) => {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

/**
 * Formats a duration in seconds into a human-readable timer string.
 * Examples: "0:05", "1:30", "1:05:30"
 * 
 * Used by: LiveStatusHUD, MapLiveIndicator, OnDemandSessionManager,
 *          PostModal, VoiceRecorder, WebcamCaptureModal
 * 
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration string (m:ss or h:mm:ss)
 */
export var formatDuration = (seconds) => {
  if (!seconds && seconds !== 0) return '0:00';
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Formats a duration with zero-padded minutes (for recording UIs).
 * Examples: "00:05", "01:30", "01:05:30"
 * 
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration string (mm:ss or hh:mm:ss)
 */
export var formatDurationPadded = (seconds) => {
  if (!seconds && seconds !== 0) return '00:00';
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Formats an ISO date/time string into a locale clock time (e.g. "2:30 PM").
 * Used by: MessagesPage, PhotographerSessionDashboard
 * 
 * @param {string|Date} dateInput - ISO date string or Date object
 * @returns {string} Locale time string (e.g. "2:30 PM")
 */
export var formatClockTime = (dateInput) => {
  if (!dateInput) return '';
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * Converts a 24h time string (HH:MM) to 12h format.
 * Used by: GoldPassSlotCard
 * 
 * @param {string} time - Time string in HH:MM format
 * @returns {string} Formatted 12h time (e.g. "2:30 PM")
 */
export var formatTimeSlot = (time) => {
  if (!time) return '';
  const [hours, minutes] = time.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
};
