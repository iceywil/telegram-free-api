/**
 * The in-page half of the client, injected into web.telegram.org/k.
 *
 * Telegram Web K exposes `window.rootScope.managers`: proxies to its MTProto
 * worker. `apiManager.invokeApi(method, params)` is the real Telegram API
 * (the same one GramJS/Telethon speak) running on the page's logged-in session.
 * The `app*Manager` proxies are the web app's own higher-level logic (peer
 * cache, sending with UI sync…).
 *
 * Kept as a plain JS string (not a serialized TS function) so bundlers can't
 * inject helpers like `__name` that don't exist in the page.
 *
 * Wire format: Uint8Array ⇄ `{ _bytes: base64 }`, errors ⇄ `{ ok: false, error }`.
 */
export const BRIDGE_SCRIPT = String.raw`
(() => {
  if (window.__tgw) return;

  const enc = (v, seen = new WeakSet()) => {
    if (typeof v === 'function') return undefined;
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
      const u = v instanceof Uint8Array ? v : new Uint8Array(v);
      let s = '';
      for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      return { _bytes: btoa(s) };
    }
    if (seen.has(v)) return undefined;
    seen.add(v);
    if (Array.isArray(v)) return v.map((x) => enc(x, seen));
    const o = {};
    for (const k in v) {
      const x = enc(v[k], seen);
      if (x !== undefined) o[k] = x;
    }
    return o;
  };

  const dec = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(dec);
    if (typeof v._bytes === 'string' && Object.keys(v).length === 1) {
      const s = atob(v._bytes);
      const u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      return u;
    }
    const o = {};
    for (const k in v) o[k] = dec(v[k]);
    return o;
  };

  const errOf = (e) => ({
    type: (e && (e.type || e.message)) || String(e),
    code: e && typeof e.code === 'number' ? e.code : undefined,
  });

  const managers = () => window.rootScope.managers;

  const wrap = async (fn) => {
    try {
      return { ok: true, value: enc(await fn()) };
    } catch (e) {
      return { ok: false, error: errOf(e) };
    }
  };

  // Feed users/chats from raw responses into the web app's peer cache, so
  // high-level calls (sendText, getInputPeerById) know their access hashes.
  const savePeers = async (res) => {
    if (!res || typeof res !== 'object') return;
    const m = managers();
    if (Array.isArray(res.users) && res.users.length) await m.appUsersManager.saveApiUsers(res.users);
    if (Array.isArray(res.chats) && res.chats.length) await m.appChatsManager.saveApiChats(res.chats);
  };

  const subs = new Set();

  window.__tgw = {
    // Return booleans/plain data only: the manager proxies answer *every*
    // property (including "then"), which would make them look like promises.
    ready: () => !!(window.rootScope && window.rootScope.managers && window.rootScope.managers.apiManager),

    authState: async () => {
      try {
        const s = await managers().appStateManager.getState();
        return {
          state: (s && s.authState && s.authState._) || null,
          myId: window.rootScope.myId ? Number(window.rootScope.myId) : 0,
        };
      } catch (e) {
        return { state: null, myId: 0 };
      }
    },

    invoke: (method, params, options) =>
      wrap(async () => {
        const res = await managers().apiManager.invokeApi(method, dec(params || {}), options || {});
        await savePeers(res);
        return res;
      }),

    call: (manager, method, args) =>
      wrap(() => managers()[manager][method](...dec(args || []))),

    subscribe: (name) => {
      if (subs.has(name)) return true;
      subs.add(name);
      window.rootScope.addEventListener(name, (payload) => {
        try { window.__tgwEmit(name, enc(payload)); } catch (e) {}
      });
      return true;
    },
  };
})();
`;
