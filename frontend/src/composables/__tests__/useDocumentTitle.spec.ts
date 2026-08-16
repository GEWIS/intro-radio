import { describe, expect, it } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { mountWithVuetify } from '@/test-utils';
import { useDocumentTitle } from '../useDocumentTitle';

function mountDocumentTitle(initial: boolean) {
  const isLive = ref(initial);
  const Host = defineComponent({
    setup() {
      useDocumentTitle(isLive);
      return () => null;
    },
  });
  const wrapper = mountWithVuetify(Host);
  return { isLive, wrapper };
}

function mountDocumentTitleWithTrack(initialLive: boolean, initialTrack: string | null) {
  const isLive = ref(initialLive);
  const nowPlaying = ref<string | null>(initialTrack);
  const Host = defineComponent({
    setup() {
      useDocumentTitle(isLive, nowPlaying);
      return () => null;
    },
  });
  const wrapper = mountWithVuetify(Host);
  return { isLive, nowPlaying, wrapper };
}

describe('useDocumentTitle', () => {
  it('sets the plain title immediately when not live', () => {
    mountDocumentTitle(false);

    expect(document.title).toBe('Intro Radio');
  });

  it('switches to the live title as soon as isLive turns true', async () => {
    const { isLive } = mountDocumentTitle(false);

    isLive.value = true;
    await nextTick();

    expect(document.title).toBe('🔴 Live · Intro Radio');
  });

  it('switches back to the plain title once isLive turns false again', async () => {
    const { isLive } = mountDocumentTitle(true);
    expect(document.title).toBe('🔴 Live · Intro Radio');

    isLive.value = false;
    await nextTick();

    expect(document.title).toBe('Intro Radio');
  });

  it('restores the plain title on unmount, even while live', () => {
    const { wrapper } = mountDocumentTitle(true);
    expect(document.title).toBe('🔴 Live · Intro Radio');

    wrapper.unmount();

    expect(document.title).toBe('Intro Radio');
  });

  describe('with a nowPlaying track', () => {
    it('shows the track name instead of the generic live title once known', () => {
      mountDocumentTitleWithTrack(true, 'Test Track - Fake Artist');

      expect(document.title).toBe('🔴 Test Track - Fake Artist · Intro Radio');
    });

    it('falls back to the generic live title while live but no track is known yet', () => {
      mountDocumentTitleWithTrack(true, null);

      expect(document.title).toBe('🔴 Live · Intro Radio');
    });

    it('updates as the track changes while live', async () => {
      const { nowPlaying } = mountDocumentTitleWithTrack(true, 'First Track');
      expect(document.title).toBe('🔴 First Track · Intro Radio');

      nowPlaying.value = 'Second Track';
      await nextTick();

      expect(document.title).toBe('🔴 Second Track · Intro Radio');
    });

    it('shows the plain title when not live, even if a stale track name lingers', () => {
      mountDocumentTitleWithTrack(false, 'Stale Track From Before It Dropped');

      expect(document.title).toBe('Intro Radio');
    });

    it('does not resurrect a live-looking title if a track name arrives after going offline', async () => {
      const { isLive, nowPlaying } = mountDocumentTitleWithTrack(true, 'Now Playing');
      isLive.value = false;
      await nextTick();
      expect(document.title).toBe('Intro Radio');

      nowPlaying.value = 'Stale Track'; // e.g. one last poll response landing just after going offline
      await nextTick();

      expect(document.title).toBe('Intro Radio');
    });
  });
});
