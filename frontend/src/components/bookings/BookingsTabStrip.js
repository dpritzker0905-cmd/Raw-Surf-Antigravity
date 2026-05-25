import React, { useEffect, useState, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getThemeTokens } from '../../utils/themeTokens';

export const BookingsTabStrip = ({ activeTab, setActiveTab, tabs, theme }) => {
  const tabScrollRef = useRef(null);
  const stickyTabRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const scrollStartRef = useRef(0);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  const isLight = theme === 'light';
  const isBeach = theme === 'beach';
  const t = getThemeTokens(theme);
  const borderClass = isLight ? 'border-gray-200' : isBeach ? 'border-border' : 'border-zinc-700';
  const textPrimaryClass = isLight ? 'text-gray-900' : 'text-foreground';
  const textSecondaryClass = isLight ? 'text-gray-600' : isBeach ? 'text-gray-300' : 'text-muted-foreground';

  // Check if scroll arrows should show (desktop only)
  const updateArrows = () => {
    const el = tabScrollRef.current;
    if (!el) return;
    setShowLeftArrow(el.scrollLeft > 4);
    setShowRightArrow(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  // Scroll arrows handler
  const scrollTabs = (dir) => {
    const el = tabScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 160, behavior: 'smooth' });
  };

  // Auto-scroll the active tab pill into view whenever activeTab changes
  useEffect(() => {
    const tabStrip = tabScrollRef.current;
    if (!tabStrip) return;

    requestAnimationFrame(() => {
      const activeBtn = tabStrip.querySelector(`[data-testid="tab-${activeTab}"]`);
      if (activeBtn) {
        const stripWidth = tabStrip.offsetWidth;
        const btnLeft = activeBtn.offsetLeft;
        const btnWidth = activeBtn.offsetWidth;
        const targetScroll = btnLeft - (stripWidth / 2) + (btnWidth / 2);
        
        tabStrip.scrollTo({ left: targetScroll, behavior: 'instant' });
        setIndicatorStyle({ left: btnLeft, width: btnWidth });
      }
      updateArrows();
    });
    setTimeout(updateArrows, 350);
  }, [activeTab]);

  // Keep arrows synced on resize
  useEffect(() => {
    window.addEventListener('resize', updateArrows);
    requestAnimationFrame(updateArrows);
    return () => window.removeEventListener('resize', updateArrows);
  }, []);

  return (
    <div
      ref={stickyTabRef}
      className="relative z-10"
      style={{
        backgroundColor: isLight ? '#f9fafb' : isBeach ? '#09090b' : '#18181b',
        backgroundImage: 'none',
      }}
    >
      <div className="relative">
        {/* Scrollable tab strip with orange underline indicator */}
        <div
          ref={tabScrollRef} role="tablist" aria-label="Booking sections" tabIndex={0}
          onScroll={updateArrows}
          onMouseDown={(e) => {
            isDraggingRef.current = true;
            dragStartXRef.current = e.pageX;
            scrollStartRef.current = tabScrollRef.current?.scrollLeft || 0;
            e.currentTarget.style.cursor = 'grabbing';
            e.currentTarget.style.userSelect = 'none';
          }}
          onMouseMove={(e) => {
            if (!isDraggingRef.current) return;
            const delta = dragStartXRef.current - e.pageX;
            if (tabScrollRef.current) tabScrollRef.current.scrollLeft = scrollStartRef.current + delta;
          }}
          onMouseUp={(e) => {
            isDraggingRef.current = false;
            e.currentTarget.style.cursor = '';
            e.currentTarget.style.userSelect = '';
          }}
          onMouseLeave={(e) => {
            if (isDraggingRef.current) {
              isDraggingRef.current = false;
              e.currentTarget.style.cursor = '';
              e.currentTarget.style.userSelect = '';
            }
          }}
          className={`flex border-b ${borderClass} overflow-x-auto scrollbar-hide cursor-grab select-none relative`}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                data-active={isActive ? 'true' : 'false'}
                onClick={() => {
                  if (Math.abs((tabScrollRef.current?.scrollLeft || 0) - scrollStartRef.current) < 4) {
                    setActiveTab(tab.id);
                  }
                }}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                  isActive ? textPrimaryClass : textSecondaryClass
                }`}
                style={{
                  borderBottom: '3px solid transparent',
                  marginBottom: '-1px',
                }}
                data-testid={`tab-${tab.id}`}
                role="tab"
                aria-selected={isActive}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.count > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 text-xs rounded-full ${
                    isActive ? 'bg-amber-500/20 text-amber-500' : isLight ? 'bg-gray-200 text-gray-600' : 'bg-zinc-700 text-gray-300'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
          {/* Sliding orange indicator bar */}
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              height: 3,
              backgroundColor: '#f59e0b',
              borderRadius: '2px 2px 0 0',
              transform: `translateX(${indicatorStyle.left}px)`,
              width: indicatorStyle.width,
              transition: 'transform 0.25s ease, width 0.25s ease',
              pointerEvents: 'none',
            }}
          />
        </div>

        {/* Left fade + arrow */}
        {showLeftArrow && (
          <button
            onClick={() => scrollTabs(-1)}
            className={`absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 ${
              isLight ? 'bg-gradient-to-r from-gray-50 to-transparent' : isBeach ? 'bg-gradient-to-r from-background to-transparent' : 'bg-gradient-to-r from-card to-transparent'
            }`}
            aria-label="Scroll tabs left"
          >
            <ChevronLeft className={`w-4 h-4 ${textSecondaryClass}`} />
          </button>
        )}

        {/* Right fade + arrow */}
        {showRightArrow && (
          <button
            onClick={() => scrollTabs(1)}
            className={`absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 ${
              isLight ? 'bg-gradient-to-l from-gray-50 to-transparent' : isBeach ? 'bg-gradient-to-l from-background to-transparent' : 'bg-gradient-to-l from-card to-transparent'
            }`}
            aria-label="Scroll tabs right"
          >
            <ChevronRight className={`w-4 h-4 ${textSecondaryClass}`} />
          </button>
        )}
      </div>
    </div>
  );
};
