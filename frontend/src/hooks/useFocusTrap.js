/**
 * useFocusTrap -- Traps keyboard focus inside a container element.
 *
 * Usage:
 *   const trapRef = useFocusTrap(isOpen);
 * return <div ref={trapRef}>Gmodal contentG</div>;
 *
 * When active:
 *   - Tab / Shift+Tab cycles through focusable children only
 *   - Escape key calls onEscape() if provided
 *   - Focus is restored to the previously focused element on close
 */
import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'textarea:not([disabled])', 'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

export function useFocusTrap(isActive, { onEscape } = {}) {
  const containerRef = useRef(null);
  const previousFocus = useRef(null);

  const handleKeyDown = useCallback((e) => {
    if (!containerRef.current) return;

    if (e.key === 'Escape' && onEscape) {
      onEscape();
      return;
    }

    if (e.key !== 'Tab') return;

    const focusable = containerRef.current.querySelectorAll(FOCUSABLE);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [onEscape]);

  useEffect(() => {
    if (!isActive) return;

    previousFocus.current = document.activeElement;

    // Focus first focusable element inside container
    const timer = setTimeout(() => {
      if (!containerRef.current) return;
      const focusable = containerRef.current.querySelectorAll(FOCUSABLE);
      if (focusable.length > 0) focusable[0].focus();
    }, 50);

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus
      if (previousFocus.current && previousFocus.current.focus) {
        previousFocus.current.focus();
      }
    };
  }, [isActive, handleKeyDown]);

  return containerRef;
}

export default useFocusTrap;
