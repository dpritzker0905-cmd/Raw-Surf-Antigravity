/**
 * gromPurchase.js — Utility for Grom purchase request flow
 * 
 * When a Grom tries to buy something, instead of blocking silently,
 * this sends a request to their parent for approval.
 */

import apiClient from '../lib/apiClient';
import { toast } from 'sonner';

/**
 * Submit a purchase request on behalf of a Grom user
 * @param {object} params
 * @param {string} params.gromId - The Grom's user ID
 * @param {string} params.itemType - 'gallery_photo' | 'credit_pack' | 'gear_item'
 * @param {string} [params.itemId] - The item's ID
 * @param {string} params.itemName - Human-readable name for the item
 * @param {number} params.amount - Price in dollars/credits
 * @param {string} [params.qualityTier] - Quality tier for gallery photos
 * @param {object} [params.metadata] - Additional metadata
 * @returns {Promise<{success: boolean, requestId?: string, alreadyPending?: boolean}>}
 */
export async function submitPurchaseRequest({
  gromId,
  itemType,
  itemId,
  itemName,
  amount,
  qualityTier,
  metadata
}) {
  try {
    const res = await apiClient.post(`/grom-hq/purchase-request/${gromId}`, {
      item_type: itemType,
      item_id: itemId || null,
      item_name: itemName,
      amount: amount,
      quality_tier: qualityTier || null,
      metadata: metadata || {}
    });

    if (res.data.already_pending) {
      toast.info('🛒 Request already sent to your parent!', {
        description: 'They\'ll see it in their Grom HQ dashboard.'
      });
    } else {
      toast.success('🛒 Purchase request sent!', {
        description: 'Your parent will approve or deny it in their Grom HQ.'
      });
    }

    return {
      success: true,
      requestId: res.data.request_id,
      alreadyPending: res.data.already_pending
    };
  } catch (err) {
    const detail = err.response?.data?.detail || 'Failed to send request';
    
    if (err.response?.status === 403) {
      toast.error('🚫 Spending limit reached', { description: detail });
    } else if (err.response?.status === 400) {
      toast.error('Cannot send request', { description: detail });
    } else {
      toast.error('Something went wrong', { description: detail });
    }

    return { success: false };
  }
}
