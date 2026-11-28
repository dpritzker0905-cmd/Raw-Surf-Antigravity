import React, { useState } from 'react';
import { Waves, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '../ui/dialog';

export default function ProfilePhotoViewer({ src, name, initial, logo, canPreview }) {
  const [status, setStatus] = useState('idle');
  const [failed, setFailed] = useState(false);
  const avatar = (
    <Avatar className={`w-28 h-28 md:w-32 md:h-32 border-4 border-black ${logo ? 'bg-black' : ''}`} data-testid="profile-avatar">
      <AvatarImage src={src} alt="" objectFit={logo ? 'contain' : 'cover'} className={logo ? 'p-2' : ''} onLoadingStatusChange={setStatus} />
      <AvatarFallback className="text-4xl bg-zinc-800 text-white">{initial}</AvatarFallback>
    </Avatar>
  );

  if (!src || !canPreview) return avatar;

  return (
    <Dialog onOpenChange={() => setFailed(false)}>
      <DialogTrigger asChild>
        <button type="button" disabled={status !== 'loaded'} aria-label={`View profile photo of ${name}`}
          className="block rounded-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-300">
          {avatar}
        </button>
      </DialogTrigger>
      <DialogContent hideCloseButton aria-describedby={undefined}
        overlayClassName="bg-slate-950/85 motion-reduce:!animate-none"
        className="border-teal-300/30 bg-slate-950 text-white sm:max-w-2xl motion-reduce:!animate-none">
        <div className="flex shrink-0 items-center gap-3 border-b border-teal-300/20 bg-gradient-to-r from-teal-950 to-slate-950 px-4 py-2">
          <Waves aria-hidden="true" className="h-6 w-6 shrink-0 text-teal-300" />
          <DialogTitle className="min-w-0 flex-1 truncate">{name}<span className="sr-only"> profile photo</span></DialogTitle>
          <DialogClose asChild>
            <button type="button" aria-label="Close profile photo" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-teal-300"><X aria-hidden="true" /></button>
          </DialogClose>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-5">
          {failed ? <p role="status" className="p-4">This photo couldn’t be loaded.</p> : (
            <img src={src} alt={`Profile photo of ${name}`} onError={() => setFailed(true)}
              className="h-full max-h-[65dvh] w-full rounded-lg object-contain" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
