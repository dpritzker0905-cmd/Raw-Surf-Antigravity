/**
 * useEscapeKey -- Reusable hook to close drawers/modals on Escape key press.
 *
 * Usage:
 *   useEscapeKey(isOpen, onClose);
 *
 * Best practices:
 *   - Only adds listener when component is open
 *   - Auto-cleans up on unmount or when closed
 *   - Works with any component that has an isOpen/onClose pattern
 */
import { useEffect } from 'react';

const useEscapeKey = (isOpen, onClose) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
};

export default useEscapeKey;
