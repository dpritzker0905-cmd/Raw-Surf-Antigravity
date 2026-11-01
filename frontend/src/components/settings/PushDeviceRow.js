import React, { useCallback, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { Switch } from '../ui/switch';

/**
 * PushDeviceRow -- turn push notifications on or off for THIS account on THIS device (2026-10-23, #470).
 *
 * The switch shows the backend's answer (GET /push/status), not the browser permission: that permission is per
 * origin, so on a shared browser it says nothing about the account signed in now. On = this account's own Enable
 * (it may ask the browser for permission); Off = delete only this account's row for this device.
 * The shared Radix switch gives role="switch", aria-checked, Space/Enter and a focus ring; its colours are theme
 * tokens (light, dark and beach). The state is also written out in words, never by colour alone.
 */
export const PushDeviceRow = ({ textPrimaryClass, textSecondaryClass, borderClass }) => {
  const { user } = useAuth();
  const { theme } = useTheme();
  // Track colours with >= 3:1 against the card in every theme (WCAG 1.4.11). The shared switch's own off track
  // (--input) is 15% / 8% grey on dark / beach cards, nearly invisible; light's lime on white is ~1.5:1.
  // Off = --muted-foreground (light 4.8:1, dark 6.6:1, beach 11:1); on = --primary, cyan-700 in light (~5:1).
  const trackClass = `data-[state=unchecked]:bg-muted-foreground${theme === 'light' ? ' data-[state=checked]:bg-cyan-700' : ''}`;
  const { isSupported, permission, serverSubscribed, serverStatusError, subscribe, unsubscribe } =
    usePushNotifications(user?.id, { checkServer: true });
  const [busy, setBusy] = useState(false);

  const on = serverSubscribed === true;
  const checking = isSupported && permission !== 'denied' && serverSubscribed === null && !serverStatusError;
  let status;
  if (!isSupported) status = 'Not available in this browser';
  else if (permission === 'denied') status = 'Blocked in your browser settings';
  else if (busy) status = 'Saving...';
  else if (serverStatusError) status = "Couldn't check right now";
  else if (checking) status = 'Checking...';
  else status = on ? 'On: this account gets push notifications on this device' : 'Off for this account on this device';

  const onCheckedChange = useCallback(async (next) => {
    setBusy(true);
    const ok = next ? await subscribe() : await unsubscribe();
    setBusy(false);
    if (!ok) toast.error(next ? "Couldn't turn on push notifications" : "Couldn't turn off push notifications");
  }, [subscribe, unsubscribe]);

  return (
    <div className={`flex items-center justify-between gap-3 py-2 border-b ${borderClass}`} data-testid="push-device-row">
      <div className="flex items-center gap-2 min-w-0">
        <Smartphone className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <span id="push-device-label" className={textPrimaryClass}>Push on this device</span>
          <p id="push-device-status" className={`text-xs ${textSecondaryClass}`} aria-live="polite">{status}</p>
        </div>
      </div>
      <Switch
        className={trackClass}
        checked={on}
        disabled={busy || checking || !isSupported || permission === 'denied'}
        onCheckedChange={onCheckedChange}
        aria-labelledby="push-device-label"
        aria-describedby="push-device-status"
        aria-busy={busy || checking}
        data-testid="toggle-push-device"
      />
    </div>
  );
};

export default PushDeviceRow;
