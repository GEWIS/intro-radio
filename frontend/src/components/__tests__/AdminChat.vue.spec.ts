import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import AdminChat from '@/components/AdminChat.vue';
import { mountWithVuetify } from '@/test-utils';

// vi.mock() factories are hoisted above regular top-level statements -- even
// above this file's own imports -- so a value that needs `ref()` from 'vue'
// can't be built inside vi.hoisted() itself (that throws a TDZ error on the
// 'vue' import). Instead, isClosedBox stays a plain hoisted container, and
// the real `ref()` is created lazily inside the (deferred) useChatSocket
// mock below, which only ever runs at component-setup time -- i.e. well
// after every import in this file has resolved.
const { connectMock, disconnectMock, sendMock, isClosedBox, onMessageHolder } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  disconnectMock: vi.fn(),
  sendMock: vi.fn().mockReturnValue(true),
  isClosedBox: { current: null as { value: boolean } | null },
  onMessageHolder: { current: null as ((msg: unknown) => void) | null },
}));

vi.mock('@/composables/useChatSocket', () => ({
  useChatSocket: (options: { onMessage: (msg: unknown) => void }) => {
    onMessageHolder.current = options.onMessage;
    // Must be a real Vue ref, not a plain `{ value: false }` object: the
    // component's template references `isClosed` directly (relying on
    // <script setup>'s automatic ref-unwrapping in templates), and Vue only
    // unwraps values that pass its internal `isRef()` check. A plain object
    // would render as an always-truthy object in `v-if="!isClosed"` and
    // `:disabled="isClosed || !activeUser"`, breaking both regardless of
    // the value actually assigned to it. Reused across mounts so a test can
    // still reach in and flip it after the fact.
    isClosedBox.current ??= ref(false);
    return {
      isClosed: isClosedBox.current,
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

// Real shape of an incoming message, per AdminChat.vue's own `Outgoing` type.
function incoming(overrides: Record<string, unknown>) {
  return { from: 'u1', content: 'hi', ...overrides };
}

describe('AdminChat', () => {
  beforeEach(() => {
    connectMock.mockClear();
    disconnectMock.mockClear();
    sendMock.mockClear().mockReturnValue(true);
    if (isClosedBox.current) isClosedBox.current.value = false;
  });

  // AdminChat.vue's onMessage handler auto-selects a sender as the active
  // user whenever nothing else is active yet (`if (!activeUser.value && ...)
  // { activeUser.value = chatId; usersMap.value[chatId].unread = 0 }`), so
  // the very first message anyone ever sends both creates the user *and*
  // immediately clears their own unread count -- there is deliberately no
  // badge here, unlike a naive "every message increments unread" reading of
  // the component would suggest.
  it('auto-selects the first-ever sender, with no unread badge', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });

    onMessageHolder.current!(incoming({ from: 'u1', given_name: 'Ada', family_name: 'Lovelace' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Ada Lovelace (mu1)'); // users-list title format
    expect(wrapper.text()).toContain('Ada Lovelace (u1)'); // "Chat with:" header format (no "m" prefix)
    expect(wrapper.find('.v-badge__badge').exists()).toBe(false);
  });

  it('disables the message field until a user is selected, and ignores Enter while disabled', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });

    expect(wrapper.get('input').attributes('disabled')).toBeDefined();
    await wrapper.get('input').trigger('keydown.enter');
    expect(sendMock).not.toHaveBeenCalled();

    onMessageHolder.current!(incoming({ from: 'u1', given_name: 'Ada', family_name: 'Lovelace' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.get('input').attributes('disabled')).toBeUndefined();
  });

  it('shows an unread badge for a second sender while a different user is active', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });

    // First-ever message auto-selects u1 (see above), so u2's message below
    // is the one that actually exercises the unread-increment path.
    onMessageHolder.current!(incoming({ from: 'u1', given_name: 'Ada', family_name: 'Lovelace' }));
    await wrapper.vm.$nextTick();
    onMessageHolder.current!(incoming({ from: 'u2', content: 'hey', given_name: 'Bob', family_name: 'Builder' }));
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('.v-list-item');
    const u1Item = items.find((i) => i.text().includes('Ada Lovelace'))!;
    const u2Item = items.find((i) => i.text().includes('Bob Builder'))!;

    expect(u1Item.find('.v-badge__badge').exists()).toBe(false);
    expect(u2Item.find('.v-badge__badge').exists()).toBe(true);
    expect(u2Item.text()).toContain('1');
  });

  it('selecting a badged user clears the badge and switches the chat panel to them', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });

    onMessageHolder.current!(incoming({ from: 'u1', given_name: 'Ada', family_name: 'Lovelace' }));
    await wrapper.vm.$nextTick();
    onMessageHolder.current!(incoming({ from: 'u2', content: 'hey', given_name: 'Bob', family_name: 'Builder' }));
    await wrapper.vm.$nextTick();

    const u2Item = wrapper.findAll('.v-list-item').find((i) => i.text().includes('Bob Builder'))!;
    await u2Item.trigger('click');

    expect(wrapper.find('.v-badge__badge').exists()).toBe(false);
    expect(wrapper.text()).toContain('Chat with:');
    expect(wrapper.text()).toContain('Bob Builder (u2)');
  });

  it("renders the selected user's own message history", async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });

    onMessageHolder.current!(incoming({ from: 'u1', content: 'first message', given_name: 'Ada', family_name: 'Lovelace' }));
    await wrapper.vm.$nextTick();
    onMessageHolder.current!(incoming({ from: 'u1', content: 'second message' }));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('first message');
    expect(wrapper.text()).toContain('second message');
  });

  it('sends a reply addressed to the active user, echoes it locally under Radio, and clears the input', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });
    onMessageHolder.current!(incoming({ from: 'u1', given_name: 'Ada', family_name: 'Lovelace' }));
    await wrapper.vm.$nextTick();

    await wrapper.get('input').setValue('reply text');
    await wrapper.get('input').trigger('keydown.enter');

    expect(sendMock).toHaveBeenCalledWith({ to: 'u1', content: 'reply text' });
    expect(wrapper.text()).toContain('reply text');
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('');
  });

  it('does not call send() when the socket reports closed, even with a user selected', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });
    onMessageHolder.current!(incoming({ from: 'u1', given_name: 'Ada', family_name: 'Lovelace' }));
    await wrapper.vm.$nextTick();
    isClosedBox.current!.value = true;
    await wrapper.vm.$nextTick();

    await wrapper.get('input').trigger('keydown.enter');

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('routes a mirrored `to`-addressed reply into the sender\'s existing thread as "Radio", without touching their stored name', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });
    onMessageHolder.current!(incoming({ from: 'u1', content: 'first', given_name: 'Ada', family_name: 'Lovelace' }));
    await wrapper.vm.$nextTick();

    // Another admin replied to u1 from a different session; the server
    // mirrors it back to us with `to` set instead of `from`.
    onMessageHolder.current!({ from: 'other-admin', to: 'u1', content: 'handled by someone else' });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('handled by someone else');
    expect(wrapper.text()).toContain('Ada Lovelace (mu1)'); // name untouched
    expect(wrapper.find('.v-badge__badge').exists()).toBe(false); // u1 is already active, no new unread
  });

  it('sorts users by most recent activity, newest first', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });

      onMessageHolder.current!(incoming({ from: 'u1', content: 'older', given_name: 'Ada', family_name: 'Lovelace' }));
      await wrapper.vm.$nextTick();

      vi.setSystemTime(new Date('2026-01-01T00:00:05Z'));
      onMessageHolder.current!(incoming({ from: 'u2', content: 'newer', given_name: 'Bob', family_name: 'Builder' }));
      await wrapper.vm.$nextTick();

      const titles = wrapper.findAll('.v-list-item-title').map((el) => el.text());
      expect(titles[0]).toContain('Bob Builder');
      expect(titles[1]).toContain('Ada Lovelace');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the reconnect prompt and disables the input when the socket is closed', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });
    isClosedBox.current!.value = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('did you log in in another tab?');
    expect(wrapper.get('input').attributes('disabled')).toBeDefined();
  });

  it('clicking Reconnect calls connect again', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });
    connectMock.mockClear(); // clear the connect() call from onMounted

    await wrapper.get('button').trigger('click'); // "Reconnect" is the only button while no user is selected (Send is a v-btn too, but disabled)

    expect(connectMock).toHaveBeenCalledTimes(1);
  });
});
