/**
 * ExploreWavesTab.js
 * Extracted from Explore.js \u{2014} Reels-style vertical scroll feed for wave videos.
 * v33 component extraction.
 */
import React from 'react';
import { Play, Heart, ChevronRight, Loader2, Film } from 'lucide-react';
import PostMediaPreview from './PostMediaPreview';

const ExploreWavesTab = ({
  trendingWaves,
  recentWaves,
  wavesLoading,
  navigate,
  handleWaveClick,
}) => {
  // Merge trending + recent, deduplicated by id
  const seen = new Set();
  const allWaves = [...trendingWaves, ...recentWaves].filter(w => {
    if (seen.has(w.id)) return false;
    seen.add(w.id);
    return true;
  });

  return (
    <div className="space-y-0" data-testid="waves-tab">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Play className="w-5 h-5 text-cyan-400" />
          <h2 className="font-bold text-foreground">Waves</h2>
        </div>
        <button aria-label="View all waves"
          onClick={() => navigate('/feed?tab=waves')}
          className="text-sm text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
        >
          View All
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Loading / Empty / Feed */}
      {wavesLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
        </div>
      ) : allWaves.length === 0 ? (
        <div className="text-center py-12">
          <Film className="w-8 h-8 text-cyan-400 mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">No waves yet</p>
          <p className="text-muted-foreground text-xs mt-1">Be the first to post a wave!</p>
          <button
            onClick={() => navigate('/create-post?type=wave')}
            className="mt-4 px-4 py-2 rounded-full text-sm font-medium bg-gradient-to-r from-cyan-500 to-blue-500 text-white"
          >
            Create a Wave
          </button>
        </div>
      ) : (
        /* Reels-style vertical snap-scroll feed */
        <div
          className="explore-waves-feed"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            maxWidth: '420px',
            margin: '0 auto',
          }}
        >
          {allWaves.map((wave) => (
            <div
              key={wave.id}
              onClick={() => handleWaveClick(wave)}
              className="group cursor-pointer"
              data-testid={`wave-card-${wave.id}`}
              style={{
                position: 'relative',
                aspectRatio: '9 / 16',
                borderRadius: '16px',
                overflow: 'hidden',
                background: '#000',
                boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
              }}
            >
              {/* Video/Thumbnail */}
              <PostMediaPreview post={wave} isHoverScale={false} />
              
              {/* Play button overlay (center) */}
              <div
                className="absolute inset-0 flex items-center justify-center z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                style={{ pointerEvents: 'none' }}
              >
                <div style={{
                  width: '56px', height: '56px', borderRadius: '50%',
                  background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Play className="w-6 h-6 text-white" fill="white" />
                </div>
              </div>
              
              {/* Bottom gradient overlay */}
              <div
                className="absolute inset-0 z-10"
                style={{
                  background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.3) 25%, transparent 50%)',
                  pointerEvents: 'none',
                }}
              />
              
              {/* Right-side action buttons (Reels-style) */}
              <div
                className="absolute right-3 z-20"
                style={{
                  bottom: '80px', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: '16px', pointerEvents: 'none',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Heart className="w-5 h-5 text-white" />
                  </div>
                  <span style={{ color: 'white', fontSize: '11px', fontWeight: '600' }}>
                    {wave.likes_count || 0}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Play className="w-5 h-5 text-white" />
                  </div>
                  <span style={{ color: 'white', fontSize: '11px', fontWeight: '600' }}>
                    {wave.view_count || 0}
                  </span>
                </div>
              </div>
              
              {/* Bottom info bar (author + caption) */}
              <div className="absolute bottom-0 left-0 right-0 z-20 p-4" style={{ pointerEvents: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  {wave.author_avatar ? (
                    <img loading="lazy" decoding="async"
                      src={wave.author_avatar}
                      alt={wave.author_name}
                      style={{
                        width: '32px', height: '32px', borderRadius: '50%',
                        border: '2px solid rgba(255,255,255,0.6)', objectFit: 'cover',
                      }}
                    />
                  ) : (
                    <div style={{
                      width: '32px', height: '32px', borderRadius: '50%',
                      background: 'rgba(255,255,255,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '14px', fontWeight: '600', color: 'white',
                    }}>
                      {(wave.author_name || '?')[0]}
                    </div>
                  )}
                  <span style={{
                    color: 'white', fontWeight: '600', fontSize: '14px',
                    textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                  }}>
                    @{wave.author_username || wave.author_name?.split(' ')[0]?.toLowerCase()}
                  </span>
                </div>
                {wave.caption && (
                  <p style={{
                    color: 'rgba(255,255,255,0.9)', fontSize: '13px',
                    lineHeight: '1.4', maxHeight: '40px', overflow: 'hidden',
                    textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                  }}>
                    {wave.caption.length > 80 ? wave.caption.slice(0, 80) + '...' : wave.caption}
                  </p>
                )}
              </div>
            </div>
          ))}
          
          {/* Load more / View all CTA */}
          <button
            onClick={() => navigate('/feed?tab=waves')}
            style={{
              width: '100%', padding: '14px', borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(6,182,212,0.15), rgba(59,130,246,0.15))',
              border: '1px solid rgba(6,182,212,0.25)', color: 'rgb(6,182,212)',
              fontWeight: '600', fontSize: '14px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '8px', transition: 'all 0.2s', marginTop: '8px',
            }}
            className="hover:bg-cyan-500/20"
          >
            <Play className="w-4 h-4" />
            View All Waves
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default React.memo(ExploreWavesTab);
