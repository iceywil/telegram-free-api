import { describe, expect, it } from 'vitest';
import { FloodWaitError, PeerFloodError, RpcError, toRpcError } from '../src/errors.js';
import { randomLong } from '../src/utils.js';

describe('toRpcError', () => {
  it('maps flood waits', () => {
    const e = toRpcError({ type: 'FLOOD_WAIT_42', code: 420 }, 'messages.sendMessage');
    expect(e).toBeInstanceOf(FloodWaitError);
    expect((e as FloodWaitError).seconds).toBe(42);
  });
  it('maps PEER_FLOOD', () => {
    expect(toRpcError({ type: 'PEER_FLOOD', code: 400 }, 'x')).toBeInstanceOf(PeerFloodError);
  });
  it('keeps other errors generic', () => {
    const e = toRpcError({ type: 'USERNAME_NOT_OCCUPIED', code: 400 }, 'contacts.resolveUsername');
    expect(e).toBeInstanceOf(RpcError);
    expect(e.message).toContain('USERNAME_NOT_OCCUPIED');
  });
});

describe('randomLong', () => {
  it('is a signed 64-bit decimal string', () => {
    const v = BigInt(randomLong());
    expect(v >= -(2n ** 63n) && v < 2n ** 63n).toBe(true);
  });
});
