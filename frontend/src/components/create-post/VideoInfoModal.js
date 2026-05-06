import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { Video, Waves, Radio, HelpCircle, Clock, Music, VolumeX, Play } from 'lucide-react';

const VideoInfoModal = ({ isOpen, onClose, isLight, textPrimaryClass, textSecondaryClass, borderClass }) => {
  return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="bg-background border-border text-foreground max-w-md w-[95vw] sm:w-full p-0 overflow-hidden sm:border sm:rounded-xl shadow-2xl flex flex-col max-h-[75vh] my-auto">
          <div className="overflow-y-auto w-full p-6 pb-12 custom-scrollbar">
            <DialogHeader className="mb-4">
              <DialogTitle className="flex items-center gap-2 text-xl font-bold text-foreground">
                <HelpCircle className="w-6 h-6 text-cyan-500" />
                Video vs Wave
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-5">
              {/* Wave Section */}
              <div className="p-5 rounded-xl bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 shadow-sm relative overflow-hidden">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-cyan-500/10 rounded-full blur-xl pointer-events-none"></div>
                <div className="flex items-center gap-3 mb-4 relative z-10">
                  <div className="w-12 h-12 rounded-full bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30">
                    <Play className="w-6 h-6 text-cyan-600 dark:text-cyan-400 translate-x-0.5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-lg text-cyan-700 dark:text-cyan-400">Wave</h3>
                    <p className="text-sm text-foreground/70 font-medium">Short-form vertical video</p>
                  </div>
                </div>
                <ul className="space-y-3 text-sm text-foreground/90 relative z-10">
                  <li className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-cyan-600 dark:text-cyan-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">60 seconds max</strong> - Quick highlights &amp; clips</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Play className="w-5 h-5 text-cyan-600 dark:text-cyan-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">Vertical format</strong> - Full-screen TikTok-style</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Music className="w-5 h-5 text-cyan-600 dark:text-cyan-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">Licensed music</strong> - Coming soon via Adaptr</span>
                  </li>
                </ul>
                <div className="mt-4 pt-3 border-t border-cyan-500/10">
                  <p className="text-xs font-medium text-cyan-700 dark:text-cyan-500/80">
                    Best for: Tricks, highlights, funny moments, quick clips
                  </p>
                </div>
              </div>
              
              {/* Video Section */}
              <div className="p-5 rounded-xl bg-purple-500/10 border border-purple-500/20 shadow-sm relative overflow-hidden">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-purple-500/10 rounded-full blur-xl pointer-events-none"></div>
                <div className="flex items-center gap-3 mb-4 relative z-10">
                  <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
                    <Video className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-lg text-purple-700 dark:text-purple-400">Video Post</h3>
                    <p className="text-sm text-foreground/70 font-medium">Standard video in feed</p>
                  </div>
                </div>
                <ul className="space-y-3 text-sm text-foreground/90 relative z-10">
                  <li className="flex items-start gap-3">
                    <Clock className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">Longer duration</strong> - Full session clips</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Video className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">Any aspect ratio</strong> - Landscape, square, portrait</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Music className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                    <span><strong className="text-foreground">Licensed music</strong> - Coming soon via Epidemic Sound</span>
                  </li>
                </ul>
                <div className="mt-4 pt-3 border-t border-purple-500/10">
                  <p className="text-xs font-medium text-purple-700 dark:text-purple-500/80">
                    Best for: Session recaps, tutorials, vlogs, longer content
                  </p>
                </div>
              </div>
              
              {/* Music Note */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <VolumeX className="w-5 h-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-foreground/80 leading-relaxed">
                  <strong className="text-amber-700 dark:text-amber-400 font-bold block mb-1">Music Note</strong>
                  Videos with unlicensed copyrighted music may have audio muted. Licensed music libraries coming soon!
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
  );
};

export default VideoInfoModal;
