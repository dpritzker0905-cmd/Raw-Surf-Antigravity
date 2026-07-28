import React, { useState, useEffect, useCallback } from 'react';
import { Copy, AlertTriangle, CheckCircle, RefreshCw, Loader2 } from 'lucide-react';
import apiClient from '../../lib/apiClient';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import logger from '../../utils/logger';

/**
 * AdminSpotDuplicates — the duplicate review surface.
 *
 * WHY THIS EXISTS: the catalogue's duplicates were only visible by running a script and reading a
 * terminal, so adjudicating them meant someone pasting a list into a chat. This puts the evidence
 * in the product, recomputed LIVE from the database on every open, so it is also the verification
 * that a merge actually worked — the counts move on their own.
 *
 * ⚠️ READ-ONLY. Discovery is broad, deletion is narrow: `Lower`/`Upper Trestles` and
 * `Ponce Inlet North/South Jetty` are REAL separate peaks, so nothing here deletes. It shows the
 * evidence and hands over the ids for the FK-aware merge path.
 */
const TIERS = [
  { key: 'IDENTICAL', label: 'Identical', tone: 'text-red-500',
    blurb: 'Same name after normalisation — accent, case, apostrophe or article only. Safe to merge.' },
  { key: 'VARIANT', label: 'Variant', tone: 'text-amber-500',
    blurb: 'One name contains the other. NEEDS A HUMAN — some are real sub-peaks.' },
  { key: 'WEAK', label: 'Weak overlap', tone: 'text-cyan-400',
    blurb: 'Partial token overlap. Usually unrelated; skim for the occasional real duplicate.' },
  { key: 'DISTINCT_PEAKS', label: 'Distinct peaks', tone: 'text-green-400',
    blurb: 'Names differ by POSITION (north/south/upper/lower/jetty/numbered street). Never merge.' },
];

const AdminSpotDuplicates = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tier, setTier] = useState('IDENTICAL');
  const [copied, setCopied] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/admin/spots/duplicates');
      setData(res.data);
      setError(null);
    } catch (e) {
      logger.error('Error fetching spot duplicates:', e);
      // Same rule as the stats tiles: a failed read must never render as "0 duplicates".
      setData(null);
      setError('Duplicate scan could not be loaded. Check that you are signed in as an admin.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const copyIds = async (pair) => {
    try {
      await navigator.clipboard.writeText(`${pair.a.id}\n${pair.b.id}`);
      setCopied(`${pair.a.id}|${pair.b.id}`);
      setTimeout(() => setCopied(null), 1500);
    } catch (e) { logger.error('clipboard write failed', e); }
  };

  const pairs = (data?.pairs || []).filter((p) => p.tier === tier);
  const active = TIERS.find((t) => t.key === tier);

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2 flex-wrap">
          <Copy className="w-5 h-5 text-cyan-400" />
          Duplicate Review
          <span className="text-xs font-normal text-muted-foreground ml-auto flex items-center gap-2">
            {error ? (
              <span className="text-amber-500 flex items-center gap-1" role="alert">
                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />{error}
              </span>
            ) : data ? (
              <span aria-live="polite">
                Live · {data.scanned_spots} spots scanned within {data.max_km} km
              </span>
            ) : null}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}
                    aria-label="Rescan for duplicate spots">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" aria-label="Scanning" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4" role="tablist"
                 aria-label="Duplicate tiers">
              {TIERS.map((t) => {
                const n = data?.counts?.[t.key];
                const isActive = tier === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setTier(t.key)}
                    className={`bg-muted rounded-lg p-3 text-center border transition-colors
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500
                      ${isActive ? 'border-cyan-500' : 'border-transparent hover:border-border'}`}
                  >
                    {/* A failed read shows "—", never a fabricated 0. */}
                    <p className={`text-3xl font-bold ${t.tone}`}>{error ? '—' : (n ?? 0)}</p>
                    <p className="text-xs text-muted-foreground">{t.label}</p>
                  </button>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground mb-3">{active?.blurb}</p>

            <div className="space-y-2 max-h-[520px] overflow-y-auto" role="tabpanel">
              {pairs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  {error ? 'No data — the scan failed.'
                         : <span className="inline-flex items-center gap-2">
                             <CheckCircle className="w-4 h-4 text-green-400" aria-hidden="true" />
                             No pairs in this tier.
                           </span>}
                </p>
              ) : pairs.map((p) => (
                <div key={`${p.a.id}-${p.b.id}`}
                     className="bg-muted rounded-lg p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="bg-input text-muted-foreground text-[10px]">
                      {p.km} km apart
                    </Badge>
                    <span className="text-xs text-muted-foreground">{p.why}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {[p.a, p.b].map((s) => (
                      <div key={s.id} className="bg-card rounded p-2 border border-border">
                        <p className="text-sm font-medium text-foreground break-words">{s.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.region || 'no region'} · {Number(s.latitude).toFixed(4)},
                          {' '}{Number(s.longitude).toFixed(4)}
                        </p>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {s.is_verified_peak && (
                            <Badge className="bg-green-500/20 text-green-400 text-[10px]">
                              verified peak
                            </Badge>
                          )}
                          {s.accuracy_flag && (
                            <Badge className={`text-[10px] ${
                              s.accuracy_flag === 'low_accuracy'
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-input text-muted-foreground'}`}>
                              {s.accuracy_flag}
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => copyIds(p)}
                            aria-label={`Copy the two spot ids for ${p.a.name} and ${p.b.name}`}>
                      <Copy className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                      {copied === `${p.a.id}|${p.b.id}` ? 'Copied' : 'Copy ids'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export { AdminSpotDuplicates };
export default AdminSpotDuplicates;
