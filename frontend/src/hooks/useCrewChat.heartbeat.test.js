import { renderHook } from '@testing-library/react';
import useCrewChat from './useCrewChat';
import logger from '../utils/logger';

jest.mock('../lib/apiClient', () => ({
  __esModule: true,
  BACKEND_URL: 'http://localhost',
  default: { get: async () => ({ data: {} }) },
}));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));

test('plain pong is silent, reactions update messages, and malformed frames still report errors', () => {
  const socket = { close: jest.fn() };
  const ws = jest.spyOn(window, 'WebSocket').mockImplementation(() => socket);
  const props = {
    user: { id: 'viewer' }, bookingId: 'crew',
    setMessages: jest.fn(), setChatInfo: jest.fn(), setOnlineUsers: jest.fn(), setIsLoading: jest.fn(),
  };
  const { unmount } = renderHook(() => useCrewChat(props));
  try {
    socket.onmessage({ data: 'pong' });
    expect(logger.error).not.toHaveBeenCalled();
    expect(props.setMessages).not.toHaveBeenCalled();
    const reactions = { '🤙': ['viewer'] };
    socket.onmessage({ data: JSON.stringify({ type: 'reaction_update', data: { message_id: 'first', reactions } }) });
    const [update] = props.setMessages.mock.calls[0];
    expect(update([{ id: 'first' }])).toEqual([{ id: 'first', reactions }]);
    socket.onmessage({ data: 'broken frame' });
    expect(logger.error).toHaveBeenCalledWith('[CrewChat] Failed to parse message:', expect.any(SyntaxError));
  } finally {
    unmount();
    ws.mockRestore();
  }
});
