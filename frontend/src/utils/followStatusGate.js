/**
 * Keeps a profile's asynchronous follow-status read from overwriting a newer
 * local follow/unfollow mutation.
 */
export const createFollowStatusGate = () => {
  let version = 0;

  return {
    snapshot: () => version,
    invalidate: () => {
      version += 1;
    },
    isCurrent: (snapshot) => snapshot === version,
  };
};