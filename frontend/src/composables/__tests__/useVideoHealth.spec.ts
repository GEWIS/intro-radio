import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mountWithVuetify } from '@/test-utils';
import { useVideoHealth } from '../useVideoHealth';

function mediaPlaylist(sequence: number) {
  return `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:${sequence}\n#EXTINF:2,\nseg${sequence}.ts\n`;
}

function mountVideoHealth(initialSrc: string) {
  const src = ref(initialSrc);
  let result!: ReturnType<typeof useVideoHealth>;
  const Host = defineComponent({
    setup() {
      result = useVideoHealth(src);
      return () => null;
    },
  });
  const wrapper = mountWithVuetify(Host);
  return { ...result, src, wrapper };
}

describe('useVideoHealth', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue({ text: async () => mediaPlaylist(1) });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('defaults to healthy and stays healthy while the sequence advances', async () => {
    let sequence = 1;
    fetchMock.mockImplementation(async () => ({ text: async () => mediaPlaylist(sequence++) }));
    const { healthy, start } = mountVideoHealth('https://x/stream.m3u8');

    start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    expect(healthy.value).toBe(true);
  });

  it('flips to unhealthy after 3 consecutive polls with no sequence change', async () => {
    const { healthy, start } = mountVideoHealth('https://x/stream.m3u8');

    start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(healthy.value).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(healthy.value).toBe(false);
  });

  it('recovers once the sequence advances again', async () => {
    const { healthy, start } = mountVideoHealth('https://x/stream.m3u8');
    start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(healthy.value).toBe(false);

    fetchMock.mockResolvedValue({ text: async () => mediaPlaylist(2) });
    await vi.advanceTimersByTimeAsync(5000);

    expect(healthy.value).toBe(true);
  });

  it('resolves a master playlist to its media playlist before fingerprinting', async () => {
    const masterPlaylist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1024\nvariant.m3u8?session=abc\n';
    let sequence = 1;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://x/stream.m3u8') return { text: async () => masterPlaylist };
      if (url === 'https://x/variant.m3u8?session=abc') return { text: async () => mediaPlaylist(sequence++) };
      throw new Error(`unexpected fetch: ${url}`);
    });
    const { healthy, start } = mountVideoHealth('https://x/stream.m3u8');

    start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);

    expect(healthy.value).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://x/variant.m3u8?session=abc', { cache: 'no-store' });
  });

  it('treats a fetch failure as a missed poll, not an instant unhealthy', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { healthy, start } = mountVideoHealth('https://x/stream.m3u8');

    start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(healthy.value).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(healthy.value).toBe(false);
  });

  it('resets to healthy and clears state when start() is called again (e.g. a retry)', async () => {
    const { healthy, start } = mountVideoHealth('https://x/stream.m3u8');
    start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(healthy.value).toBe(false);

    start();
    await vi.advanceTimersByTimeAsync(0);

    expect(healthy.value).toBe(true);
  });

  it('stops polling once stop() is called', async () => {
    const { healthy, start, stop } = mountVideoHealth('https://x/stream.m3u8');
    start();
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterFirstCheck = fetchMock.mock.calls.length;

    stop();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirstCheck);
    expect(healthy.value).toBe(true);
  });

  it('stops polling on unmount', async () => {
    const { start, wrapper } = mountVideoHealth('https://x/stream.m3u8');
    start();
    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeUnmount = fetchMock.mock.calls.length;

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeUnmount);
  });
});
