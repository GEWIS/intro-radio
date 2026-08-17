import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RadioChat from '@/components/RadioChat.vue';
// Import the mocked module's own `__isClosed` export below (see vi.mock) rather than
// building the ref via `vi.hoisted()`: `vi.hoisted()` callbacks run before Vite's
// import proxies for real modules like 'vue' are initialized in this Vitest setup, so
// calling the imported `ref()` in there throws "Cannot access '...' before
// initialization". Creating the ref inside the (lazily-invoked) mock factory instead,
// via a dynamic `import('vue')`, sidesteps that ordering problem.
import { __isClosed as isClosedRef } from '@/composables/useChatSocket';
import { mountWithVuetify } from '@/test-utils';

const { connectMock, disconnectMock, sendMock, onMessageHolder } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  disconnectMock: vi.fn(),
  sendMock: vi.fn().mockReturnValue(true),
  onMessageHolder: { current: null as ((msg: { content: string }) => void) | null },
}));

vi.mock('@/composables/useChatSocket', async () => {
  const { ref } = await import('vue');
  // A real Vue ref (not a plain `{ value }` object) is required here: RadioChat.vue's
  // template reads `isClosed` directly (e.g. `v-if="!isClosed"`), relying on Vue's
  // script-setup ref auto-unwrapping, which checks for the internal `__v_isRef`
  // marker that only a genuine `ref()` carries.
  const isClosed = ref(false);
  return {
    __isClosed: isClosed,
    useChatSocket: (options: { onMessage: (msg: { content: string }) => void }) => {
      onMessageHolder.current = options.onMessage;
      return { isClosed, connecting: ref(false), connect: connectMock, disconnect: disconnectMock, send: sendMock };
    },
  };
});
vi.mock('@/composables/useGewisAuth', () => ({
  useGewisAuth: () => ({ getToken: () => 'tok' }),
}));

describe('RadioChat', () => {
  beforeEach(() => {
    connectMock.mockClear();
    disconnectMock.mockClear();
    sendMock.mockClear().mockReturnValue(true);
    isClosedRef.value = false;
  });

  it('connects on mount', () => {
    mountWithVuetify(RadioChat);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('disconnects on unmount', () => {
    const wrapper = mountWithVuetify(RadioChat);
    wrapper.unmount();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('renders an incoming message from the radio', async () => {
    // `mountWithVuetify` (like `@vue/test-utils`'s `mount`) renders into a detached
    // element rather than appending it to `document.body`, so assert against the
    // wrapper's own text rather than `document.body.textContent` (which stays empty).
    const wrapper = mountWithVuetify(RadioChat);
    onMessageHolder.current!({ content: 'welcome!' });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('welcome!');
  });

  it('sends a typed message, echoes it locally, and clears the input', async () => {
    const wrapper = mountWithVuetify(RadioChat);

    await wrapper.get('input').setValue('hello there');
    await wrapper.get('input').trigger('keydown.enter');

    expect(sendMock).toHaveBeenCalledWith({ content: 'hello there' });
    expect(wrapper.text()).toContain('hello there');
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('');
  });

  it('does not send an empty or whitespace-only message', async () => {
    const wrapper = mountWithVuetify(RadioChat);

    await wrapper.get('input').setValue(' '.repeat(3));
    sendMock.mockClear(); // setValue's own input event fires a (legitimate) typing signal
    await wrapper.get('input').trigger('keydown.enter');

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('shows the reconnect prompt when the socket is closed', () => {
    isClosedRef.value = true;
    const wrapper = mountWithVuetify(RadioChat);

    expect(wrapper.text()).toContain('did you log in in another tab?');
    expect(wrapper.get('input').attributes('disabled')).toBeDefined();
  });

  it('shows "Radio is typing..." on an incoming typing signal, and hides it again after the display timeout', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountWithVuetify(RadioChat);
      expect(wrapper.text()).not.toContain('Radio is typing...');

      onMessageHolder.current!({ type: 'typing' } as unknown as { content: string });
      await wrapper.vm.$nextTick();
      expect(wrapper.text()).toContain('Radio is typing...');

      vi.advanceTimersByTime(3000);
      await wrapper.vm.$nextTick();
      expect(wrapper.text()).not.toContain('Radio is typing...');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not mistake a typing signal for a real chat message', async () => {
    const wrapper = mountWithVuetify(RadioChat);

    onMessageHolder.current!({ type: 'typing' } as unknown as { content: string });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain('Radio:');
  });

  it('typing into the input sends a throttled typing signal', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountWithVuetify(RadioChat);

      await wrapper.get('input').setValue('h');
      expect(sendMock).toHaveBeenCalledWith({ type: 'typing' });

      sendMock.mockClear();
      await wrapper.get('input').setValue('he'); // immediately again -- throttled
      expect(sendMock).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2000);
      await wrapper.get('input').setValue('hel');
      expect(sendMock).toHaveBeenCalledWith({ type: 'typing' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RadioChat attachments', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads a selected picture and shows it as a sent attachment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'abc', purpose: 'chat_attachment', kind: 'photo' }) }),
    );

    const wrapper = mountWithVuetify(RadioChat);
    const fileInput = wrapper.get('input[type="file"]');
    const file = new File(['fake-image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput.element, 'files', { value: [file] });
    await fileInput.trigger('change');
    await wrapper.vm.$nextTick();

    expect(fetch).toHaveBeenCalledWith('/api/v1/media', expect.objectContaining({ method: 'POST' }));
    expect(wrapper.find('img').exists()).toBe(true);
  });

  it('does nothing when no file is selected', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const wrapper = mountWithVuetify(RadioChat);
    const fileInput = wrapper.get('input[type="file"]');
    Object.defineProperty(fileInput.element, 'files', { value: [] });
    await fileInput.trigger('change');

    expect(fetch).not.toHaveBeenCalled();
  });
});
