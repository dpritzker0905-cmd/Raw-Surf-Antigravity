/**
 * SkeletonVariants — Domain-specific skeleton loaders for all major views.
 * Uses the base Skeleton primitive from ui/skeleton.jsx.
 *
 * Import what you need:
 *   import { FeedPostSkeleton, SpotCardSkeleton, ... } from 'components/ui/SkeletonVariants';
 */
import React from 'react';
import { Skeleton } from './skeleton';

// ─── Feed Post Skeleton ───────────────────────────────────────────────────────
export var FeedPostSkeleton = () => (
  <div className="rounded-xl border border-border bg-card overflow-hidden">
    {/* Header: avatar + name */}
    <div className="flex items-center gap-3 p-4">
      <Skeleton className="w-10 h-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-28 rounded" />
        <Skeleton className="h-2.5 w-20 rounded" />
      </div>
    </div>
    {/* Image placeholder */}
    <Skeleton className="w-full aspect-[4/3]" />
    {/* Actions row */}
    <div className="p-4 space-y-2">
      <div className="flex gap-4">
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-5 w-5 rounded" />
      </div>
      <Skeleton className="h-3 w-24 rounded" />
      <Skeleton className="h-3 w-full rounded" />
      <Skeleton className="h-3 w-3/4 rounded" />
    </div>
  </div>
);

// ─── Spot/Explore Card Skeleton ───────────────────────────────────────────────
export var SpotCardSkeleton = () => (
  <div className="rounded-xl border border-border bg-card overflow-hidden">
    <Skeleton className="w-full h-40" />
    <div className="p-3 space-y-2">
      <Skeleton className="h-4 w-2/3 rounded" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-14 rounded-full" />
        <Skeleton className="h-6 w-14 rounded-full" />
        <Skeleton className="h-6 w-14 rounded-full" />
      </div>
      <Skeleton className="h-3 w-full rounded" />
    </div>
  </div>
);

// ─── Profile Header Skeleton ──────────────────────────────────────────────────
export var ProfileHeaderSkeleton = () => (
  <div className="flex flex-col items-center space-y-4 py-6">
    <Skeleton className="w-24 h-24 rounded-full" />
    <Skeleton className="h-5 w-36 rounded" />
    <Skeleton className="h-3.5 w-24 rounded" />
    <div className="flex gap-8 mt-2">
      <div className="flex flex-col items-center gap-1">
        <Skeleton className="h-5 w-10 rounded" />
        <Skeleton className="h-3 w-12 rounded" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <Skeleton className="h-5 w-10 rounded" />
        <Skeleton className="h-3 w-12 rounded" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <Skeleton className="h-5 w-10 rounded" />
        <Skeleton className="h-3 w-12 rounded" />
      </div>
    </div>
  </div>
);

// ─── Message Thread Skeleton ──────────────────────────────────────────────────
export var MessageThreadSkeleton = () => (
  <div className="flex items-center gap-3 p-4 border-b border-border">
    <Skeleton className="w-12 h-12 rounded-full shrink-0" />
    <div className="flex-1 space-y-1.5">
      <Skeleton className="h-4 w-32 rounded" />
      <Skeleton className="h-3 w-48 rounded" />
    </div>
    <Skeleton className="w-10 h-3 rounded" />
  </div>
);

// ─── Notification Item Skeleton ───────────────────────────────────────────────
export var NotificationSkeleton = () => (
  <div className="flex items-start gap-3 p-4 border-b border-border">
    <Skeleton className="w-10 h-10 rounded-full shrink-0" />
    <div className="flex-1 space-y-1.5">
      <Skeleton className="h-3.5 w-full rounded" />
      <Skeleton className="h-3 w-2/3 rounded" />
    </div>
    <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
  </div>
);

