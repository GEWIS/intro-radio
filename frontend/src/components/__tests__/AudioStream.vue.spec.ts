import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithVuetify } from '@/test-utils';
import AudioStream from '../AudioStream.vue';

function statusJsonFor(mountPoint: string, overrides: Record<string, unknown> = {}) {
  return {
    icestats: {
      source: {
        listenurl: `https://bata-radio.snt.utwente.nl${mountPoint}`,
        title: 'Now Playing Track',
        listeners: 5,
        ...overrides,
      },
    },
  };
}

// isLive is checked once on mount (before any interaction), so every test
// needs that initial check to resolve before it can rely on isLive's value --
// e.g. before clicking to play, which now no-ops while not live.
async function mountAudioStream(props: { baseUrl: string; mountPoint: string }) {
  const wrapper = mountWithVuetify(AudioStream, { props });
  await flushPromises();
  return wrapper;
}

describe('AudioStream', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue({ json: async () => statusJsonFor('/high') });
    vi.stubGlobal('fetch', fetchMock);
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.pause = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('builds the audio src by prepending https:// when baseUrl has no scheme', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'bata-radio.snt.utwente.nl', mountPoint: '/high' });

    expect(wrapper.find('audio').attributes('src')).toBe('https://bata-radio.snt.utwente.nl/high');
  });

  it('leaves an explicit scheme alone (no double https://) and strips a trailing slash from baseUrl', async () => {
    // Must match the mount point checkLive() reports live, or the new
    // isLive-gated src binding leaves src unset regardless of URL-building.
    fetchMock.mockResolvedValue({ json: async () => statusJsonFor('/low') });
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com/', mountPoint: '/low' });

    expect(wrapper.find('audio').attributes('src')).toBe('https://example.com/low');
  });

  it('shows a button role and, once live, the click-to-listen prompt', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    expect(wrapper.find('[role="button"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Click to start listening!');
  });

  it('checks live status immediately on mount, and again every 15 seconds', async () => {
    await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/status-json.xsl');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps polling live status even while nothing is playing (it never depends on play/stop)', async () => {
    await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await vi.advanceTimersByTimeAsync(45_000);

    expect(fetchMock).toHaveBeenCalledTimes(4); // mount + 3 ticks, no play() involved at all
  });

  it('shows a neutral offline message instead of the play prompt when no source matches the mount point', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        icestats: { source: { listenurl: 'https://example.com/low', title: 'Other Stream', listeners: 2 } },
      }),
    });
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    expect(wrapper.text()).toContain('Radio is currently offline');
    expect(wrapper.text()).not.toContain('Click to start listening!');
  });

  it('shows the offline message when the status fetch rejects outright', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    expect(wrapper.text()).toContain('Radio is currently offline');
  });

  it('does not set the audio src while offline, so a dead mount point never fires a spurious error', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ icestats: { source: { listenurl: 'https://example.com/low', title: 'Other' } } }),
    });
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    expect(wrapper.find('audio').attributes('src')).toBeUndefined();
    expect(wrapper.text()).toContain('Radio is currently offline');
    expect(wrapper.text()).not.toContain('Something went wrong playing the stream');
  });

  it('does not start playback on click while not live', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ icestats: { source: { listenurl: 'https://example.com/low', title: 'Other' } } }),
    });
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');

    expect(wrapper.find('audio').element.play).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Radio is currently offline');
  });

  it('recovers automatically once a source appears on a later poll', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ icestats: { source: { listenurl: 'https://example.com/low', title: 'Other' } } }),
    });
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    expect(wrapper.text()).toContain('Radio is currently offline');

    fetchMock.mockResolvedValue({ json: async () => statusJsonFor('/high') });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(wrapper.text()).toContain('Click to start listening!');
  });

  it('emits update:isLive on mount and whenever the value changes', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    // [false] fires synchronously from the initial default before the mount-time
    // check has resolved; [true] follows once it does.
    expect(wrapper.emitted('update:is-live')).toEqual([[false], [true]]);

    fetchMock.mockResolvedValue({
      json: async () => ({ icestats: { source: { listenurl: 'https://example.com/low', title: 'Other' } } }),
    });
    await vi.advanceTimersByTimeAsync(15_000);

    expect(wrapper.emitted('update:is-live')).toEqual([[false], [true], [false]]);
  });

  it('emits update:now-playing whenever the current track changes, including back to null when stopped', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    expect(wrapper.emitted('update:now-playing')).toBeUndefined();

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('update:now-playing')).toEqual([['Now Playing Track']]);

    await wrapper.find('[role="button"]').trigger('click');
    expect(wrapper.emitted('update:now-playing')).toEqual([['Now Playing Track'], [null]]);
  });

  it('starts playback on click: plays the audio element and switches the title', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');

    expect(wrapper.find('audio').element.play).toHaveBeenCalled();
    expect(wrapper.text()).toContain('Stop listening');
  });

  it('starts playback via Enter and Space keydown on the card', async () => {
    const enterWrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    await enterWrapper.find('[role="button"]').trigger('keydown.enter');
    expect(enterWrapper.text()).toContain('Stop listening');

    const spaceWrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    await spaceWrapper.find('[role="button"]').trigger('keydown.space');
    expect(spaceWrapper.text()).toContain('Stop listening');
  });

  it('fetches status-json.xsl from the normalized base URL while playing', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'bata-radio.snt.utwente.nl', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');

    expect(fetchMock).toHaveBeenCalledWith('https://bata-radio.snt.utwente.nl/status-json.xsl');
  });

  it('shows the matched source title once the status fetch resolves (array of sources)', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        icestats: {
          source: [
            { listenurl: 'https://example.com/low', title: 'Wrong Stream', listeners: 1 },
            { listenurl: 'https://example.com/high', title: 'Right Stream', listeners: 5 },
          ],
        },
      }),
    });
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Right Stream');
    expect(wrapper.text()).not.toContain('Wrong Stream');
  });

  it('shows the source title when icestats.source is a single object matching the mount point', async () => {
    fetchMock.mockResolvedValue({ json: async () => statusJsonFor('/high', { title: 'Solo Source' }) });
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Solo Source');
  });

  it('falls back to "Loading..." when the matched source has no title yet', async () => {
    fetchMock.mockResolvedValue({ json: async () => statusJsonFor('/high', { title: null }) });
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Loading...');
  });

  it('resets currently-playing to "Loading..." when a later status fetch rejects while playing', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    fetchMock.mockRejectedValue(new Error('network down'));

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Currently playing:');
    expect(wrapper.text()).toContain('Loading...');
  });

  it('re-fetches currently-playing every 15 seconds while playing', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    const callsBeforePlay = fetchMock.mock.calls.length;
    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforePlay + 1);

    await vi.advanceTimersByTimeAsync(15_000);
    // +1 more from fetchCurrentlyPlaying's own 15s tick, +1 from the independent live-status poll's 15s tick.
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforePlay + 3);
  });

  it('toggles between "Currently playing" and listener count every 4 seconds while playing', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Currently playing:');

    await vi.advanceTimersByTimeAsync(4000);
    expect(wrapper.text()).toContain('listeners!');
    expect(wrapper.text()).toContain('5');

    await vi.advanceTimersByTimeAsync(4000);
    expect(wrapper.text()).toContain('Currently playing:');
  });

  it('uses singular "is"/"listener" wording when there is exactly one listener', async () => {
    fetchMock.mockResolvedValue({ json: async () => statusJsonFor('/high', { listeners: 1 }) });
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    await vi.advanceTimersByTimeAsync(4000);

    expect(wrapper.text()).toContain('There currently is');
    expect(wrapper.text()).toContain('1');
    expect(wrapper.text()).toContain('listener!');
    expect(wrapper.text()).not.toContain('listeners!');
  });

  it('shows "Loading..." for listener count when listeners is not a number', async () => {
    fetchMock.mockResolvedValue({
      json: async () => statusJsonFor('/high', { listeners: 'lots' }),
    });
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    await vi.advanceTimersByTimeAsync(4000);

    expect(wrapper.text()).toContain('Loading...');
  });

  it('stops playback on a second click: pauses audio and restores the initial title', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    await wrapper.find('[role="button"]').trigger('click');

    expect(wrapper.find('audio').element.pause).toHaveBeenCalled();
    expect(wrapper.text()).toContain('Click to start listening!');
    expect(wrapper.text()).not.toContain('Currently playing:');
  });

  it('stops fetching currently-playing info once stopped, but keeps polling live status', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    const callsWhilePlaying = fetchMock.mock.calls.length;

    await wrapper.find('[role="button"]').trigger('click'); // stop
    await vi.advanceTimersByTimeAsync(30_000);

    // The live-status poll alone accounts for exactly 2 more calls in 30s (15s, 30s);
    // fetchCurrentlyPlaying's own interval was cleared by stop() and contributes none.
    expect(fetchMock).toHaveBeenCalledTimes(callsWhilePlaying + 2);
  });

  it('shows an error message and stops playback when the audio element fires an error event', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    await wrapper.find('audio').trigger('error');

    expect(wrapper.text()).toContain('Something went wrong playing the stream. Please try again.');
    expect(wrapper.text()).not.toContain('Stop listening');
    expect(wrapper.find('audio').element.pause).toHaveBeenCalled();
  });

  it('shows an error message when audio.play() rejects (e.g. autoplay blocked)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    wrapper.find('audio').element.play = vi.fn().mockRejectedValue(new Error('blocked by browser'));

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Something went wrong playing the stream. Please try again.');
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('clears the error state on the next successful play', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    await wrapper.find('audio').trigger('error');
    expect(wrapper.text()).toContain('Something went wrong playing the stream. Please try again.');

    await wrapper.find('[role="button"]').trigger('click');

    expect(wrapper.text()).not.toContain('Something went wrong playing the stream. Please try again.');
    expect(wrapper.text()).toContain('Stop listening');
  });

  it('clears all intervals on unmount so no further status fetches happen', async () => {
    const wrapper = await mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    const callsWhilePlaying = fetchMock.mock.calls.length;

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).toHaveBeenCalledTimes(callsWhilePlaying);
  });
});
