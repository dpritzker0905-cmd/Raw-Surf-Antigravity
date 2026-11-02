import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '../../../../frontend/src/contexts/ThemeContext';
import { AdminSupportDashboard } from '../../../../frontend/src/components/admin/AdminSupportDashboard';

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <main className="max-w-6xl mx-auto p-4">
      <h1 className="text-xl mb-4">Support selection repair — fictional local fixture</h1>
      <AdminSupportDashboard />
    </main>
  </ThemeProvider>
);
