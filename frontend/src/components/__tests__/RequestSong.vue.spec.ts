import { afterEach, describe, expect, it, vi } from 'vitest';
import RequestSong from '@/components/RequestSong.vue';
import { mountWithVuetify } from '@/test-utils';

describe('RequestSong', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts collapsed and expands the song field on header click', async () => {
    const wrapper = mountWithVuetify(RequestSong);

    expect(wrapper.get('[role="button"]').attributes('aria-expanded')).toBe('false');
    await wrapper.get('[role="button"]').trigger('click');

    expect(wrapper.get('[role="button"]').attributes('aria-expanded')).toBe('true');
  });

  it('does not open Spotify when the song field is empty', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const wrapper = mountWithVuetify(RequestSong);
    await wrapper.get('[role="button"]').trigger('click');

    await wrapper.get('button').trigger('click'); // Search button, disabled while empty -- see next test for the real path
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens a URL-encoded Spotify search for the entered song', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const wrapper = mountWithVuetify(RequestSong);
    await wrapper.get('[role="button"]').trigger('click');

    await wrapper.get('input').setValue('Bohemian Rhapsody & Friends');
    await wrapper.get('input').trigger('keyup.enter');

    expect(openSpy).toHaveBeenCalledWith(
      'https://open.spotify.com/search/Bohemian%20Rhapsody%20%26%20Friends',
      '_blank',
    );
  });
});
