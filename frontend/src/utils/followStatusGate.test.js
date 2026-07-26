import { createFollowStatusGate } from './followStatusGate';

describe('createFollowStatusGate', () => {
  it('rejects a profile-open follow-status response after a newer mutation starts', () => {
    const gate = createFollowStatusGate();
    const profileOpenSnapshot = gate.snapshot();

    gate.invalidate();

    expect(gate.isCurrent(profileOpenSnapshot)).toBe(false);
    expect(gate.isCurrent(gate.snapshot())).toBe(true);
  });
});