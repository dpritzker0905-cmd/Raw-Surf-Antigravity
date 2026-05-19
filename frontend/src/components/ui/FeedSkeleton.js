/**
 * FeedSkeleton -- Shimmer loading placeholders for the social feed.
 * Uses the base Skeleton primitive from ui/skeleton.jsx.
 * Shows 3 post-shaped cards while feed data is being fetched.
 */
import React from 'react';
import { Skeleton } from './skeleton';

const PostSkeleton = () => (
  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
    {/* Author row */}
    <div className="flex items-center gap-3">
      <Skeleton className="w-10 h-10 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-28 rounded" />
        <Skeleton className="h-2.5 w-20 rounded" />
      </div>
    </div>
    {/* Text lines */}
    <div className="space-y-2">
      <Skeleton className="h-3 w-full rounded" />
      <Skeleton className="h-3 w-4/5 rounded" />
    </div>
    {/* Image placeholder */}
    <Skeleton className="h-52 w-full rounded-lg" />
    {/* Action bar */}
    <div className="flex items-center gap-6 pt-1">
      <Skeleton className="h-4 w-12 rounded" />
      <Skeleton className="h-4 w-12 rounded" />
      <Skeleton className="h-4 w-12 rounded" />
    </div>
  </div>
);

export const FeedSkeleton = ({ count = 3 }) => (
  <div className="space-y-4 px-1">
    {Array.from({ length: count }).map((_, i) => (
      <PostSkeleton key={i} />
    ))}
  </div>
);

export default FeedSkeleton;