// ─── Settings Row Skeleton ────────────────────────────────────────────────────
export var SettingsRowSkeleton = () => (
  <div className="flex items-center justify-between p-4 border-b border-border">
    <div className="flex items-center gap-3">
      <Skeleton className="w-8 h-8 rounded-lg" />
      <Skeleton className="h-4 w-32 rounded" />
    </div>
    <Skeleton className="w-12 h-6 rounded-full" />
  </div>
);

// ─── Leaderboard Row Skeleton ─────────────────────────────────────────────────
export var LeaderboardRowSkeleton = () => (
  <div className="flex items-center gap-3 p-3 rounded-xl bg-card/50">
    <Skeleton className="w-8 h-8 rounded-full" />
    <Skeleton className="w-10 h-10 rounded-full" />
    <div className="flex-1 space-y-1">
      <Skeleton className="h-3.5 w-28 rounded" />
      <Skeleton className="h-3 w-16 rounded" />
    </div>
    <Skeleton className="w-16 h-6 rounded-lg" />
  </div>
);

// ─── Map Sidebar Skeleton ─────────────────────────────────────────────────────
export var MapSidebarSkeleton = () => (
  <div className="space-y-3 p-4">
    <Skeleton className="h-5 w-40 rounded" />
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-card/50">
        <Skeleton className="w-12 h-12 rounded-lg shrink-0" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-24 rounded" />
          <Skeleton className="h-3 w-36 rounded" />
        </div>
      </div>
    ))}
  </div>
);

// ─── Surf Log Entry Skeleton ──────────────────────────────────────────────────
export var SurfLogSkeleton = () => (
  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
    <div className="flex items-center justify-between">
      <Skeleton className="h-4 w-28 rounded" />
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
    <div className="flex gap-4">
      <div className="space-y-1">
        <Skeleton className="h-3 w-16 rounded" />
        <Skeleton className="h-5 w-10 rounded" />
      </div>
      <div className="space-y-1">
        <Skeleton className="h-3 w-16 rounded" />
        <Skeleton className="h-5 w-10 rounded" />
      </div>
      <div className="space-y-1">
        <Skeleton className="h-3 w-16 rounded" />
        <Skeleton className="h-5 w-10 rounded" />
      </div>
    </div>
  </div>
);

// ─── Alert/Forecast Card Skeleton ─────────────────────────────────────────────
export var AlertCardSkeleton = () => (
  <div className="rounded-xl border border-border bg-card p-4 space-y-2">
    <div className="flex items-center gap-2">
      <Skeleton className="w-8 h-8 rounded-lg" />
      <Skeleton className="h-4 w-32 rounded" />
    </div>
    <Skeleton className="h-3 w-full rounded" />
    <Skeleton className="h-3 w-3/4 rounded" />
    <div className="flex gap-2 mt-2">
      <Skeleton className="h-8 w-20 rounded-lg" />
      <Skeleton className="h-8 w-20 rounded-lg" />
    </div>
  </div>
);

// ─── Booking Detail Skeleton ──────────────────────────────────────────────────
export var BookingDetailSkeleton = () => (
  <div className="rounded-xl border border-border bg-card overflow-hidden">
    <Skeleton className="w-full h-48" />
    <div className="p-4 space-y-3">
      <Skeleton className="h-5 w-48 rounded" />
      <Skeleton className="h-3.5 w-32 rounded" />
      <div className="flex gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-28 rounded" />
          <Skeleton className="h-3 w-20 rounded" />
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <Skeleton className="h-10 flex-1 rounded-xl" />
        <Skeleton className="h-10 flex-1 rounded-xl" />
      </div>
    </div>
  </div>
);

// ─── Story Ring Skeleton ──────────────────────────────────────────────────────
export var StoryRingSkeleton = () => (
  <div className="flex gap-3 overflow-hidden px-4 py-2">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="flex flex-col items-center gap-1.5 shrink-0">
        <Skeleton className="w-16 h-16 rounded-full" />
        <Skeleton className="h-2.5 w-12 rounded" />
      </div>
    ))}
  </div>
);

