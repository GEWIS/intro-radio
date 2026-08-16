import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioStream from '@/components/AudioStream.vue';
import Landing from '@/components/Landing.vue';
import RadioChat from '@/components/RadioChat.vue';
import RequestSong from '@/components/RequestSong.vue';
import UpcomingEvents from '@/components/UpcomingEvents.vue';
import VideoStream from '@/components/VideoStream.vue';
import { useAppStore } from '@/stores/app';
import { mountWithVuetify } from '@/test-utils';

const { ensureTokenMock, getTokenMock } = vi.hoisted(() => ({
  ensureTokenMock: vi.fn(),
  getTokenMock: vi.fn(),
}));
vi.mock('@/composables/useGewisAuth', () => ({
  useGewisAuth: () => ({ ensureToken: ensureTokenMock, getToken: getTokenMock }),
}));

// Landing.vue never imports these five itself -- unplugin-vue-components
// auto-registers them by filename -- so this string-keyed `stubs` map only
// works because Vue's <script setup> compiler still stamps a `__name` on
// each component (derived from its filename) that Vue Test Utils' stub
// name-matching falls back to when there's no explicit import to read a
// binding name from. Confirmed against the real rendered wrapper (not just
// assumed): every one of these renders as an inert `<x-stub>` element below,
// so AudioStream's real fetch, VideoStream's real hls.js, and RadioChat's
// real WebSocket connect never fire in this file.
const CHILD_STUBS = {
  AudioStream: true,
  VideoStream: true,
  UpcomingEvents: true,
  RadioChat: true,
  RequestSong: true,
};

function mountLanding(startTime: Date, options: { attachTo?: Element } = {}) {
  setActivePinia(createPinia());
  const store = useAppStore();
  store.radio.startTime = startTime;
  return mountWithVuetify(Landing, { global: { stubs: CHILD_STUBS }, ...options });
}

