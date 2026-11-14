import React from 'react';
import TruthOverlay from './TruthOverlay';

/** Internal diagnostics stay available explicitly without a clipped automatic mobile panel. */
export default function MapDiagnostics(props) {
  const explicit = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('diag') === '1';
  return <div className="weather-internal-diagnostics" data-explicit-diag={explicit}><TruthOverlay {...props} /></div>;
}
