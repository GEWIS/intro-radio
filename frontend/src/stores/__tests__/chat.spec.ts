import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useChatStore } from '../chat';

// Same hoisting reasoning as AdminChat.vue.spec.ts: isClosedBox has to stay
// a plain container here so the real `ref()` can be constructed lazily
// inside the mock factory, well after this file's imports have resolved.
const { connectMock, disconnectMock, sendMock, notifyMock, onMessageHolder } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  disconnectMock: vi.fn(),
  sendMock: vi.fn().mockReturnValue(true),
  notifyMock: vi.fn(),
  onMessageHolder: { current: null as ((msg: unknown) => void) | null },
}));

vi.mock('@/composables/useChatSocket', () => ({
  useChatSocket: (options: { onMessage: (msg: unknown) => void }) => {
    onMessageHolder.current = options.onMessage;
    return {
      isClosed: ref(false),
      connecting: ref(false),
      connect: connectMock,
      disconnect: disconnectMock,
      send: sendMock,
    };
  },
}));
vi.mock('@/composables/useGewisAuth', () => ({
  useGewisAuth: () => ({ getToken: () => 'tok' }),
}));
vi.mock('@/composables/useChatNotifications', () => ({
  useChatNotifications: () => ({ notify: notifyMock }),
}));

function incoming(overrides: Record<string, unknown>) {
  return { from: 'u1', content: 'hi', ...overrides };
}

describe('useChatStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    connectMock.mockClear();
    disconnectMock.mockClear();
    sendMock.mockClear().mockReturnValue(true);
    notifyMock.mockClear();
  });

  it('ensureConnected only opens the socket once, even if called again with the same or a different key', () => {
    const store = useChatStore();

    store.ensureConnected('key-a');
    store.ensureConnected('key-a');
    store.ensureConnected('key-b');

    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('connect() bypasses the ensureConnected guard, for the explicit Reconnect action', () => {
    const store = useChatStore();
    store.ensureConnected('key-a');
    connectMock.mockClear();

    store.connect();

    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('notifies on an incoming listener message but not on a mirrored radio reply', () => {
    const store = useChatStore();
    store.ensureConnected('key-a');

    onMessageHolder.current!(incoming({ from: 'u1', given_name: 'Ada', family_name: 'Lovelace' }));
    expect(notifyMock).toHaveBeenCalledWith('Ada Lovelace', 'hi');

    notifyMock.mockClear();
    onMessageHolder.current!({ from: '99999', to: 'u1', content: 'handled', given_name: 'Bob' });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('totalUnread sums unread across every user, not just the active one', () => {
    const store = useChatStore();
    store.ensureConnected('key-a');

    // First-ever message auto-selects u1 as active (0 unread for them);
    // u2 and u3 arrive while someone else is active, so both accumulate.
    onMessageHolder.current!(incoming({ from: 'u1' }));
    onMessageHolder.current!(incoming({ from: 'u2' }));
    onMessageHolder.current!(incoming({ from: 'u2' }));
    onMessageHolder.current!(incoming({ from: 'u3' }));

    expect(store.totalUnread).toBe(3);

    store.selectUser('u2');
    expect(store.totalUnread).toBe(1); // only u3's remains
  });

  it('updates admins from an incoming presence message, without treating it as a chat message', () => {
    const store = useChatStore();
    store.ensureConnected('key-a');

    onMessageHolder.current!({ type: 'presence', admins: [{ id: '1', given_name: 'Ada', family_name: 'Lovelace' }] });

    expect(store.admins).toEqual([{ id: '1', given_name: 'Ada', family_name: 'Lovelace' }]);
    expect(store.totalUnread).toBe(0);
    expect(store.users).toHaveLength(0);
  });

  it('replaces the admins list wholesale on each new presence message', () => {
    const store = useChatStore();
    store.ensureConnected('key-a');

    onMessageHolder.current!({ type: 'presence', admins: [{ id: '1' }, { id: '2' }] });
    onMessageHolder.current!({ type: 'presence', admins: [{ id: '1' }] });

    expect(store.admins).toEqual([{ id: '1' }]);
  });

  it('sets a typing flag from an incoming typing message, without treating it as a chat message', () => {
    const store = useChatStore();
    store.ensureConnected('key-a');

    onMessageHolder.current!({ type: 'typing', from: 'u1' });

    expect(store.typingUsers).toEqual({ u1: true });
    expect(store.totalUnread).toBe(0);
    expect(store.users).toHaveLength(0);
  });

  it('clears a typing flag automatically after the display timeout', () => {
    vi.useFakeTimers();
    try {
      const store = useChatStore();
      store.ensureConnected('key-a');

      onMessageHolder.current!({ type: 'typing', from: 'u1' });
      expect(store.typingUsers).toEqual({ u1: true });

      vi.advanceTimersByTime(3000);
      expect(store.typingUsers).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it('a fresh typing signal refreshes the timeout instead of stacking a second one', () => {
    vi.useFakeTimers();
    try {
      const store = useChatStore();
      store.ensureConnected('key-a');

      onMessageHolder.current!({ type: 'typing', from: 'u1' });
      vi.advanceTimersByTime(2000);
      onMessageHolder.current!({ type: 'typing', from: 'u1' }); // refresh before the first would expire

      vi.advanceTimersByTime(2000); // 4s since the first signal, but only 2s since the refresh
      expect(store.typingUsers).toEqual({ u1: true });

      vi.advanceTimersByTime(1000); // 3s since the refresh
      expect(store.typingUsers).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifyTyping sends a typing signal to the active user, throttled, and does nothing with no active user', () => {
    vi.useFakeTimers();
    try {
      const store = useChatStore();
      store.ensureConnected('key-a');

      store.notifyTyping(); // no active user yet
      expect(sendMock).not.toHaveBeenCalled();

      onMessageHolder.current!(incoming({ from: 'u1' })); // auto-selects u1 as active
      store.notifyTyping();
      expect(sendMock).toHaveBeenCalledWith({ type: 'typing', to: 'u1' });

      sendMock.mockClear();
      store.notifyTyping(); // immediately again -- throttled
      expect(sendMock).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2000);
      store.notifyTyping();
      expect(sendMock).toHaveBeenCalledWith({ type: 'typing', to: 'u1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists across being retrieved again in the same Pinia instance, simulating route navigation', () => {
    // AdminChat.vue and dashboard.vue both call useChatStore() independently
    // -- this is the whole point of moving state here instead of leaving it
    // local to AdminChat.vue, which used to reset on every mount/unmount.
    const first = useChatStore();
    first.ensureConnected('key-a');
    onMessageHolder.current!(incoming({ from: 'u1' }));
    onMessageHolder.current!(incoming({ from: 'u2' }));

    const second = useChatStore();

    expect(second.totalUnread).toBe(first.totalUnread);
    expect(second.users).toHaveLength(2);
    expect(connectMock).toHaveBeenCalledTimes(1); // navigating back doesn't reopen the socket
  });
});