// ─── Gear Hub Item Skeleton ───────────────────────────────────────────────────
export var GearItemSkeleton = () => (
  <div className="rounded-xl border border-border bg-card overflow-hidden">
    <Skeleton className="w-full aspect-square" />
    <div className="p-3 space-y-2">
      <Skeleton className="h-4 w-3/4 rounded" />
      <Skeleton className="h-3.5 w-16 rounded" />
      <Skeleton className="h-3 w-full rounded" />
    </div>
  </div>
);

// ─── Challenge Card Skeleton ──────────────────────────────────────────────────
export var ChallengeCardSkeleton = () => (
  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
    <div className="flex items-center gap-3">
      <Skeleton className="w-12 h-12 rounded-xl" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="h-3 w-24 rounded" />
      </div>
    </div>
    <Skeleton className="h-2 w-full rounded-full" />
    <div className="flex justify-between">
      <Skeleton className="h-3 w-20 rounded" />
      <Skeleton className="h-3 w-16 rounded" />
    </div>
  </div>
);

// ─── Compound List Skeletons ──────────────────────────────────────────────────
export var FeedSkeleton = ({ count = 3 }) => (
  <div className="space-y-4 p-4">
    <StoryRingSkeleton />
    {Array.from({ length: count }).map((_, i) => (
      <FeedPostSkeleton key={i} />
    ))}
  </div>
);

export var MessageListSkeleton = ({ count = 6 }) => (
  <div>
    {Array.from({ length: count }).map((_, i) => (
      <MessageThreadSkeleton key={i} />
    ))}
  </div>
);

export var NotificationListSkeleton = ({ count = 8 }) => (
  <div>
    {Array.from({ length: count }).map((_, i) => (
      <NotificationSkeleton key={i} />
    ))}
  </div>
);

export var SpotGridSkeleton = ({ count = 6 }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
    {Array.from({ length: count }).map((_, i) => (
      <SpotCardSkeleton key={i} />
    ))}
  </div>
);

export var SettingsListSkeleton = ({ count = 8 }) => (
  <div>
    {Array.from({ length: count }).map((_, i) => (
      <SettingsRowSkeleton key={i} />
    ))}
  </div>
);

export var LeaderboardSkeleton = ({ count = 10 }) => (
  <div className="space-y-2 p-4">
    {Array.from({ length: count }).map((_, i) => (
      <LeaderboardRowSkeleton key={i} />
    ))}
  </div>
);

// ─── Gallery Page Skeleton ────────────────────────────────────────────────────
export var GallerySkeleton = () => (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40 rounded" />
        <Skeleton className="h-3.5 w-24 rounded" />
      </div>
      <Skeleton className="h-10 w-28 rounded-xl" />
    </div>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-xl" />
      ))}
    </div>
  </div>
);

// ─── Bookings List Skeleton ───────────────────────────────────────────────────
export var BookingsSkeleton = ({ count = 4 }) => (
  <div className="space-y-3 p-4">
    <Skeleton className="h-5 w-32 rounded" />
    {Array.from({ length: count }).map((_, i) => (
      <BookingDetailSkeleton key={i} />
    ))}
  </div>
);

// ─── Generic Page Skeleton (for hub/dashboard pages) ──────────────────────────
export var GenericPageSkeleton = () => (
  <div className="p-4 max-w-4xl mx-auto space-y-4">
    <div className="flex items-center gap-3">
      <Skeleton className="w-10 h-10 rounded-xl" />
      <Skeleton className="h-6 w-48 rounded" />
    </div>
    <div className="grid grid-cols-2 gap-3">
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
    </div>
    <Skeleton className="h-48 rounded-xl" />
    <div className="space-y-2">
      <Skeleton className="h-4 w-full rounded" />
      <Skeleton className="h-4 w-3/4 rounded" />
      <Skeleton className="h-4 w-1/2 rounded" />
    </div>
  </div>
);
