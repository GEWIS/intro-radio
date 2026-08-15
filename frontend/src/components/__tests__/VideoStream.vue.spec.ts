import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoStream from '@/components/VideoStream.vue';
import { mountWithVuetify } from '@/test-utils';

// vi.mock() factories are hoisted above regular top-level statements, so a
// plain `const foo = []` referenced inside one would still be in its TDZ
// when the factory runs. vi.hoisted() hoists these declarations together
// with the vi.mock() call below so the factory can see them.
const { hlsInstances, isSupportedMock } = vi.hoisted(() => ({
  hlsInstances: [] as {
    on: ReturnType<typeof vi.fn>;
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }[],
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

function mediaPlaylist(sequence: number) {
  return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${sequence}\n#EXTINF:2,\nseg${sequence}.ts\n`;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  hlsInstances.length = 0;
  isSupportedMock.mockReturnValue(true);
  // jsdom's HTMLMediaElement has no real media pipeline; play() throws "not
  // implemented" unless stubbed. HTMLVideoElement inherits from it, so this
  // covers the <video> element too.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  // setupStream() also starts the playlist health check, so every test needs
  // fetch available -- default to a plain (non-master) media playlist so the
  // health check settles on a single request per poll unless a test overrides it.
  fetchMock = vi.fn().mockResolvedValue({ text: async () => mediaPlaylist(1) });
  vi.stubGlobal('fetch', fetchMock);
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
    // Not runAllTimersAsync(): setupStream() now also starts a recurring
    // setInterval health check, which never "runs out" and would spin forever.
    await vi.advanceTimersByTimeAsync(0);

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

  describe('video health (playlist staleness)', () => {
    beforeEach(() => {
      setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows the real video while the media sequence keeps advancing', async () => {
      let sequence = 1;
      fetchMock.mockImplementation(async () => ({ text: async () => mediaPlaylist(sequence++) }));
      const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      expect(wrapper.find('video').exists()).toBe(true);
      expect(wrapper.text()).not.toContain("Oops, something's wrong with the video.");
    });

    it('flips to the "oops" message after 3 consecutive polls with no sequence change', async () => {
      fetchMock.mockResolvedValue({ text: async () => mediaPlaylist(1) });
      const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
      await vi.advanceTimersByTimeAsync(0); // the immediate check, still healthy (first-ever fingerprint)

      await vi.advanceTimersByTimeAsync(5000); // 1st repeat -- still within tolerance
      expect(wrapper.text()).not.toContain("Oops, something's wrong with the video.");

      await vi.advanceTimersByTimeAsync(5000); // 2nd repeat
      await vi.advanceTimersByTimeAsync(5000); // 3rd repeat -- now stale
      expect(wrapper.text()).toContain("Oops, something's wrong with the video.");
      expect(wrapper.find('video').exists()).toBe(false);
    });

    it('recovers automatically once the sequence advances again', async () => {
      fetchMock.mockResolvedValue({ text: async () => mediaPlaylist(1) });
      const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      expect(wrapper.text()).toContain("Oops, something's wrong with the video.");

      fetchMock.mockResolvedValue({ text: async () => mediaPlaylist(2) });
      await vi.advanceTimersByTimeAsync(5000);

      expect(wrapper.text()).not.toContain("Oops, something's wrong with the video.");
      expect(wrapper.find('video').exists()).toBe(true);
    });

    it("resolves a master playlist's #EXT-X-STREAM-INF to the real media playlist before fingerprinting", async () => {
      const masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=1024\nvariant.m3u8?session=abc\n';
      let sequence = 1;
      fetchMock.mockImplementation(async (url: string) => {
        if (url === 'https://x/stream.m3u8') return { text: async () => masterPlaylist };
        if (url === 'https://x/variant.m3u8?session=abc') return { text: async () => mediaPlaylist(sequence++) };
        throw new Error(`unexpected fetch: ${url}`);
      });
      const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      // Sequence is advancing on the *resolved* media playlist even though the
      // master itself (session id aside) never changes -- proves the redirect
      // is actually being followed, not just fingerprinting the master as-is.
      expect(wrapper.text()).not.toContain("Oops, something's wrong with the video.");
      expect(fetchMock).toHaveBeenCalledWith('https://x/variant.m3u8?session=abc', { cache: 'no-store' });
    });

    it('treats a fetch failure as a missed poll, not an instant "oops"', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(5000);
      expect(wrapper.text()).not.toContain("Oops, something's wrong with the video.");

      await vi.advanceTimersByTimeAsync(5000);
      expect(wrapper.text()).toContain("Oops, something's wrong with the video.");
    });

    it('stops polling for health on unmount', async () => {
      fetchMock.mockResolvedValue({ text: async () => mediaPlaylist(1) });
      const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
      await vi.advanceTimersByTimeAsync(0);
      const callsBeforeUnmount = fetchMock.mock.calls.length;

      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(fetchMock).toHaveBeenCalledTimes(callsBeforeUnmount);
    });

    it('resets health state on retry so a stale run does not carry over', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      fetchMock.mockResolvedValue({ text: async () => mediaPlaylist(1) });
      const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);
      expect(wrapper.text()).toContain("Oops, something's wrong with the video.");

      const [, errorHandler] = hlsInstances[0].on.mock.calls.find(([event]) => event === 'hlsError')!;
      errorHandler(null, { fatal: true });
      await wrapper.vm.$nextTick();
      await wrapper.get('button').trigger('click'); // "Try again"
      // retry() itself awaits nextTick() before calling setupStream(), which
      // then kicks off checkVideoHealth()'s own fetch -- each hop is a separate
      // microtask turn, so this needs more than one flush to fully settle.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      expect(wrapper.text()).not.toContain("Oops, something's wrong with the video.");
      consoleErrorSpy.mockRestore();
    });
  });
});
