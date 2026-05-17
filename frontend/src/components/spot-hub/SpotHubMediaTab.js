/**
 * SpotHubMediaTab - Pro / Community photo grid tab content
 * Extracted from SpotHub.js for modularization (v70)
 */
import React from 'react';
import { Camera, Users, Eye, Heart } from 'lucide-react';
import { getFullUrl } from '../../utils/media';

// Inline MediaItem (same as SpotHub original)
var MediaItem = ({ item, onClick }) => (
  <div onClick={onClick} className="relative aspect-square bg-zinc-800 rounded-lg overflow-hidden cursor-pointer group">
    <img loading="lazy" decoding="async"
      src={getFullUrl(item.thumbnail_url || item.media_url || item.image_url)} alt=""
      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
      onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.classList.add('bg-gradient-to-br', 'from-zinc-700', 'to-zinc-900'); }}
    />
    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
      <Eye className="w-5 h-5 text-white" />
    </div>
    {item.likes_count > 0 && (
      <div className="absolute bottom-1 left-1 flex items-center gap-0.5 text-white text-[10px] bg-black/50 px-1 py-0.5 rounded">
        <Heart className="w-2.5 h-2.5 fill-current" />{item.likes_count}
      </div>
    )}
  </div>
);

var SpotHubMediaTab = ({ type, posts, navigate }) => {
  const isPro = type === 'pro';
  const Icon = isPro ? Camera : Users;
  const emptyLabel = isPro ? 'No pro photos tagged here' : 'No community posts tagged here';
  const emptySubtext = isPro ? 'Photographers can tag their photos to this spot' : 'Tag your photos to this spot to appear here';
  const headerText = isPro ? 'Photos/videos tagged to this spot by photographers' : 'Photos/videos tagged to this spot by surfers';

  return posts.length > 0 ? (
    <>
      <p className="text-[10px] text-gray-500 mb-2">{headerText}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {posts.map((post) => (
          <MediaItem key={post.id} item={post} onClick={() => navigate(`/post/${post.id}`)} />
        ))}
      </div>
    </>
  ) : (
    <div className="text-center py-8 text-gray-400">
      <Icon className="w-10 h-10 mx-auto mb-2 opacity-30" />
      <p className="text-sm">{emptyLabel}</p>
      <p className="text-xs">{emptySubtext}</p>
    </div>
  );
};

export default SpotHubMediaTab;
