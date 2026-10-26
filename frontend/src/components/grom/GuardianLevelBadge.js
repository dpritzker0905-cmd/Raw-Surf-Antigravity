import React from 'react';
import { Lock, ShieldCheck, Unlock } from 'lucide-react';

/**
 * GuardianLevelBadge -- the child's guardian level in words, and what it unlocks.
 *
 *   Level 0  no linked parent or guardian: browse only
 *   Level 1  linked: messaging and commenting (and, for 16-17, most features with the guardian told)
 *   Level 2  verified parent or guardian: public profile, photos, money (money also goes through the guardian's approval)
 *
 * The level is always written out ("Level 1: Linked"), never shown by colour alone. Colours come from the shared
 * tokens, so the badge reads in light, dark and beach. `unlocked` is the server's answer
 * ({ feature: { allowed, needs } }); this component only words it.
 */
const LEVELS = {
  L0: { name: 'Level 0', label: 'Not linked', blurb: 'Browse only until a parent or guardian links this account.' },
  L1: { name: 'Level 1', label: 'Linked', blurb: 'A parent or guardian is linked. Messaging and commenting are available.' },
  L2: { name: 'Level 2', label: 'Verified', blurb: 'The parent or guardian is verified as an adult. Public profile, photos and purchase requests are available.' },
};

const FEATURE_COPY = {
  browse: 'Browse and watch',
  comment: 'Comment and react',
  message: 'Send messages',
  public_profile: 'Public profile',
  photo: 'Photos and video of the child',
  money: 'Buy things (the guardian still approves each purchase)',
};

const needsText = (needs) => (needs === 'L2' ? 'needs a verified guardian (Level 2)' : needs === 'L1' ? 'needs a linked guardian (Level 1)' : 'available');

export const GuardianLevelBadge = ({ level, unlocked, showDetails = true, className = '' }) => {
  const info = LEVELS[level] || LEVELS.L0;
  const Icon = level === 'L2' ? ShieldCheck : level === 'L1' ? Unlock : Lock;
  const features = unlocked ? Object.entries(unlocked) : [];

  return (
    <div className={`text-foreground ${className}`} data-testid="guardian-level-badge">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold">
        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
        {info.name}: {info.label}
      </span>
      {showDetails ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
            What this level unlocks
          </summary>
          <p className="mt-2 text-muted-foreground">{info.blurb}</p>
          {features.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {features.map(([feature, state]) => (
                <li key={feature} className="flex items-start gap-2">
                  {state.allowed
                    ? <Unlock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    : <Lock className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <span>
                    {FEATURE_COPY[feature] || feature}
                    <span className="text-muted-foreground">
                      {': '}{state.allowed ? 'unlocked' : `locked, ${needsText(state.needs)}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}
    </div>
  );
};

export default GuardianLevelBadge;
