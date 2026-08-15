import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

function mountLanding(startTime: Date) {
  setActivePinia(createPinia());
  const store = useAppStore();
  store.radio.startTime = startTime;
  return mountWithVuetify(Landing, { global: { stubs: CHILD_STUBS } });
}

describe('Landing', () => {
  beforeEach(() => {
    ensureTokenMock.mockReset();
    getTokenMock.mockReset().mockReturnValue(null);
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
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

  it('shows the audio stream, video stream, and request-song card once started', () => {
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));

    expect(wrapper.text()).not.toContain('Going live in:');
    expect(wrapper.findComponent(AudioStream).exists()).toBe(true);
    expect(wrapper.findComponent(VideoStream).exists()).toBe(true);
    expect(wrapper.findComponent(RequestSong).exists()).toBe(true);
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
});
