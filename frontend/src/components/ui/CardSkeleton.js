/**
 * CardSkeleton GÇö Generic shimmer placeholder for booking, gallery, and list cards.
 * Uses the base Skeleton primitive from ui/skeleton.jsx.
 */
import React from 'react';
import { Skeleton } from './skeleton';

/** Horizontal card skeleton GÇö booking / session style */
export const BookingCardSkeleton = () => (
  <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card">
    <Skeleton className="w-14 h-14 rounded-xl shrink-0" />
    <div className="flex-1 space-y-2">
      <Skeleton className="h-4 w-32 rounded" />
      <Skeleton className="h-3 w-48 rounded" />
      <Skeleton className="h-3 w-24 rounded" />
    </div>
    <Skeleton className="w-16 h-8 rounded-lg shrink-0" />
  </div>
);

/** Grid card skeleton GÇö gallery / photo style */
export const GalleryCardSkeleton = () => (
  <div className="rounded-xl border border-border bg-card overflow-hidden">
    <Skeleton className="w-full aspect-square" />
    <div className="p-3 space-y-2">
      <Skeleton className="h-3.5 w-3/4 rounded" />
      <Skeleton className="h-3 w-1/2 rounded" />
    </div>
  </div>
);

/** List of booking card skeletons */
export const BookingListSkeleton = ({ count = 3 }) => (
  <div className="space-y-3">
    {Array.from({ length: count }).map((_, i) => (
      <BookingCardSkeleton key={i} />
    ))}
  </div>
);

/** Grid of gallery card skeletons */
export const GalleryGridSkeleton = ({ count = 6, cols = 2 }) => (
  <div className={`grid grid-cols-${cols} gap-3`}>
    {Array.from({ length: count }).map((_, i) => (
      <GalleryCardSkeleton key={i} />
    ))}
  </div>
);

export default BookingCardSkeleton;
