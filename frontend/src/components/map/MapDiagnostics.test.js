import React from 'react';
import { render, screen } from '@testing-library/react';
import MapDiagnostics from './MapDiagnostics';
jest.mock('./TruthOverlay', () => ({ activeModel }) => <output data-testid="diagnostic-model">{activeModel}</output>);

test.each([['', 'false'], ['?diag=1', 'true']])('internal diagnostics distinguish an explicit QA request %s', (query, expected) => {
  const original = `${location.pathname}${location.search}${location.hash}`;
  try {
    history.replaceState(history.state, '', `/${query}`);
    const { container } = render(<MapDiagnostics activeModel="GFS" />);
    expect(container.querySelector('.weather-internal-diagnostics')).toHaveAttribute('data-explicit-diag', expected);
    expect(screen.getByTestId('diagnostic-model')).toHaveTextContent('GFS');
  } finally { history.replaceState(history.state, '', original); }
});
