import React, { useState, useEffect } from 'react';
import { History, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';
import { getFullUrl } from '../../utils/media';

const PurchaseHistoryModal = ({ isOpen, onClose, userId }) => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (isOpen && userId) {
      fetchHistory();
    }
  }, [isOpen, userId]);
  
  const fetchHistory = async () => {
    try {
      const response = await apiClient.get(`/surfer-gallery/purchase-history?surfer_id=${userId}`);
      setHistory(response.data.purchases || []);
    } catch (error) {
      logger.error('Failed to fetch purchase history:', error);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-lg max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-cyan-400" />
            Purchase History
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p>No purchases yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map(purchase => (
                <div key={purchase.id} className="p-3 bg-muted rounded-lg border border-zinc-700">
                  <div className="flex gap-3">
                    <div className="w-16 h-16 rounded overflow-hidden flex-shrink-0">
                      <img loading="lazy" decoding="async" src={getFullUrl(purchase.thumbnail_url)} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between">
                        <span className="font-medium">{purchase.photographer_name}</span>
                        <span className="text-green-400">${purchase.amount}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{purchase.quality_tier} quality</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(purchase.purchased_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PurchaseHistoryModal;
