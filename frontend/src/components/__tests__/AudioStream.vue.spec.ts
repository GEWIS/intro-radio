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

function mountAudioStream(props: { baseUrl: string; mountPoint: string }) {
  return mountWithVuetify(AudioStream, { props });
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

  it('builds the audio src by prepending https:// when baseUrl has no scheme', () => {
    const wrapper = mountAudioStream({ baseUrl: 'bata-radio.snt.utwente.nl', mountPoint: '/high' });

    expect(wrapper.find('audio').attributes('src')).toBe('https://bata-radio.snt.utwente.nl/high');
  });

  it('leaves an explicit scheme alone (no double https://) and strips a trailing slash from baseUrl', () => {
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com/', mountPoint: '/low' });

    expect(wrapper.find('audio').attributes('src')).toBe('https://example.com/low');
  });

  it('shows the initial prompt and a button role before any interaction', () => {
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    expect(wrapper.find('[role="button"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Click to start listening!');
  });

  it('blinks the "Now live" prompt on an interval while not playing', async () => {
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    expect(wrapper.text()).toContain('Click to start listening!');

    await vi.advanceTimersByTimeAsync(1500);
    expect(wrapper.text()).toContain('Now live');

    await vi.advanceTimersByTimeAsync(1500);
    expect(wrapper.text()).toContain('Click to start listening!');
  });

  it('starts playback on click: plays the audio element and switches the title', async () => {
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');

    expect(wrapper.find('audio').element.play).toHaveBeenCalled();
    expect(wrapper.text()).toContain('Stop listening');
  });

  it('starts playback via Enter and Space keydown on the card', async () => {
    const enterWrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    await enterWrapper.find('[role="button"]').trigger('keydown.enter');
    expect(enterWrapper.text()).toContain('Stop listening');

    const spaceWrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    await spaceWrapper.find('[role="button"]').trigger('keydown.space');
    expect(spaceWrapper.text()).toContain('Stop listening');
  });

  it('fetches status-json.xsl from the normalized base URL while playing', async () => {
    const wrapper = mountAudioStream({ baseUrl: 'bata-radio.snt.utwente.nl', mountPoint: '/high' });

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
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Right Stream');
    expect(wrapper.text()).not.toContain('Wrong Stream');
  });

  it('shows the source title when icestats.source is a single object matching the mount point', async () => {
    fetchMock.mockResolvedValue({ json: async () => statusJsonFor('/high', { title: 'Solo Source' }) });
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Solo Source');
  });

  it('falls back to "Loading..." when no source matches the mount point', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        icestats: { source: { listenurl: 'https://example.com/low', title: 'Other Stream', listeners: 2 } },
      }),
    });
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('Other Stream');
    expect(wrapper.text()).toContain('Loading...');
  });

  it('resets currently-playing to "Loading..." when the status fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Currently playing:');
    expect(wrapper.text()).toContain('Loading...');
  });

  it('re-fetches currently-playing every 15 seconds while playing', async () => {
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('toggles between "Currently playing" and listener count every 4 seconds while playing', async () => {
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

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
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

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
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    await vi.advanceTimersByTimeAsync(4000);

    expect(wrapper.text()).toContain('Loading...');
  });

  it('stops playback on a second click: pauses audio and restores the initial title', async () => {
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    await wrapper.find('[role="button"]').trigger('click');

    expect(wrapper.find('audio').element.pause).toHaveBeenCalled();
    expect(wrapper.text()).toContain('Click to start listening!');
    expect(wrapper.text()).not.toContain('Currently playing:');
  });

  it('stops polling for status once stopped', async () => {
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    const callsWhilePlaying = fetchMock.mock.calls.length;

    await wrapper.find('[role="button"]').trigger('click');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).toHaveBeenCalledTimes(callsWhilePlaying);
  });

  it('shows an error message and stops playback when the audio element fires an error event', async () => {
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    await wrapper.find('audio').trigger('error');

    expect(wrapper.text()).toContain('Something went wrong playing the stream. Please try again.');
    expect(wrapper.text()).not.toContain('Stop listening');
    expect(wrapper.find('audio').element.pause).toHaveBeenCalled();
  });

  it('shows an error message when audio.play() rejects (e.g. autoplay blocked)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    wrapper.find('audio').element.play = vi.fn().mockRejectedValue(new Error('blocked by browser'));

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Something went wrong playing the stream. Please try again.');
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('clears the error state on the next successful play', async () => {
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });
    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    await wrapper.find('audio').trigger('error');
    expect(wrapper.text()).toContain('Something went wrong playing the stream. Please try again.');

    await wrapper.find('[role="button"]').trigger('click');

    expect(wrapper.text()).not.toContain('Something went wrong playing the stream. Please try again.');
    expect(wrapper.text()).toContain('Stop listening');
  });

  it('clears all intervals on unmount so no further status fetches happen', async () => {
    const wrapper = mountAudioStream({ baseUrl: 'https://example.com', mountPoint: '/high' });

    await wrapper.find('[role="button"]').trigger('click');
    await flushPromises();
    const callsWhilePlaying = fetchMock.mock.calls.length;

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).toHaveBeenCalledTimes(callsWhilePlaying);
  });
});
