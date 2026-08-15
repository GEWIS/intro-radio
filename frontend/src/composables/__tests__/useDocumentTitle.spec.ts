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
});
