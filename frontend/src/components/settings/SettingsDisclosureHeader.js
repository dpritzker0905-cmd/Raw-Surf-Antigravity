import React from 'react';
import { CardHeader } from '../ui/card';

// Keep the existing card header geometry while using native disclosure controls.
export const SettingsDisclosureHeader = ({ section, expanded, onToggle, children }) => (
  <CardHeader className="p-0 space-y-0">
    <button type="button" aria-expanded={expanded} aria-controls={`settings-${section}-content`}
      onClick={onToggle}
      className="w-full p-6 text-left rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </button>
  </CardHeader>
);
