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
