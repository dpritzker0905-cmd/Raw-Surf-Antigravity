import React from 'react';
import { Camera, X, Users, MessageCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { getFullUrl } from '../../utils/media';

const PhotographerBottomSheet = ({
  selectedPhotographer,
  onClose,
  onJumpIn,
}) => {
  if (!selectedPhotographer) return null;

  return (
    <div 
      className="fixed bottom-0 left-0 right-0 z-[9998] bg-zinc-900 rounded-t-2xl border-t border-zinc-700 shadow-2xl transition-all duration-300"
      style={{ maxHeight: '40vh' }}
    >
      <div className="h-full flex flex-col">
        {/* Drag Handle */}
        <div 
          className="flex justify-center py-3 cursor-grab"
          onClick={onClose}
        >
          <div className="w-12 h-1.5 bg-zinc-600 rounded-full hover:bg-zinc-500 transition-colors"></div>
        </div>
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-4 text-gray-400 hover:text-white z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Photographer Details */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-14 h-14 rounded-full p-[2px] bg-gradient-to-r from-cyan-400 to-blue-500">
              <div className="w-full h-full rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden">
                {selectedPhotographer.avatar_url ? (
                  <img loading="lazy" decoding="async" src={getFullUrl(selectedPhotographer.avatar_url)} alt={selectedPhotographer.full_name || 'Photographer'} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl text-cyan-400">{selectedPhotographer.full_name?.charAt(0)}</span>
                )}
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-bold text-white font-oswald" >
                  {selectedPhotographer.full_name}
                </h3>
                {selectedPhotographer.is_streaming ? (
                  <span className="px-2 py-0.5 bg-red-500 rounded text-xs text-white font-bold">LIVE</span>
                ) : (
                  <span className="px-2 py-0.5 bg-emerald-500 rounded text-xs text-white font-bold">SHOOTING</span>
                )}
              </div>
              <p className="text-gray-400 text-sm">at {selectedPhotographer.current_spot_name}</p>
            </div>
          </div>
          
          {selectedPhotographer.session_price && (
            <div className="bg-zinc-800 rounded-lg p-3 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm">Session Price</span>
                <span className="text-xl font-bold text-white">${selectedPhotographer.session_price}</span>
              </div>
            </div>
          )}
          
          <div className="flex gap-3">
            <Button
              onClick={onJumpIn}
              className="flex-1 bg-gradient-to-r from-yellow-400 to-orange-400 text-black font-bold"
              data-testid="jump-in-session-btn"
            >
              <Users className="w-4 h-4 mr-2" />
              Jump In Session
            </Button>
            <Button aria-label="Message"
              variant="outline"
              className="border-zinc-600 text-white hover:bg-zinc-800"
            >
              <MessageCircle className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PhotographerBottomSheet;