describe('Landing', () => {
  beforeEach(() => {
    ensureTokenMock.mockReset();
    getTokenMock.mockReset().mockReturnValue(null);
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    // Landing renders a real (unstubbed) <v-img> for the logo. Without a
    // real IntersectionObserver, VImg falls back to polling load state via
    // setTimeout -- and if that timer is still pending when the test
    // environment tears down, it fires against a since-destroyed `window`,
    // throwing "window is not defined" as an unhandled rejection well after
    // the test itself already passed. Same fix AppFooter.vue.spec.ts already
    // applies for VFooter's ResizeObserver dependency.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    // The share button's "Link copied" v-snackbar renders via Vuetify's
    // VOverlay, same as PrivacyPolicy.vue.spec.ts's dialog and
    // AdminChat.vue.spec.ts's own reconnect toast -- neither of these is
    // implemented by jsdom at all.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('visualViewport', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the countdown card and hides every isStarted-gated child before start time', () => {
    const wrapper = mountLanding(new Date('2026-06-01T00:00:00Z'));

    expect(wrapper.text()).toContain('Going live in:');
    expect(wrapper.findComponent(AudioStream).exists()).toBe(false);
    expect(wrapper.findComponent(VideoStream).exists()).toBe(false);
    expect(wrapper.findComponent(RadioChat).exists()).toBe(false);
    expect(wrapper.findComponent(RequestSong).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Start a chat with the radio');
  });

  it('renders UpcomingEvents regardless of whether the show has started', () => {
    const notStarted = mountLanding(new Date('2026-06-01T00:00:00Z'));
    expect(notStarted.findComponent(UpcomingEvents).exists()).toBe(true);

    const started = mountLanding(new Date('2025-01-01T00:00:00Z'));
    expect(started.findComponent(UpcomingEvents).exists()).toBe(true);
  });

  it('shows the audio stream and request-song card once started, before live status is known', () => {
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));

    expect(wrapper.text()).not.toContain('Going live in:');
    expect(wrapper.findComponent(AudioStream).exists()).toBe(true);
    expect(wrapper.findComponent(RequestSong).exists()).toBe(true);
  });

  it('hides the video until AudioStream reports the radio is live, then shows it', async () => {
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));
    expect(wrapper.findComponent(VideoStream).exists()).toBe(false);

    await wrapper.findComponent(AudioStream).vm.$emit('update:is-live', true);
    expect(wrapper.findComponent(VideoStream).exists()).toBe(true);
  });

  it('hides the video again if AudioStream reports the radio went offline', async () => {
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));
    await wrapper.findComponent(AudioStream).vm.$emit('update:is-live', true);
    expect(wrapper.findComponent(VideoStream).exists()).toBe(true);

    await wrapper.findComponent(AudioStream).vm.$emit('update:is-live', false);
    expect(wrapper.findComponent(VideoStream).exists()).toBe(false);
  });

  it('reflects live status in the document title', async () => {
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));
    expect(document.title).toBe('Intro Radio');

    await wrapper.findComponent(AudioStream).vm.$emit('update:is-live', true);
    expect(document.title).toBe('🔴 Live · Intro Radio');

    await wrapper.findComponent(AudioStream).vm.$emit('update:is-live', false);
    expect(document.title).toBe('Intro Radio');
  });

  it('shows a chat prompt (not RadioChat) when there is no token yet', () => {
    getTokenMock.mockReturnValue(null);
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));

    expect(wrapper.findComponent(RadioChat).exists()).toBe(false);
    expect(wrapper.text()).toContain('Start a chat with the radio');
  });

  it('shows RadioChat immediately when a token already exists on mount', async () => {
    getTokenMock.mockReturnValue('existing-token');
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));
    // onMounted runs synchronously during mount(), but the chatActive.value =
    // true it triggers only takes effect in the DOM after Vue's reactivity
    // scheduler flushes, which needs an explicit tick here.
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(RadioChat).exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Start a chat with the radio');
  });

  it('starts the chat flow (and shows RadioChat) once ensureToken resolves a token from a click on the prompt', async () => {
    getTokenMock.mockReturnValue(null);
    ensureTokenMock.mockResolvedValue('fresh-token');
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));

    await wrapper.get('[role="button"]').trigger('click'); // the "Start a chat" prompt card
    await flushPromises();

    expect(ensureTokenMock).toHaveBeenCalledTimes(1);
    expect(wrapper.findComponent(RadioChat).exists()).toBe(true);
  });

  it('also starts the chat flow from the keyboard (Enter), not just a pointer click', async () => {
    getTokenMock.mockReturnValue(null);
    ensureTokenMock.mockResolvedValue('fresh-token');
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));

    await wrapper.get('[role="button"]').trigger('keydown.enter');
    await flushPromises();

    expect(wrapper.findComponent(RadioChat).exists()).toBe(true);
  });

  it('does not start the chat flow if ensureToken resolves nothing (e.g. an auth redirect in progress)', async () => {
    getTokenMock.mockReturnValue(null);
    ensureTokenMock.mockResolvedValue(null);
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));

    await wrapper.get('[role="button"]').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(RadioChat).exists()).toBe(false);
    expect(wrapper.text()).toContain('Start a chat with the radio');
  });

  describe('sharing', () => {
    function findShareCard(wrapper: ReturnType<typeof mountLanding>) {
      const card = wrapper.findAll('[role="button"]').find((el) => el.text().includes('Share Intro Radio'));
      if (!card) throw new Error('share card not found');
      return card;
    }

    // navigator's properties (userAgent, etc. -- which Vuetify's own
    // createDisplay() reads on mount) live on its prototype chain, not as
    // this instance's own enumerable properties, so `{ ...navigator }`
    // silently drops all of them; stubbing the whole global with that spread
    // breaks Vuetify's own setup instead of Landing's code. Defining just
    // the one property directly on the real navigator leaves everything
    // else intact.
    function stubNavigator(props: Record<string, unknown>) {
      for (const [key, value] of Object.entries(props)) {
        Object.defineProperty(navigator, key, { value, configurable: true });
      }
    }

    afterEach(() => {
      // @ts-expect-error -- test-only, restoring jsdom's default (absent) state
      delete navigator.share;
      // @ts-expect-error -- same as above
      delete navigator.clipboard;
    });

    it('is not shown before the event has started', () => {
      const wrapper = mountLanding(new Date('2026-06-01T00:00:00Z'));
      expect(wrapper.text()).not.toContain('Share Intro Radio');
    });

    it('uses the Web Share API when available, with no clipboard fallback', async () => {
      const shareMock = vi.fn().mockResolvedValue(undefined);
      const clipboardSpy = vi.fn();
      stubNavigator({ share: shareMock, clipboard: { writeText: clipboardSpy } });

      const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));
      await findShareCard(wrapper).trigger('click');
      await flushPromises();

      expect(shareMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Intro Radio', url: window.location.origin }),
      );
      expect(clipboardSpy).not.toHaveBeenCalled();
    });

    it('silently ignores the user dismissing the native share sheet', async () => {
      stubNavigator({ share: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')) });

      const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));
      await findShareCard(wrapper).trigger('click');
      await flushPromises();

      expect(wrapper.text()).not.toContain('Link copied');
    });

    it('falls back to copying the link when the Web Share API is unavailable', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      stubNavigator({ share: undefined, clipboard: { writeText: writeTextMock } });

      // The snackbar teleports its content out of Landing's own subtree (via
      // Vuetify's VOverlay), so this needs a real attached document and an
      // assertion against that instead of wrapper.text() -- same pattern as
      // AdminChat.vue.spec.ts's reconnect-toast test.
      const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'), { attachTo: document.body });
      try {
        await findShareCard(wrapper).trigger('click');
        await flushPromises();
        await wrapper.vm.$nextTick();

        expect(writeTextMock).toHaveBeenCalledWith(window.location.origin);
        expect(document.body.textContent).toContain('Link copied to clipboard');
      } finally {
        wrapper.unmount();
      }
    });

    it('does nothing visible if clipboard access itself fails', async () => {
      stubNavigator({ share: undefined, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });

      const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));
      await findShareCard(wrapper).trigger('click');
      await flushPromises();

      expect(wrapper.text()).not.toContain('Link copied');
    });
  });
});
