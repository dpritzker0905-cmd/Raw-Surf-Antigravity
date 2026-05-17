/**
 * CareerPage GÇö Layout wrapper for career / gamification routes.
 * Provides consistent max-width + padding for all career-section pages.
 *
 * Replaces the inline <div className="max-w-2xl mx-auto p-4">
 * wrapper that was duplicated across 8 career routes in App.js.
 */
import React from 'react';

const CareerPage = ({ children }) => (
  <div className="max-w-2xl mx-auto p-4">
    {children}
  </div>
);

export default CareerPage;
