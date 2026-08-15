import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mountWithVuetify } from '@/test-utils';
import { findMatchingSource, normalizeIcecastBaseUrl, useIcecastLiveStatus } from '../useIcecastLiveStatus';

function statusJsonFor(mountPoint: string) {
  return { icestats: { source: { listenurl: `https://example.com${mountPoint}`, listeners: 3 } } };
}

function mountLiveStatus(initialBaseUrl: string, initialMountPoint: string) {
  const baseUrl = ref(initialBaseUrl);
  const mountPoint = ref(initialMountPoint);
  let result!: ReturnType<typeof useIcecastLiveStatus>;
  const Host = defineComponent({
    setup() {
      result = useIcecastLiveStatus(baseUrl, mountPoint);
      return () => null;
    },
  });
  const wrapper = mountWithVuetify(Host);
  return { ...result, baseUrl, mountPoint, wrapper };
}

describe('normalizeIcecastBaseUrl', () => {
  it('prepends https:// when no scheme is present', () => {
    expect(normalizeIcecastBaseUrl('bata-radio.snt.utwente.nl')).toBe('https://bata-radio.snt.utwente.nl');
  });

  it('leaves an explicit scheme alone and strips a trailing slash', () => {
    expect(normalizeIcecastBaseUrl('https://example.com/')).toBe('https://example.com');
  });
});

describe('findMatchingSource', () => {
  it('matches a single-object source by mount point', () => {
    const data = { icestats: { source: { listenurl: 'https://x/high', listeners: 1 } } };
    expect(findMatchingSource(data, '/high')).toEqual({ listenurl: 'https://x/high', listeners: 1 });
  });

  it('matches within an array of sources', () => {
    const data = { icestats: { source: [{ listenurl: 'https://x/low' }, { listenurl: 'https://x/high' }] } };
    expect(findMatchingSource(data, '/high')).toEqual({ listenurl: 'https://x/high' });
  });

  it('returns null when nothing matches', () => {
    const data = { icestats: { source: { listenurl: 'https://x/low' } } };
    expect(findMatchingSource(data, '/high')).toBeNull();
  });
});

describe('useIcecastLiveStatus', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue({ json: async () => statusJsonFor('/high') });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('checks immediately on mount and becomes live when a source matches', async () => {
    const { isLive } = mountLiveStatus('https://example.com', '/high');
    await vi.advanceTimersByTimeAsync(0);

    expect(isLive.value).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/status-json.xsl');
  });

  it('is not live when no source matches the mount point', async () => {
    const { isLive } = mountLiveStatus('https://example.com', '/low');
    await vi.advanceTimersByTimeAsync(0);

    expect(isLive.value).toBe(false);
  });

  it('polls every 15 seconds', async () => {
    mountLiveStatus('https://example.com', '/high');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a rejected fetch as not live', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { isLive } = mountLiveStatus('https://example.com', '/high');
    await vi.advanceTimersByTimeAsync(0);

    expect(isLive.value).toBe(false);
  });

  it('stops polling on unmount', async () => {
    const { wrapper } = mountLiveStatus('https://example.com', '/high');
    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeUnmount = fetchMock.mock.calls.length;

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeUnmount);
  });

  it('re-checks against a new base URL or mount point when either changes', async () => {
    const { isLive, baseUrl, mountPoint } = mountLiveStatus('https://example.com', '/low');
    await vi.advanceTimersByTimeAsync(0);
    expect(isLive.value).toBe(false);

    mountPoint.value = '/high';
    await vi.advanceTimersByTimeAsync(0);
    expect(isLive.value).toBe(true);

    baseUrl.value = 'https://elsewhere.example';
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledWith('https://elsewhere.example/status-json.xsl');
  });
});
