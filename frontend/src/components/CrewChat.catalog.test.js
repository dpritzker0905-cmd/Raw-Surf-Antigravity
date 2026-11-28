import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
jest.mock('react-router-dom', () => ({ useParams: () => ({ bookingId: 'booking' }), useNavigate: () => jest.fn() }), { virtual: true });
import CrewChat from './CrewChat';
import apiClient from '../lib/apiClient';
import { REACTION_EMOJIS } from '../constants/emojis';

jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
const mockReact = jest.fn();
jest.mock('../hooks/useCrewChat', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: function useFixture({ setChatInfo, setIsLoading, setMessages }) {
      React.useEffect(() => {
        setChatInfo({ location: 'Test', participants: [] });
        setMessages([{ id: 'message', sender_id: 'viewer', content: 'QA', message_type: 'text', reactions: {} }]);
        setIsLoading(false);
      }, [setChatInfo, setIsLoading, setMessages]);
      return { getTypingNames: () => [], formatTime: () => '', handleReaction: mockReact };
    }
  };
});

test('the crew picker uses every server choice, including legacy thumbs-up, against the selected message', async () => {
  const choices = [...REACTION_EMOJIS, '\u{1F44D}'];
  apiClient.get.mockResolvedValue({ data: { emojis: choices } });
  render(<CrewChat />);
  fireEvent.click(await screen.findByRole('button', { name: 'React to crew message' }));
  for (const emoji of choices) {
    fireEvent.click(await screen.findByRole('button', { name: emoji, exact: true, pressed: false }));
  }
  expect(mockReact.mock.calls).toEqual(choices.map(emoji => ['message', emoji]));
});
