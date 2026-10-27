import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Download } from 'lucide-react';
import { Button } from '../ui/button';
import { useSecurityTone } from './useSecurityTone';

export const recoveryCodesText = (codes) => [
  'Raw Surf recovery codes',
  'Each code works once. Keep this file somewhere only you can open (a password manager is ideal).',
  '',
  ...codes,
  '',
].join('\n');

/**
 * The one moment recovery codes are shown. They are not stored in readable form, so this screen cannot be reopened:
 * the person copies or downloads them, then ticks "I saved them" before Continue unlocks.
 */
export const RecoveryCodesPanel = ({ codes, onDone, doneLabel = 'Continue', title = 'Save your recovery codes' }) => {
  const tone = useSecurityTone();
  const headingRef = useRef(null);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => { headingRef.current?.focus(); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodesText(codes));
      setNotice('Copied. Paste them into your password manager.');
    } catch (_) {
      setNotice("Couldn't copy. Select the codes and copy them by hand, or download the file.");
    }
  };

  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([recoveryCodesText(codes)], { type: 'text/plain' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'raw-surf-recovery-codes.txt';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice('Downloaded raw-surf-recovery-codes.txt');
    } catch (_) {
      setNotice("Couldn't download the file. Copy the codes instead.");
    }
  };

  return (
    <section aria-labelledby="recovery-codes-title" className="space-y-4" data-testid="recovery-codes-panel">
      <h2 id="recovery-codes-title" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {title}
      </h2>
      <div className={`flex gap-2 rounded-lg border p-3 text-sm ${tone.warn}`} role="note">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          If you lose your phone, these are the only way back into your account. Each one works once. We can't show
          them again, so save them now.
        </p>
      </div>
      <ol aria-label="Recovery codes" className={`grid grid-cols-2 gap-2 rounded-lg border p-3 font-mono text-sm ${tone.code}`}>
        {codes.map((code) => <li key={code} className="select-all tracking-wider">{code}</li>)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={copy}><Copy aria-hidden="true" />Copy codes</Button>
        <Button type="button" variant="outline" onClick={download}><Download aria-hidden="true" />Download .txt</Button>
      </div>
      <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm text-muted-foreground">{notice}</p>
      <label className="flex cursor-pointer items-start gap-3 text-sm text-foreground">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5 shrink-0 accent-current"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          data-testid="recovery-saved-checkbox"
        />
        <span>I saved these codes somewhere safe</span>
      </label>
      <Button type="button" disabled={!saved} aria-describedby="recovery-saved-hint" onClick={onDone} data-testid="recovery-done">
        <Check aria-hidden="true" />{doneLabel}
      </Button>
      <p id="recovery-saved-hint" className="text-xs text-muted-foreground">
        {saved ? 'Ready to continue.' : 'Tick the box above to continue.'}
      </p>
    </section>
  );
};

export default RecoveryCodesPanel;
