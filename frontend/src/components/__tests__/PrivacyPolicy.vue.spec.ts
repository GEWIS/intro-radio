import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PrivacyPolicy from '@/components/PrivacyPolicy.vue';
import { mountWithVuetify } from '@/test-utils';

describe('PrivacyPolicy', () => {
  beforeEach(() => {
    // See Credits.vue.spec.ts -- VDialog/VOverlay need ResizeObserver and
    // visualViewport stubbed, neither of which jsdom implements.
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

  it('opens the dialog on button click', async () => {
    const wrapper = mountWithVuetify(PrivacyPolicy, { attachTo: document.body });

    await wrapper.get('button').trigger('click');
    expect(document.querySelector('.v-overlay--active')).not.toBeNull();
  });

  it('renders sanitized HTML with no script tags', () => {
    const wrapper = mountWithVuetify(PrivacyPolicy);
    expect(wrapper.html()).not.toContain('<script');
  });
});
