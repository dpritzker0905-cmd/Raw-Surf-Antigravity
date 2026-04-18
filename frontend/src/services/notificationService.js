/**
 * notificationService.js — Centralized notification API abstractions.
 *
 * All in-app notification interactions go through this service.
 * Eliminates duplicate API calls scattered across NotificationsDrawer,
 * NotificationsPage, Feed, Sidebar, TopNav, Settings, and others.
 *
 * Push notification subscriptions (VAPID/OneSignal) are handled
 * separately in usePushNotifications.js and useOneSignal.js as they
 * require browser permission lifecycle management.
 */
import apiClient from '../lib/apiClient';

// ── Read / fetch ──────────────────────────────────────────────────────────────

/**
 * Fetch all notifications for a user.
 * @param {string} userId
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const getNotifications = (userId) =>
  apiClient.get(`/notifications/${userId}`);

/**
 * Fetch unread notification count for a user.
 * Used by Sidebar and TopNav for the badge indicator.
 * @param {string} userId
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const getUnreadCount = (userId) =>
  apiClient.get(`/notifications/${userId}/unread-count`);

// ── Mark read ─────────────────────────────────────────────────────────────────

/**
 * Mark a single notification as read.
 * @param {string} notificationId
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const markRead = (notificationId) =>
  apiClient.post(`/notifications/${notificationId}/read`);

/**
 * Mark all notifications for a user as read.
 * @param {string} userId
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const markAllRead = (userId) =>
  apiClient.post(`/notifications/${userId}/read-all`);

// ── Send ──────────────────────────────────────────────────────────────────────

/**
 * Send a notification to a user.
 * Used when tagging users in photos, mentions, etc.
 * @param {{ user_id: string, type: string, title: string, body: string, data?: object }} payload
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const sendNotification = (payload) =>
  apiClient.post('/notifications/send', payload);

/**
 * Send a photographer availability alert to subscribed users.
 * @param {{ photographer_id: string, message: string, [key: string]: any }} payload
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const sendPhotographerAlert = (payload) =>
  apiClient.post('/notifications/photographer-alerts', payload);

/**
 * Create a system notification (used by Feed for follow events etc.).
 * @param {{ recipient_id: string, type: string, actor_id?: string, [key: string]: any }} payload
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const createNotification = (payload) =>
  apiClient.post('/notifications', payload);

// ── Preferences ───────────────────────────────────────────────────────────────

/**
 * Fetch notification preferences for a user.
 * @param {string} userId
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const getPreferences = (userId) =>
  apiClient.get(`/notifications/preferences?user_id=${userId}`);

/**
 * Update a single notification preference key.
 * @param {string} userId
 * @param {string} key   - Preference key (e.g. 'push_enabled', 'email_digest')
 * @param {*}     value  - New value
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const updatePreference = (userId, key, value) =>
  apiClient.put(`/notifications/preferences?user_id=${userId}`, { [key]: value });

/**
 * Bulk update all notification preferences for a user.
 * @param {string} userId
 * @param {object} preferences - Full preferences object
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const updateAllPreferences = (userId, preferences) =>
  apiClient.put(`/notifications/preferences?user_id=${userId}`, preferences);

/**
 * Fetch notification preferences by user ID path param (Settings page variant).
 * @param {string} userId
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const getPreferencesByPath = (userId) =>
  apiClient.get(`/notifications/preferences/${userId}`);

/**
 * Update a single preference using path param variant (Settings page).
 * @param {string} userId
 * @param {string} key
 * @param {*}     value
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const updatePreferenceByPath = (userId, key, value) =>
  apiClient.put(`/notifications/preferences/${userId}`, { [key]: value });

// ── GromHQ alert ──────────────────────────────────────────────────────────────

/**
 * Mark a GromHQ alert notification as read.
 * @param {string} alertId
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export const markAlertRead = (alertId) =>
  apiClient.post(`/notifications/${alertId}/read`);
