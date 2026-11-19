import React, { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';

export const UNVERIFIED_SPOTS_FLAG_KEY = 'show_unverified_spots';

/**
 * AdminUnverifiedSpotsToggle — owner, 2026-11-18: "Unverified spots we should have an admin toggle to make them
 * visible or not."
 *
 * One switch over the existing feature-flag table (key `show_unverified_spots`). OFF (or never set) keeps spots
 * whose location nobody has verified out of the public map and spot list. ON lists them, drawn with a dashed ring
 * and the words "Unverified location". It only concerns spots added from the holding table; no spot carries that
 * mark until one is promoted, so today the switch changes nothing anyone can see.
 *
 * A real switch (`role="switch"`, `aria-checked`), its state written in words, and a failed read shown as an error
 * instead of as "Hidden".
 */
export const AdminUnverifiedSpotsToggle = () => {
  const [flag, setFlag] = useState(null);       // the feature-flag row, or null when it has never been created
  const [loaded, setLoaded] = useState(false);
  const [readOk, setReadOk] = useState(false);  // false until one read has succeeded: never show a guess as a state
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get('/admin/feature-flags');
      const found = (response.data.feature_flags || []).find((f) => f.key === UNVERIFIED_SPOTS_FLAG_KEY) || null;
      setFlag(found);
      setReadOk(true);
      setError(null);
    } catch (err) {
      logger.error('Error reading the unverified-spots switch:', err);
      setError('The switch could not be read. Check that you are signed in as an admin.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = !!(flag && flag.is_enabled && !flag.kill_switch_enabled);

  const toggle = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!flag) {
        await apiClient.post('/admin/feature-flags', {
          key: UNVERIFIED_SPOTS_FLAG_KEY,
          name: 'Show unverified-location spots',
          description: 'ON: spots added from the holding table whose location is not verified are shown to the '
            + 'public, with a dashed ring and the words "Unverified location". OFF: they are left out.',
          is_enabled: true,
          category: 'surf_spots',
        });
      } else {
        await apiClient.put(`/admin/feature-flags/${flag.id}`, null, { params: { is_enabled: !shown } });
      }
      await load();
    } catch (err) {
      logger.error('Error changing the unverified-spots switch:', err);
      setError('The switch could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4" data-testid="admin-unverified-spots-toggle">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-foreground font-medium">Unverified-location spots on the public map</p>
          <p className="text-xs text-muted-foreground">
            Spots added from the holding table whose position nobody has verified. Shown, they wear a dashed ring and
            the words &quot;Unverified location&quot;. Existing spots are not affected. A change reaches the map within
            about a minute.
          </p>
        </div>
        {!loaded ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" role="status" aria-label="Reading the switch" />
        ) : (
          <Button
            type="button"
            role="switch"
            aria-checked={shown}
            aria-label="Show unverified-location spots to the public"
            variant="outline"
            className="border-input min-w-[7rem]"
            disabled={saving || !readOk}
            onClick={toggle}
          >
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
            {!readOk ? 'Unknown' : shown ? 'Shown' : 'Hidden'}
          </Button>
        )}
      </div>
      {flag && flag.kill_switch_enabled && (
        <p className="text-xs text-muted-foreground mt-2">
          This flag&apos;s kill switch is on in Feature Flags, so the spots stay hidden whatever this switch says.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-foreground mt-2">{error}</p>}
    </div>
  );
};

export default AdminUnverifiedSpotsToggle;
