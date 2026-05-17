/**
 * ChallengesTab — Weekly challenges leaderboard + history for the Career hub.
 *
 * Connects to:
 *   GET /api/challenges/current   — active challenge + leaderboard
 *   GET /api/challenges/history   — past winners
 *
 * Design: Glassmorphism trophy cards, gradient progress, rank badges.
 */
import React, { useState, useEffect, useCallback } from 'react';
import apiClient from '../../lib/apiClient';
import { getFullUrl } from '../../utils/media';
import { ChallengeCardSkeleton } from '../ui/SkeletonVariants';

var TROPHY_EMOJI = ['🏆', '🥈', '🥉'];

var formatTime = (seconds) => {
  if (seconds <= 0) return 'Ended';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

var ChallengesTab = ({ userId }) => {
  const [challenge, setChallenge] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [history, setHistory] = useState([]);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [currentRes, historyRes] = await Promise.all([
        apiClient.get('/api/challenges/current'),
        apiClient.get('/api/challenges/history')
      ]);
      setChallenge(currentRes.data.challenge);
      setLeaderboard(currentRes.data.leaderboard || []);
      setTimeRemaining(currentRes.data.time_remaining_seconds || 0);
      setHistory(historyRes.data.history || []);
      setError(null);
    } catch (err) {
      setError('Unable to load challenges');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Countdown timer
  useEffect(() => {
    if (timeRemaining <= 0) return;
    const interval = setInterval(() => {
      setTimeRemaining(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [timeRemaining]);

  if (loading) {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <ChallengeCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: 40,
        textAlign: 'center',
        color: '#94a3b8'
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🏄</div>
        <p>{error}</p>
        <button
          onClick={fetchData}
          style={{
            marginTop: 12,
            padding: '8px 20px',
            background: 'rgba(6,182,212,0.15)',
            color: '#06b6d4',
            border: '1px solid rgba(6,182,212,0.3)',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Active Challenge Card */}
      {challenge && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(6,182,212,0.12) 0%, rgba(59,130,246,0.12) 100%)',
          border: '1px solid rgba(6,182,212,0.25)',
          borderRadius: 16,
          padding: 20,
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Glow */}
          <div style={{
            position: 'absolute',
            top: -30,
            right: -30,
            width: 100,
            height: 100,
            background: 'radial-gradient(circle, rgba(6,182,212,0.2), transparent 70%)',
            borderRadius: '50%'
          }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 36 }}>{challenge.badge_emoji || '🏆'}</span>
            <div>
              <h3 style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: '#f1f5f9'
              }}>
                {challenge.title}
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#94a3b8' }}>
                {challenge.description}
              </p>
            </div>
          </div>

          {/* Timer */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: 8,
            marginBottom: 8
          }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>⏱ Time remaining</span>
            <span style={{
              fontSize: 14,
              fontWeight: 700,
              color: timeRemaining < 86400 ? '#f59e0b' : '#06b6d4'
            }}>
              {formatTime(timeRemaining)}
            </span>
          </div>
        </div>
      )}

      {/* Tab switcher */}
      <div style={{
        display: 'flex',
        gap: 0,
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 10,
        padding: 3
      }}>
        <button
          onClick={() => setShowHistory(false)}
          style={{
            flex: 1,
            padding: '8px 0',
            background: !showHistory ? 'rgba(6,182,212,0.2)' : 'transparent',
            border: 'none',
            borderRadius: 8,
            color: !showHistory ? '#06b6d4' : '#94a3b8',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          Leaderboard
        </button>
        <button
          onClick={() => setShowHistory(true)}
          style={{
            flex: 1,
            padding: '8px 0',
            background: showHistory ? 'rgba(6,182,212,0.2)' : 'transparent',
            border: 'none',
            borderRadius: 8,
            color: showHistory ? '#06b6d4' : '#94a3b8',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          Past Winners
        </button>
      </div>

      {/* Leaderboard */}
      {!showHistory && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {leaderboard.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🌊</div>
              <p style={{ margin: 0, fontSize: 14 }}>No participants yet this week</p>
              <p style={{ margin: '4px 0 0', fontSize: 12 }}>Support a Grom to climb the leaderboard!</p>
            </div>
          ) : (
            leaderboard.map((entry) => (
              <div
                key={entry.photographer_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  background: entry.is_trophy_position
                    ? 'linear-gradient(135deg, rgba(251,191,36,0.08), rgba(245,158,11,0.04))'
                    : 'rgba(255,255,255,0.03)',
                  border: entry.is_trophy_position
                    ? '1px solid rgba(251,191,36,0.2)'
                    : '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12,
                  transition: 'all 0.2s'
                }}
              >
                {/* Rank */}
                <div style={{
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: entry.rank <= 3 ? 20 : 14,
                  fontWeight: 700,
                  color: entry.rank <= 3 ? '#fbbf24' : '#64748b'
                }}>
                  {entry.rank <= 3 ? TROPHY_EMOJI[entry.rank - 1] : `#${entry.rank}`}
                </div>

                {/* Avatar */}
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: entry.avatar_url
                    ? `url(${getFullUrl(entry.avatar_url)}) center/cover`
                    : 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 16,
                  flexShrink: 0
                }}>
                  {!entry.avatar_url && (entry.full_name || '?').charAt(0)}
                </div>

                {/* Name + stats */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#f1f5f9',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {entry.full_name}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {entry.groms_supported} grom{entry.groms_supported !== 1 ? 's' : ''} supported
                  </div>
                </div>

                {/* Score */}
                <div style={{
                  padding: '4px 10px',
                  background: entry.is_trophy_position
                    ? 'rgba(251,191,36,0.15)'
                    : 'rgba(255,255,255,0.06)',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  color: entry.is_trophy_position ? '#fbbf24' : '#94a3b8'
                }}>
                  {entry.score}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* History */}
      {showHistory && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📜</div>
              <p style={{ margin: 0, fontSize: 14 }}>No completed challenges yet</p>
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.challenge_id}
                style={{
                  padding: 14,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>{item.badge_emoji}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>
                      {item.title}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    Week {item.week_number}, {item.year}
                  </span>
                </div>

                {/* Winners */}
                <div style={{ display: 'flex', gap: 8 }}>
                  {item.winners?.map((winner) => (
                    <div
                      key={winner.photographer_id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 8px',
                        background: 'rgba(251,191,36,0.08)',
                        borderRadius: 6,
                        fontSize: 12
                      }}
                    >
                      <span>{TROPHY_EMOJI[winner.rank - 1] || ''}</span>
                      <span style={{ color: '#f1f5f9', fontWeight: 500 }}>
                        {winner.full_name}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ChallengesTab;
