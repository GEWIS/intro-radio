import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoStream from '@/components/VideoStream.vue';
import { mountWithVuetify } from '@/test-utils';

// vi.mock() factories are hoisted above regular top-level statements, so a
// plain `const foo = []` referenced inside one would still be in its TDZ
// when the factory runs. vi.hoisted() hoists these declarations together
// with the vi.mock() call below so the factory can see them.
const { hlsInstances, isSupportedMock } = vi.hoisted(() => ({
  hlsInstances: [] as { on: ReturnType<typeof vi.fn>; loadSource: ReturnType<typeof vi.fn>; attachMedia: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[],
  isSupportedMock: vi.fn().mockReturnValue(true),
}));

vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported = isSupportedMock;
    static Events = { ERROR: 'hlsError' };
    on = vi.fn();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    constructor() {
      hlsInstances.push(this);
    }
  }
  return { default: FakeHls };
});

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

beforeEach(() => {
  hlsInstances.length = 0;
  isSupportedMock.mockReturnValue(true);
  // jsdom's HTMLMediaElement has no real media pipeline; play() throws "not
  // implemented" unless stubbed. HTMLVideoElement inherits from it, so this
  // covers the <video> element too.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('VideoStream', () => {
  it('auto-starts and attaches Hls.js on desktop', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
    await flushPromises();

    expect(hlsInstances).toHaveLength(1);
    expect(hlsInstances[0].loadSource).toHaveBeenCalledWith('https://x/stream.m3u8');
    expect(hlsInstances[0].attachMedia).toHaveBeenCalled();
  });

  it('shows a start button on mobile instead of auto-starting', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
    await flushPromises();

    expect(hlsInstances).toHaveLength(0);
    expect(wrapper.text()).toContain('Start Video Stream');
  });

  it('starts the stream on mobile after clicking the start button', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    vi.useFakeTimers();
    const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });

    await wrapper.get('button').trigger('click');
    await vi.runAllTimersAsync();

    expect(hlsInstances).toHaveLength(1);
    vi.useRealTimers();
  });

  it('shows an error state and a retry button on a fatal Hls.js error', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
    await flushPromises();

    const [, errorHandler] = hlsInstances[0].on.mock.calls.find(([event]) => event === 'hlsError')!;
    errorHandler(null, { fatal: true });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Unable to load the video stream.');
    expect(hlsInstances[0].destroy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('retries by tearing down and re-attaching Hls.js', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
    await flushPromises();

    const [, errorHandler] = hlsInstances[0].on.mock.calls.find(([event]) => event === 'hlsError')!;
    errorHandler(null, { fatal: true });
    await wrapper.vm.$nextTick();

    await wrapper.get('button').trigger('click'); // "Try again"
    await flushPromises();

    expect(hlsInstances).toHaveLength(2);
    expect(wrapper.text()).not.toContain('Unable to load the video stream.');
  });

  it('falls back to native src when Hls.js is not supported', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    isSupportedMock.mockReturnValue(false);
    HTMLVideoElement.prototype.canPlayType = vi.fn().mockReturnValue('maybe');

    const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
    await flushPromises();

    expect(hlsInstances).toHaveLength(0);
    expect((wrapper.get('video').element as HTMLVideoElement).src).toBe('https://x/stream.m3u8');
  });
});
