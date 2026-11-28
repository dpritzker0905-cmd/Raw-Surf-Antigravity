import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MessagesPage from './MessagesPage';
import apiClient from '../lib/apiClient';

jest.mock('react-router-dom', () => {
  const navigate = jest.fn();
  return { useNavigate: () => navigate, useLocation: () => ({}), useParams: () => ({ conversationId: 'thread' }), useSearchParams: () => [new URLSearchParams(), jest.fn()] };
}, { virtual: true });
jest.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
jest.mock('../contexts/PersonaContext', () => ({ usePersona: () => ({ getEffectiveRole: () => 'Surfer' }) }));
jest.mock('../lib/supabase', () => ({ supabase: { channel: () => ({ on: () => ({ subscribe: jest.fn() }) }), removeChannel: jest.fn() } }));
jest.mock('../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../hooks/usePresence', () => () => ({ isOnline: () => false }));
jest.mock('./messages/ComposeModal', () => () => null);
jest.mock('./messages/CreateNoteModal', () => () => null);
jest.mock('./messages/ViewNoteModal', () => () => null);
jest.mock('./messages/ConversationListPanel', () => () => null);
jest.mock('./messages/ChatViewPanel', () => {
  const MessageBubble = require('./messages/MessageBubble').default;
  return function TestPanel({ newMessage, setNewMessage, handleSendMessage, conversationDetail, handleReaction }) {
    return <section aria-label="Chat">
      <form onSubmit={handleSendMessage}>
        <input aria-label="Draft" value={newMessage} onChange={e => setNewMessage(e.target.value)} />
        <button>Send</button>
      </form>
      {conversationDetail?.messages?.map(message => <MessageBubble key={message.id} message={message} onReact={handleReaction} />)}
    </section>;
  };
});

test('a newly sent DM accepts reactions only after it has its server ID', async () => {
  apiClient.get.mockImplementation(async path => ({ data: path.startsWith('/messages/conversation/')
    ? { id: 'thread', other_user_id: 'recipient', messages: [] }
    : path.startsWith('/notes') ? { feed: [] } : [] }));
  let confirmSend;
  apiClient.post.mockImplementation(path => path.startsWith('/messages/send?')
    ? new Promise(resolve => { confirmSend = resolve; })
    : Promise.resolve({ data: {} }));
  render(<MessagesPage />);
  const chat = within((await screen.findAllByRole('region', { name: 'Chat' }))[0]);
  fireEvent.change(chat.getByRole('textbox'), { target: { value: 'Test message' } });
  fireEvent.click(chat.getByRole('button', { name: 'Send' }));
  fireEvent.contextMenu(chat.getByText('Test message'));
  expect(chat.queryByRole('button', { name: '🤙' })).toBeNull();
  await act(async () => confirmSend({ data: { id: 'saved-message', conversation_id: 'thread' } }));
  fireEvent.contextMenu(chat.getByText('Test message'));
  fireEvent.click(chat.getByRole('button', { name: '🤙' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/messages/react/saved-message?user_id=viewer', { emoji: '🤙' }));
});
