import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { PasswordSecurityCard } from './PasswordSecurityCard';
import { LegalSection } from './LegalSection';
import apiClient from '../../lib/apiClient';

jest.mock('react-router-dom', () => ({ Link: ({ children, to }) => <a href={to}>{children}</a> }), { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'fixture-owner' } }) }));

jest.mock('../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(() => Promise.resolve({ data: {} })) } }));
jest.mock('./DeleteAccountSection', () => ({ __esModule: true, default: () => null }));
beforeEach(() => apiClient.get.mockResolvedValue({ data: {} }));

const Fixture = ({ Component }) => {
  const [expandedSections, setExpanded] = useState({ security: false, legal: false });
  return <Component expandedSections={expandedSections} toggleSection={section => setExpanded(previous => ({
    ...previous, [section]: !previous[section],
  }))} />;
};

test.each([['Password & Security', PasswordSecurityCard], ['Legal', LegalSection]])(
  '%s has a native disclosure button and a persistent associated panel', async (name, Component) => {
    render(<Fixture Component={Component} />);
    const keyboard = userEvent.setup();
    const header = screen.getByRole('button', { name, exact: true });
    const panel = document.getElementById(header.getAttribute('aria-controls'));
    expect(panel.hidden).toBe(true);
    header.focus();
    await keyboard.keyboard('{Enter}');
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(panel.hidden).toBe(false);
    await keyboard.keyboard(' ');
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(panel.hidden).toBe(true);
    expect(header).toHaveFocus();
  });
