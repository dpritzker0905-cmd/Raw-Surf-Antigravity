import { useMemo, useState } from 'react';

const initialStats = {
  streak: { current_streak: 0, longest_streak: 0, total_check_ins: 0 },
  socialStats: { followers: 0, following: 0 },
  contentStats: { posts: 0, photos: 0, videos: 0, session_shots: 0, saved: 0, tagged: 0 },
  impactScore: null,
  gamificationStats: { total_xp: 0, badges: [], recent_xp_transactions: [] },
};

export default function useProfileStats(profileId, viewerId) {
  const [state, setState] = useState(() => ({ visit: { profileId, viewerId }, stats: initialStats }));
  const { visit } = state;
  if (visit.profileId !== profileId || visit.viewerId !== viewerId) {
    // Reset during render so the new profile cannot paint with the old counts.
    setState({ visit: { profileId, viewerId }, stats: initialStats });
  }

  // Each reader or optimistic follow update retains the visit that started it.
  // Object identity also distinguishes two visits to the same profile.
  const setters = useMemo(() => {
    const setter = key => update => setState(current => {
      if (current.visit !== visit) return current;
      const value = typeof update === 'function' ? update(current.stats[key]) : update;
      return { visit, stats: { ...current.stats, [key]: value } };
    });
    return {
      setStreak: setter('streak'),
      setSocialStats: setter('socialStats'),
      setContentStats: setter('contentStats'),
      setImpactScore: setter('impactScore'),
      setGamificationStats: setter('gamificationStats'),
    };
  }, [visit]);
  return { ...state.stats, ...setters };
}
