import React from 'react';

export default function RequesterProfileLink({ id, username }) {
  if (!username) return null;
  if (!id) return <span className="text-sm">@{username}</span>;
  return (
    <a href={`/profile/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer"
      className="text-sm text-cyan-400 hover:text-cyan-300 hover:underline transition-colors">
      @{username}
    </a>
  );
}
