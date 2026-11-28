import { renderHook } from '@testing-library/react';
import apiClient from '../lib/apiClient';
import useProfileActions from './useProfileActions';

jest.mock('../lib/apiClient', () => ({ get: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));

const options = profileUserId => ({
  user: { id: 'viewer' }, profileUserId, isOwnProfile: profileUserId === 'viewer',
  navigate: jest.fn(), setProfile: jest.fn(), setLoading: jest.fn(), setStreak: jest.fn()
});

beforeEach(() => jest.resetAllMocks());

test('visiting another author skips the private streak, while an own-profile visit loads it', async () => {
  const visitor = renderHook(() => useProfileActions(options('author')));
  await visitor.result.current.fetchStreak();
  expect(apiClient.get).not.toHaveBeenCalled();
  const ownerOptions = options('viewer');
  const owner = renderHook(() => useProfileActions(ownerOptions));
  apiClient.get.mockResolvedValueOnce({ data: { current_streak: 2 } });
  await owner.result.current.fetchStreak();
  expect(apiClient.get).toHaveBeenCalledWith('/streak/viewer');
  expect(ownerOptions.setStreak).toHaveBeenCalledWith({ current_streak: 2 });
});

test('an obsolete profile error cannot redirect the next profile visit', async () => {
  const params = options('old');
  let reject;
  apiClient.get.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
  const visit = renderHook(() => useProfileActions(params));
  const pending = visit.result.current.fetchProfile();
  visit.unmount();
  reject({ response: { status: 404 } });
  await pending;
  expect(apiClient.get.mock.calls[0][1].signal.aborted).toBe(true);
  expect(params.navigate).not.toHaveBeenCalled();
});

test('retry loads the same author after a transient failure', async () => {
  const params = options('author');
  apiClient.get.mockRejectedValueOnce({ response: { status: 503 } })
    .mockResolvedValueOnce({ data: { id: 'author' } });
  const visit = renderHook(() => useProfileActions(params));
  await visit.result.current.fetchProfile();
  expect(params.setLoading).toHaveBeenLastCalledWith(false);
  expect(params.navigate).not.toHaveBeenCalled();
  await visit.result.current.fetchProfile();
  expect(params.setProfile).toHaveBeenCalledWith({ id: 'author' });
});
