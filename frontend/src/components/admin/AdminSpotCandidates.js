import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import apiClient from '../../lib/apiClient';
import logger from '../../utils/logger';
import { AdminPager } from './AdminPager';
import { DEFAULT_PAGE_SIZE } from './adminSpotPaging';

// What each duplicate tier means, in words: the letter alone tells a reviewer nothing.
export const TIER_LABELS = {
  A: 'Within 100 m of an existing spot',
  B: 'Same name as a spot within 2 km',
  C: '100–500 m from an existing spot',
  D: '0.5–2 km from an existing spot',
  E: 'Same name as a spot 2–8 km away',
  F: 'No existing spot nearby',
};
const STATUS_LABELS = {
  pending: 'Waiting for review', held: 'Held', rejected: 'Not a surf break',
  duplicate: 'Duplicate of a spot', promoted: 'Made a spot',
};
const selectClass = 'bg-muted border border-border rounded-lg px-3 py-2 text-foreground';

/**
 * AdminSpotCandidates — the holding table, read only (owner, 2026-11-18: "a separate holding table that can hold
 * the 23,732 spots to be reviewed"). None of these is a surf spot: nothing here is on the map or in the forecast.
 * Reviewing, placing and promoting a candidate arrive in later changes; this screen lists them, one page at a time,
 * with the true total. `onCounts` reports the whole table's counts so the tab can show how many are waiting.
 */
export const AdminSpotCandidates = ({ onCounts }) => {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [status, setStatus] = useState('pending');
  const [tier, setTier] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestRef = useRef(0);

  const fetchCandidates = useCallback(async () => {
    const mine = ++requestRef.current;
    try {
      const params = { page, limit: pageSize };
      if (status) params.status = status;
      if (tier) params.tier = tier;
      if (appliedSearch) params.search = appliedSearch;
      const response = await apiClient.get('/admin/spots/candidates', { params });
      if (mine !== requestRef.current) return;
      setRows(response.data.candidates || []);
      setTotal(response.data.total ?? 0);
      setCounts(response.data.counts || null);
      if (onCounts) onCounts(response.data.counts || null);
      setError(false);
    } catch (err) {
      if (mine !== requestRef.current) return;
      logger.error('Error fetching spot candidates:', err);
      setError(true);
    } finally {
      if (mine === requestRef.current) setLoading(false);
    }
  }, [page, pageSize, status, tier, appliedSearch, onCounts]);

  useEffect(() => { fetchCandidates(); }, [fetchCandidates]);

  useEffect(() => {
    const id = setTimeout(() => {
      const next = searchQuery.trim();
      if (next !== appliedSearch) {
        setAppliedSearch(next);
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [searchQuery, appliedSearch]);

  const change = (setter) => (e) => { setter(e.target.value); setPage(1); };

  return (
    <div className="space-y-3" data-testid="admin-spot-candidates">
      <p className="text-sm text-muted-foreground">
        Candidates are not surf spots. They wait here until a person reviews them; none is on the map or in the forecast.
      </p>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Search candidates by name"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search candidates..."
            className="pl-10 bg-muted border-border text-foreground"
          />
        </div>
        <select value={status} onChange={change(setStatus)} aria-label="Filter candidates by review status" className={selectClass}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}{counts?.by_status ? ` (${Number(counts.by_status[value] || 0).toLocaleString()})` : ''}
            </option>
          ))}
        </select>
        <select value={tier} onChange={change(setTier)} aria-label="Filter candidates by duplicate check" className={selectClass}>
          <option value="">All duplicate checks</option>
          {Object.entries(TIER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {value}: {label}{counts?.by_tier ? ` (${Number(counts.by_tier[value] || 0).toLocaleString()})` : ''}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-muted-foreground py-6 text-center bg-muted rounded-xl">
          The candidate list could not be loaded. Check that you are signed in as an admin.
        </p>
      ) : loading ? (
        <div className="flex items-center justify-center h-32" role="status" aria-label="Loading candidates">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" aria-hidden="true" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center bg-muted rounded-xl">
          {counts?.all ? 'No candidates match these filters.' : 'The holding table is empty. No candidates have been loaded.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((candidate) => (
            <li key={candidate.id} className="bg-muted rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-foreground font-medium break-words">{candidate.name}</p>
                <p className="text-xs text-muted-foreground">
                  {candidate.country || 'Unknown country'} · {Number(candidate.latitude).toFixed(4)}, {Number(candidate.longitude).toFixed(4)}
                  {candidate.shoreline_km != null && <> · {Number(candidate.shoreline_km).toFixed(2)} km from the shoreline</>}
                </p>
                {candidate.nearest_spot_name && (
                  <p className="text-xs text-muted-foreground">
                    Nearest spot: {candidate.nearest_spot_name}
                    {candidate.nearest_spot_km != null && <> ({Number(candidate.nearest_spot_km).toFixed(2)} km)</>}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-input text-foreground text-[10px]">
                  {candidate.tier}: {TIER_LABELS[candidate.tier] || 'Unknown'}
                </Badge>
                <Badge className="bg-input text-muted-foreground text-[10px]">
                  {STATUS_LABELS[candidate.status] || candidate.status}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!error && (
        <AdminPager
          label="candidates"
          page={page}
          pageSize={pageSize}
          total={total}
          onPage={setPage}
          onPageSize={(size) => { setPageSize(size); setPage(1); }}
        />
      )}
    </div>
  );
};

export default AdminSpotCandidates;
