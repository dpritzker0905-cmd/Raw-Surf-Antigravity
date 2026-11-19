import React, { useId } from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { PAGE_SIZES, pageWindow } from './adminSpotPaging';

/**
 * AdminPager — "Showing 51–100 of 1,702 spots", rows per page, first / previous / next / last.
 *
 * Real buttons and a real <select>, every control named, the range announced politely when it changes, and the
 * page stated in words (never by colour or position alone). Theme tokens only, so it follows light, dark and beach.
 * Wraps onto two lines on a phone.
 */
export const AdminPager = ({ page, pageSize, total, onPage, onPageSize, label = 'rows', busy = false }) => {
  const sizeId = useId();
  const w = pageWindow(page, pageSize, total);
  const go = (target) => {
    const next = Math.min(w.pages, Math.max(1, target));
    if (next !== w.page) onPage(next);
  };
  const atStart = w.page <= 1 || busy;
  const atEnd = w.page >= w.pages || busy;
  const count = w.total.toLocaleString();

  return (
    <nav
      aria-label={`${label} pages`}
      data-testid="admin-pager"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-3 text-xs text-muted-foreground"
    >
      <p aria-live="polite" data-testid="admin-pager-range">
        {w.total === 0
          ? `No ${label}`
          : `Showing ${w.from.toLocaleString()}–${w.to.toLocaleString()} of ${count} ${label}`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={sizeId}>Rows per page</label>
        <select
          id={sizeId}
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="bg-muted border border-border rounded-lg px-2 py-1 text-foreground"
        >
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        <Button type="button" size="sm" variant="outline" className="border-input" aria-label="First page"
          disabled={atStart} onClick={() => go(1)}>
          <ChevronFirst className="w-4 h-4" aria-hidden="true" />
        </Button>
        <Button type="button" size="sm" variant="outline" className="border-input" aria-label="Previous page"
          disabled={atStart} onClick={() => go(w.page - 1)}>
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </Button>
        <span className="text-foreground" data-testid="admin-pager-page">
          Page {w.page.toLocaleString()} of {w.pages.toLocaleString()}
        </span>
        <Button type="button" size="sm" variant="outline" className="border-input" aria-label="Next page"
          disabled={atEnd} onClick={() => go(w.page + 1)}>
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </Button>
        <Button type="button" size="sm" variant="outline" className="border-input" aria-label="Last page"
          disabled={atEnd} onClick={() => go(w.pages)}>
          <ChevronLast className="w-4 h-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
};

export default AdminPager;
