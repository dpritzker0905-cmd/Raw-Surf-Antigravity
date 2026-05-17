/**
 * PostMediaPreview GÇö Reusable media preview card for posts, waves, and videos.
 * Shows video thumbnail with play badge, responsive image, or placeholder.
 * Extracted from Explore.js for reuse across explore grid, search results, etc.
 */
import React from 'react';
import { Play, Image } from 'lucide-react';
import { getFullUrl } from '../../utils/media';
import ResponsiveImage from '../ui/ResponsiveImage';

const PostMediaPreview = ({ post, isHoverScale = true }) => {
  const mediaUrl = post?.media_url || post?.image_url || post?.thumbnail_url;
  const isVideo = post?.media_type === 'video' || (mediaUrl && typeof mediaUrl === 'string' && mediaUrl.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i)) || post?.is_wave === true || typeof post?.view_count !== 'undefined';
  const thumbnailUrl = post?.thumbnail_url || (isVideo ? null : mediaUrl);

  // Use the project's getFullUrl utility for proper URL resolution (Supabase, backend, etc.)
  const finalMediaUrl = getFullUrl(mediaUrl);
  const finalThumbnailUrl = getFullUrl(thumbnailUrl);
  const hoverClass = isHoverScale ? "group-hover:scale-105 transition-transform duration-300" : "group-hover:opacity-80 transition-opacity duration-300";

  if (isVideo && finalMediaUrl) {
    // If we have a proper thumbnail image, show it; otherwise show a styled placeholder
    const hasImageThumb = finalThumbnailUrl && !finalThumbnailUrl.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i);
    return (
      <>
        {hasImageThumb ? (
          <img
            src={finalThumbnailUrl}
            alt=""
            className={`w-full h-full object-cover absolute inset-0 ${hoverClass}`}
            loading="lazy"
            onError={(e) => {
              // Fallback: try the video element poster approach
              e.target.style.display = 'none';
            }}
          />
        ) : (
          /* For videos without a thumbnail image, render a video element to extract a frame */
          <video
            src={finalMediaUrl}
            className={`w-full h-full object-cover absolute inset-0 ${hoverClass}`}
            muted
            preload="metadata"
            playsInline
            onLoadedData={(e) => { e.target.currentTime = 0.5; }}
          />
        )}
        <div className="absolute top-2 right-2 bg-black/60 rounded-full w-6 h-6 flex items-center justify-center opacity-80 shadow-md z-10">
          <Play className="w-3 h-3 text-white fill-white ml-0.5" />
        </div>
      </>
    );
  }

  if (finalThumbnailUrl || finalMediaUrl) {
    return (
      <ResponsiveImage
        src={finalThumbnailUrl || finalMediaUrl}
        alt=""
        className={`w-full h-full object-cover absolute inset-0 ${hoverClass}`}
        loading="lazy"
      />
    );
  }

  return (
    <div className="w-full h-full bg-zinc-800 flex items-center justify-center absolute inset-0">
      <Image className="w-8 h-8 text-zinc-600" />
    </div>
  );
};

export default PostMediaPreview;
