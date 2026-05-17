/**
 * HashtagsTab GÇö Trending hashtags discovery and post grid.
 * Extracted from Explore.js to reduce file size.
 * 
 * Features:
 * - Quick hashtag pill buttons (top 10)
 * - Ranked hashtag list with post counts
 * - Selected hashtag GåÆ post grid view
 * - Loading and empty states
 */
import React from 'react';
import { Hash, X, ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '../ui/badge';
import PostMediaPreview from './PostMediaPreview';

const HashtagsTab = ({
  trendingHashtags,
  selectedHashtag,
  setSelectedHashtag,
  hashtagPosts,
  setHashtagPosts,
  hashtagLoading,
  handleHashtagClick,
  navigate,
}) => {
  return (
    <div className="space-y-4" data-testid="trending-hashtags-tab">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Hash className="w-5 h-5 text-yellow-400" />
        <h2 className="font-bold text-foreground">Trending Hashtags</h2>
      </div>
      
      {/* Selected Hashtag View */}
      {selectedHashtag ? (
        <div>
          {/* Hashtag Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSelectedHashtag(null);
                  setHashtagPosts([]);
                }}
                className="p-1.5 hover:bg-muted rounded-full transition-colors"
                aria-label="Back to hashtag list"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
              <span className="text-xl font-bold text-yellow-400">#{selectedHashtag}</span>
            </div>
            <Badge className="bg-yellow-400/20 text-yellow-400">
              {hashtagPosts.length} posts
            </Badge>
          </div>
          
          {/* Posts Grid */}
          {hashtagLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-8 h-8 animate-spin text-yellow-400" />
            </div>
          ) : hashtagPosts.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Hash className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No posts with #{selectedHashtag} yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {hashtagPosts.map((post) => (
                <div
                  key={post.id}
                  onClick={() => navigate(`/post/${post.id}`)}
                  className="aspect-square bg-muted overflow-hidden cursor-pointer group relative"
                  data-testid={`hashtag-post-${post.id}`}
                >
                  <PostMediaPreview post={post} isHoverScale={false} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Trending Hashtags List */
        <div className="space-y-4">
          {/* Quick Hashtag Pills */}
          {trendingHashtags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {trendingHashtags.slice(0, 10).map((tag, index) => (
                <button
                  key={tag.tag}
                  onClick={() => handleHashtagClick(tag.tag)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    index < 3 
                      ? 'bg-yellow-400/20 text-yellow-400 hover:bg-yellow-400/30' 
                      : 'bg-muted text-gray-300 hover:bg-zinc-700'
                  }`}
                  data-testid={`trending-hashtag-${tag.tag}`}
                >
                  #{tag.tag}
                  <span className="ml-1 text-xs opacity-70">{tag.post_count}</span>
                </button>
              ))}
            </div>
          )}
          
          {/* Full List */}
          <div className="space-y-2">
            {trendingHashtags.map((tag, index) => (
              <button
                key={tag.tag}
                onClick={() => handleHashtagClick(tag.tag)}
                className="w-full flex items-center gap-3 p-3 bg-card rounded-xl hover:bg-muted transition-colors"
                data-testid={`hashtag-item-${tag.tag}`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  index < 3 ? 'bg-yellow-400/20' : 'bg-muted'
                }`}>
                  <span className={`text-lg font-bold ${
                    index < 3 ? 'text-yellow-400' : 'text-muted-foreground'
                  }`}>
                    {index + 1}
                  </span>
                </div>
                <div className="flex-1 text-left">
                  <p className="font-medium text-foreground">#{tag.tag}</p>
                  <p className="text-xs text-muted-foreground">{tag.post_count} posts</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </button>
            ))}
            
            {trendingHashtags.length === 0 && (
              <div className="text-center py-10 text-muted-foreground">
                <Hash className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No trending hashtags yet</p>
                <p className="text-sm mt-1">Start posting with #hashtags to see trends!</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default HashtagsTab;
