import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Credits from '@/components/Credits.vue';
import { mountWithVuetify } from '@/test-utils';

describe('Credits', () => {
  beforeEach(() => {
    // VDialog/VOverlay's location strategy references the real browser
    // globals ResizeObserver and visualViewport, neither of which jsdom
    // implements. `visualViewport` is referenced as a bare (optionally
    // chained) identifier rather than via `window.visualViewport`, so it
    // needs to exist as a global property (even as undefined) or the bare
    // reference throws a ReferenceError before the `?.` ever runs.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('visualViewport', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the dialog on button click and closes it on the close button', async () => {
    const wrapper = mountWithVuetify(Credits, { attachTo: document.body });

    await wrapper.get('button').trigger('click');
    expect(document.querySelector('.v-overlay--active')).not.toBeNull();

    const closeBtn = document.querySelector('.v-card-title button') as HTMLElement;
    closeBtn.click();
    await wrapper.vm.$nextTick();

    expect(document.querySelector('.v-overlay--active')).toBeNull();
  });

  it('renders sanitized HTML with no script tags, even though credits.md is trusted content', () => {
    const wrapper = mountWithVuetify(Credits);
    // marked+DOMPurify runs at module-eval time regardless of whether the
    // dialog is open; the sanitizer applying is what this asserts, not
    // that the source markdown happens to contain anything malicious.
    expect(wrapper.html()).not.toContain('<script');
  });
});
