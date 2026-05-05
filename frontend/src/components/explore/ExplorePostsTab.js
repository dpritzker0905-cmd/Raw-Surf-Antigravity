/**
 * ExplorePostsTab.js
 * Extracted from Explore.js — Posts tab with browse grid, hover overlays, and empty state.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Image, Heart, MessageCircle, ChevronRight, Loader2 } from 'lucide-react';
import PostMediaPreview from './PostMediaPreview';

const ExplorePostsTab = ({
  explorePosts,
  postsLoading,
  handlePostClick,
}) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-4" data-testid="posts-tab">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Image className="w-5 h-5 text-purple-400" />
          <h2 className="font-bold text-foreground">Explore Posts</h2>
        </div>
        <button aria-label="View feed"
          onClick={() => navigate('/feed')}
          className="text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1"
        >
          View Feed
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      
      {/* Posts Grid */}
      {postsLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
        </div>
      ) : explorePosts.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Image className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Posts Yet</h3>
          <p className="mb-4">Be the first to share a photo or video!</p>
          <button
            onClick={() => navigate('/create')}
            className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full text-sm font-medium hover:from-purple-600 hover:to-pink-600 transition-all"
          >
            Create a Post
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {explorePosts.map((post) => (
            <div
              key={post.id}
              onClick={() => handlePostClick(post)}
              className="aspect-square bg-zinc-800 overflow-hidden cursor-pointer group relative"
              data-testid={`explore-post-${post.id}`}
            >
              <PostMediaPreview post={post} />
              
              {/* Overlay on hover */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 text-white z-20 pointer-events-none">
                <span className="flex items-center gap-1 text-sm">
                  <Heart className="w-4 h-4" />
                  {post.likes_count || 0}
                </span>
                <span className="flex items-center gap-1 text-sm">
                  <MessageCircle className="w-4 h-4" />
                  {post.comments_count || 0}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default React.memo(ExplorePostsTab);
