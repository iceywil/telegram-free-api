import { describe, expect, it } from 'vitest';
import { BRIDGE_SCRIPT } from '../src/internal/bridge.js';

/** Run the bridge against a fake Telegram Web `rootScope`. */
function loadBridge(managers: any) {
  const listeners: Record<string, (p: any) => void> = {};
  const emitted: any[] = [];
  const window: any = {
    rootScope: { managers, myId: 7, addEventListener: (n: string, f: any) => (listeners[n] = f) },
    __tgwEmit: (name: string, payload: any) => emitted.push([name, payload]),
  };
  new Function('window', 'btoa', 'atob', BRIDGE_SCRIPT)(window, btoa, atob);
  return { tgw: window.__tgw, listeners, emitted };
}

describe('bridge', () => {
  it('round-trips bytes and saves peers from responses', async () => {
    const saved: any[] = [];
    const { tgw } = loadBridge({
      apiManager: {
        invokeApi: async (_m: string, params: any) => ({
          echo: params.file_reference instanceof Uint8Array ? Array.from(params.file_reference) : null,
          bytes: new Uint8Array([1, 2, 255]),
          users: [{ _: 'user', id: 1 }],
        }),
      },
      appUsersManager: { saveApiUsers: async (u: any) => saved.push(...u) },
      appChatsManager: { saveApiChats: async () => {} },
    });
    const r = await tgw.invoke('x.y', { file_reference: { _bytes: btoa('\x01\x02') } });
    expect(r.ok).toBe(true);
    expect(r.value.echo).toEqual([1, 2]);
    expect(r.value.bytes).toEqual({ _bytes: btoa('\x01\x02\xff') });
    expect(saved).toEqual([{ _: 'user', id: 1 }]);
  });

  it('reports RPC errors', async () => {
    const { tgw } = loadBridge({
      apiManager: { invokeApi: async () => Promise.reject({ type: 'PEER_FLOOD', code: 400 }) },
    });
    expect(await tgw.invoke('messages.sendMessage', {})).toEqual({ ok: false, error: { type: 'PEER_FLOOD', code: 400 } });
  });

  it('forwards subscribed events', () => {
    const { tgw, listeners, emitted } = loadBridge({ apiManager: {} });
    tgw.subscribe('history_multiappend');
    tgw.subscribe('history_multiappend'); // idempotent
    listeners.history_multiappend({ mid: 1, cb: () => {} });
    expect(emitted).toEqual([['history_multiappend', { mid: 1 }]]);
    expect(tgw.ready()).toBe(true);
  });
});
