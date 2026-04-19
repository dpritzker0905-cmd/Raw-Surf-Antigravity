/**
 * Notification Deep Linking Utility
 * 
 * Maps notification types to their corresponding routes in the app.
 * This allows notifications to be clickable and navigate users directly
 * to the relevant content (like Facebook/Instagram notifications).
 */

import logger from './logger';

/**
 * Get the deep link route for a notification based on its type and data
 * @param {Object} notification - The notification object with type and data fields
 * @returns {Object|null} - { route: string, state?: object } or null if no deep link
 */
export const getNotificationDeepLink = (notification) => {
  const { type, data: dataStr } = notification;
  let data = {};
  
  try {
    if (dataStr) {
      data = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
    }
  } catch (e) {
    logger.warn('Failed to parse notification data:', e);
  }
  
  // Map notification types to routes
  switch (type) {
    // ========== BOOKING & SESSION NOTIFICATIONS ==========
    case 'booking_request':
    case 'booking_confirmed':
    case 'booking_confirmation':
    case 'booking_cancelled':
    case 'booking_updated':
    case 'booking_invite':
    case 'booking_participant_joined':
    case 'booking_cover':
    case 'booking_hold':
    case 'booking_paid':
    case 'invite_accepted':
    case 'join_request':
      // Navigate to bookings tab with the specific booking
      if (data.booking_id) {
        return { route: '/bookings', state: { bookingId: data.booking_id } };
      }
      return { route: '/bookings' };
      
    case 'session_join':
    case 'session_joined':
    case 'live_session':
    case 'live_session_buyin':
    case 'live_session_earning':
      // Navigate to photographer sessions or bookings
      if (data.session_id) {
        return { route: '/photographer/sessions', state: { sessionId: data.session_id } };
      }
      if (data.booking_id) {
        return { route: '/bookings', state: { bookingId: data.booking_id } };
      }
      return { route: '/photographer/sessions' };
      
    case 'session_reminder':
      if (data.booking_id) {
        return { route: '/bookings', state: { bookingId: data.booking_id } };
      }
      return { route: '/bookings' };
      
    case 'lineup_join':
    case 'lineup_removed':
    case 'lineup_cancelled':
    case 'lineup_crew_left':
      if (data.booking_id) {
        return { route: '/bookings', state: { bookingId: data.booking_id } };
      }
      return { route: '/bookings' };
      
    // ========== PAYMENT NOTIFICATIONS ==========
    case 'payment_request':
    case 'payment_window_expired':
    case 'payment_expiry_reminder':
    case 'lineup_payment_due':
    case 'crew_payment_request':
      if (data.conversation_id) {
        return { route: `/messages/${data.conversation_id}` };
      }
      if (data.booking_id) {
        return { route: '/bookings', state: { bookingId: data.booking_id } };
      }
      return { route: '/bookings' };
      
    case 'booking_payment':
    case 'booking_payment_received':
    case 'booking_earning':
    case 'escrow_released':
    case 'escrow_auto_released':
    case 'escrow_released_to_photographer':
    case 'tip_received':
    case 'gallery_sale':
    case 'live_photo_purchase':
    case 'new_sale':
      // Navigate to earnings/wallet
      return { route: '/photographer/earnings' };
      
    case 'credit_refund':
    case 'booking_refund':
    case 'session_join_refund':
    case 'dispute_refund':
    case 'refund':
      // Navigate to credits/wallet
      return { route: '/credits' };
      
    case 'booking_crew_payment':
      if (data.booking_id) {
        return { route: `/crew-payment/${data.booking_id}` };
      }
      return { route: '/bookings' };
      
    // ========== PHOTO & GALLERY NOTIFICATIONS ==========
    case 'photo_tagged':
    case 'tagged':
    case 'gallery_item':
    case 'selection_auto_completed':
    case 'selection_forfeited':
    case 'selection_expiry_warning':
      // Navigate to surfer gallery
      if (data.gallery_id) {
        return { route: '/gallery', state: { galleryId: data.gallery_id } };
      }
      if (data.booking_id) {
        return { route: '/bookings', state: { bookingId: data.booking_id, tab: 'gallery' } };
      }
      return { route: '/gallery' };
      
    case 'photo_purchased':
    case 'photo_gifted':
    case 'gallery_purchase':
    case 'photo_viewed':
      if (data.gallery_id) {
        return { route: '/gallery', state: { galleryId: data.gallery_id } };
      }
      return { route: '/gallery' };
      
    // ========== SOCIAL NOTIFICATIONS ==========
    case 'new_follower':
      // Navigate to the follower's profile
      if (data.follower_id) {
        return { route: `/profile/${data.follower_id}` };
      }
      return { route: '/profile' };
      
    case 'new_message':
    case 'message_reaction':
      // Navigate to the specific conversation via URL param (not state)
      if (data.conversation_id) {
        return { route: `/messages/${data.conversation_id}` };
      }
      return { route: '/messages' };
      
    case 'mention':
      // Navigate to the post
      if (data.post_id) {
        return { route: `/post/${data.post_id}` };
      }
      return { route: '/feed' }; // Feed
      
    case 'shaka_received':
    case 'instant_shaka':
      if (data.post_id) {
        return { route: `/post/${data.post_id}` };
      }
      if (data.sender_id) {
        return { route: `/profile/${data.sender_id}` };
      }
      return { route: '/feed' };
      
    case 'collaboration_invite':
    case 'collaboration_request':
    case 'collaboration_response':
      if (data.post_id) {
        return { route: `/post/${data.post_id}` };
      }
      return { route: '/feed' };
      
    case 'crew_invite':
    case 'friend_invite':
      if (data.conversation_id) {
        return { route: `/messages/${data.conversation_id}` };
      }
      if (data.booking_id) {
        return { route: '/bookings', state: { bookingId: data.booking_id } };
      }
      return { route: '/messages' };
      
    case 'badge_earned':
    case 'competition_result':
      // Navigate to profile to see badges
      return { route: '/profile' };
      
    // ========== ALERT NOTIFICATIONS ==========
    case 'surf_alert':
      // Navigate to alerts page with specific alert highlighted
      if (data.alert_id) {
        return { route: `/alerts?alert_id=${data.alert_id}` };
      }
      return { route: '/alerts' };
      
    case 'grom_spending_alert':
    case 'grom_link_request':
    case 'grom_highlight':
    case 'grom_support':
      return { route: '/grom-hq' };
      
    // ========== VERIFICATION & ADMIN ==========
    case 'verification_request':
    case 'verification_submitted':
    case 'approved_pro_photographer':
    case 'pro_surfer':
      return { route: '/settings' };
    
    // Admin notifications for new pro applications  
    case 'new_pro_application':
      // Navigate to admin verification queue and auto-open the specific application
      return { 
        route: '/admin', 
        state: { 
          tab: 'verification', 
          applicantId: data.applicant_id,
          verificationRequestId: data.verification_request_id 
        } 
      };
    
    case 'verification_approved':
      // User was verified - take them to their profile
      return { route: '/profile' };
      
    case 'tos_violation':
    case 'appeal_approved':
    case 'appeal_denied':
    case 'location_fraud':
      return { route: '/settings' };
      
    // ========== GEAR & DISPATCH ==========
    case 'gear_purchase':
      return { route: '/gear-hub' };
      
    case 'dispatch_request':
    case 'dispatch_deposit':
    case 'dispatch_refund':
      if (data.booking_id) {
        return { route: '/bookings', state: { bookingId: data.booking_id } };
      }
      return { route: '/bookings' };
      
    // ========== STOKE SPONSOR ==========
    case 'stoke_sponsor':
    case 'stoke_sponsor_contribution':
    case 'stoke_sponsor_income':
    case 'sponsorship_transaction':
      return { route: '/career/stoke-sponsor' };
      
    // ========== AD CONTROLS ==========
    case 'ad_approved':
    case 'ad_rejected':
      return { route: '/create' };
      
    // ========== NOTES ==========
    case 'note_received':
    case 'note_reply':
      // Notes are in messages
      if (data.conversation_id) {
        return { route: `/messages/${data.conversation_id}` };
      }
      return { route: '/messages' };
      
    // ========== ON-DEMAND ==========
    case 'on_demand':
      if (data.photographer_id) {
        return { route: `/profile/${data.photographer_id}` };
      }
      return { route: '/map' };
      
    case 'crew_session_invite':
    case 'crew_payment_reminder':
      // Navigate to on_demand tab (where crew invite cards live) and auto-open payment modal
      return { 
        route: '/bookings?tab=on_demand', 
        state: { 
          openCrewInvite: true,
          dispatchId: data.dispatch_id 
        } 
      };

    case 'dispatch_accepted':
    case 'dispatch_arrived':
      // Navigate directly to the session lobby
      if (data.dispatch_id) {
        return { route: `/dispatch/${data.dispatch_id}/lobby` };
      }
      return { route: '/bookings' };
      
    case 'dispatch_declined':
      // Navigate to bookings on_demand tab
      return { route: '/bookings?tab=on_demand' };
      
    default:
      // For unknown types, try to infer from data
      if (data.booking_id) {
        return { route: '/bookings', state: { bookingId: data.booking_id } };
      }
      if (data.conversation_id) {
        return { route: '/messages', state: { conversationId: data.conversation_id } };
      }
      if (data.post_id) {
        return { route: `/post/${data.post_id}` };
      }
      if (data.user_id || data.follower_id || data.sender_id) {
        const userId = data.user_id || data.follower_id || data.sender_id;
        return { route: `/profile/${userId}` };
      }
      return null;
  }
};

export default getNotificationDeepLink;
