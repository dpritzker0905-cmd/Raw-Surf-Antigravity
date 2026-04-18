/**
 * notificationService.test.js
 * Tests for the centralized notification service.
 * All tests mock apiClient to avoid network calls.
 */

// Mock apiClient before importing the service
jest.mock('../lib/apiClient', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
}));

import apiClient from '../lib/apiClient';
import {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
  sendNotification,
  sendPhotographerAlert,
  createNotification,
  getPreferences,
  updatePreference,
  updateAllPreferences,
  markAlertRead,
} from './notificationService';

describe('notificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: {} });
    apiClient.post.mockResolvedValue({ data: {} });
    apiClient.put.mockResolvedValue({ data: {} });
  });

  // ── Read / Fetch ────────────────────────────────────────────────────────────

  describe('getNotifications', () => {
    it('calls GET /notifications/{userId}', async () => {
      await getNotifications('user-123');
      expect(apiClient.get).toHaveBeenCalledWith('/notifications/user-123');
    });
  });

  describe('getUnreadCount', () => {
    it('calls GET /notifications/{userId}/unread-count', async () => {
      await getUnreadCount('user-456');
      expect(apiClient.get).toHaveBeenCalledWith('/notifications/user-456/unread-count');
    });
  });

  // ── Mark Read ───────────────────────────────────────────────────────────────

  describe('markRead', () => {
    it('calls POST /notifications/{notifId}/read', async () => {
      await markRead('notif-789');
      expect(apiClient.post).toHaveBeenCalledWith('/notifications/notif-789/read');
    });
  });

  describe('markAllRead', () => {
    it('calls POST /notifications/{userId}/read-all', async () => {
      await markAllRead('user-123');
      expect(apiClient.post).toHaveBeenCalledWith('/notifications/user-123/read-all');
    });
  });

  // ── Send ────────────────────────────────────────────────────────────────────

  describe('sendNotification', () => {
    it('calls POST /notifications/send with payload', async () => {
      const payload = { user_id: 'u1', type: 'mention', title: 'You were mentioned', body: '@user' };
      await sendNotification(payload);
      expect(apiClient.post).toHaveBeenCalledWith('/notifications/send', payload);
    });
  });

  describe('sendPhotographerAlert', () => {
    it('calls POST /notifications/photographer-alerts with payload', async () => {
      const payload = { photographer_id: 'p1', message: 'Now available!' };
      await sendPhotographerAlert(payload);
      expect(apiClient.post).toHaveBeenCalledWith('/notifications/photographer-alerts', payload);
    });
  });

  describe('createNotification', () => {
    it('calls POST /notifications with payload', async () => {
      const payload = { recipient_id: 'u2', type: 'follow', actor_id: 'u1' };
      await createNotification(payload);
      expect(apiClient.post).toHaveBeenCalledWith('/notifications', payload);
    });
  });

  // ── Preferences ─────────────────────────────────────────────────────────────

  describe('getPreferences', () => {
    it('calls GET /notifications/preferences?user_id={userId}', async () => {
      await getPreferences('user-123');
      expect(apiClient.get).toHaveBeenCalledWith('/notifications/preferences?user_id=user-123');
    });
  });

  describe('updatePreference', () => {
    it('calls PUT /notifications/preferences?user_id={userId} with key/value', async () => {
      await updatePreference('user-123', 'push_enabled', true);
      expect(apiClient.put).toHaveBeenCalledWith(
        '/notifications/preferences?user_id=user-123',
        { push_enabled: true }
      );
    });
  });

  describe('updateAllPreferences', () => {
    it('calls PUT /notifications/preferences?user_id={userId} with full object', async () => {
      const prefs = { push_enabled: true, email_digest: false };
      await updateAllPreferences('user-123', prefs);
      expect(apiClient.put).toHaveBeenCalledWith(
        '/notifications/preferences?user_id=user-123',
        prefs
      );
    });
  });

  describe('markAlertRead', () => {
    it('calls POST /notifications/{alertId}/read', async () => {
      await markAlertRead('alert-999');
      expect(apiClient.post).toHaveBeenCalledWith('/notifications/alert-999/read');
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────────

  describe('error propagation', () => {
    it('propagates API errors from getNotifications', async () => {
      const err = new Error('Network Error');
      apiClient.get.mockRejectedValue(err);
      await expect(getNotifications('u1')).rejects.toThrow('Network Error');
    });

    it('propagates API errors from markRead', async () => {
      const err = new Error('Server Error');
      apiClient.post.mockRejectedValue(err);
      await expect(markRead('n1')).rejects.toThrow('Server Error');
    });
  });
});
