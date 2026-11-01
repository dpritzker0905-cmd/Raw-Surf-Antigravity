import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './browser-auth';
import { ThemeProvider } from '../../../../frontend/src/contexts/ThemeContext';
import { Auth } from '../../../../frontend/src/components/Auth';
import SupportRoute from '../../../../frontend/src/components/support/SupportRoute';
createRoot(document.getElementById('root')).render(<BrowserRouter><AuthProvider><ThemeProvider>
  <Routes><Route path="/auth" element={<Auth />} /><Route path="/support" element={<SupportRoute />} />
    <Route path="/support/tickets/:ticketId" element={<SupportRoute />} /><Route path="*" element={<p>Unexpected fixture route</p>} />
  </Routes>
</ThemeProvider></AuthProvider></BrowserRouter>);
