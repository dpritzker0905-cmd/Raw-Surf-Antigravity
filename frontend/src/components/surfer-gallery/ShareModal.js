import React, { useState } from 'react';
import { Share2, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { toast } from 'sonner';

const ShareModal = ({ item, isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  
  if (!item) return null;
  
  const shareUrl = `${window.location.origin}/gallery/item/${item.id}`;
  
  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Link copied!');
  };
  
  const handleSocialShare = (platform) => {
    const text = `Check out this surf photo!`;
    const urls = {
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
      instagram: shareUrl, // Instagram doesn't have direct share URL, just copy
    };
    if (platform === 'instagram') {
      handleCopy();
      toast.info('Link copied! Paste in Instagram');
    } else {
      window.open(urls[platform], '_blank', 'width=600,height=400');
    }
    onClose();
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-cyan-400" />
            Share Photo
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Preview */}
          <div className="aspect-video rounded-lg overflow-hidden bg-muted">
            <img loading="lazy" decoding="async" src={item.thumbnail_url || item.url} alt="" className="w-full h-full object-cover" />
          </div>
          
          {/* Copy link */}
          <div className="flex gap-2">
            <Input aria-label="Share URL"
              value={shareUrl} 
              readOnly 
              className="bg-muted border-zinc-700 text-sm"
            />
            <Button onClick={handleCopy} className="bg-cyan-500 hover:bg-cyan-600" aria-label="Confirm">
              {copied ? <Check className="w-4 h-4" /> : 'Copy'}
            </Button>
          </div>
          
          {/* Social buttons */}
          <div className="flex gap-2 justify-center">
            <Button
              variant="outline"
              onClick={() => handleSocialShare('twitter')}
              className="flex-1 border-zinc-700"
            >
              {String.fromCodePoint(0x1D54F)} Twitter
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSocialShare('facebook')}
              className="flex-1 border-zinc-700"
            >
              Facebook
            </Button>
            <Button
              variant="outline"
              onClick={() => handleSocialShare('instagram')}
              className="flex-1 border-zinc-700"
            >
              Instagram
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ShareModal;
