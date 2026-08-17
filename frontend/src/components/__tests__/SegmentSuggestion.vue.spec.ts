import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithVuetify } from '@/test-utils';
import SegmentSuggestion from '../SegmentSuggestion.vue';

// SegmentSuggestion calls useGewisAuth() unconditionally on setup, which in turn
// calls useAppStore() (needs an active Pinia) and useRouter() (needs a router
// context) -- neither of which this test installs. Mocking the whole composable,
// the same way RadioChat.vue.spec.ts and AdminChat.vue.spec.ts do for their own
// media-upload paths, sidesteps both and gives `send()` a token that's always
// truthy so the upload path under test can actually reach `fetch`.
vi.mock('@/composables/useGewisAuth', () => ({
  useGewisAuth: () => ({ getToken: () => 'tok' }),
}));

function mount() {
  return mountWithVuetify(SegmentSuggestion);
}

describe('SegmentSuggestion', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'abc' }) }));

    // The "Send" v-btn switches to a spinner (VProgressCircular) while sending
    // is true, and that component measures itself via ResizeObserver -- a real
    // browser API jsdom doesn't implement. Stub it so the upload test can mount
    // without a ReferenceError (same fix AdminKeyGate.vue.spec.ts already
    // applies for its own loading-button spinner).
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is collapsed by default', () => {
    const wrapper = mount();
    expect(wrapper.text()).not.toContain('Send');
  });

  it('expands to show the photo/voice toggle when clicked', async () => {
    const wrapper = mount();
    await wrapper.get('[role="button"]').trigger('click');
    expect(wrapper.text()).toContain('Photo');
    expect(wrapper.text()).toContain('Voice');
  });

  it('uploads a selected photo with a caption', async () => {
    const wrapper = mount();
    await wrapper.get('[role="button"]').trigger('click');

    await wrapper.get('textarea').setValue('mention this tomorrow');

    const fileInput = wrapper.get('input[type="file"]');
    const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(fileInput.element, 'files', { value: [file] });
    await fileInput.trigger('change');

    // The header's role="button" div isn't a <button> tag, and the Photo/Voice
    // toggle renders two <button>s before Send -- find by text rather than
    // position/CSS so this doesn't depend on how many buttons precede it.
    const sendButton = wrapper.findAll('button').find((b) => b.text() === 'Send')!;
    await sendButton.trigger('click');

    expect(fetch).toHaveBeenCalledWith('/api/v1/media', expect.objectContaining({ method: 'POST' }));
    const call = (fetch as any).mock.calls[0][1];
    const form = call.body as FormData;
    expect(form.get('purpose')).toBe('segment_suggestion');
    expect(form.get('kind')).toBe('photo');
    expect(form.get('caption')).toBe('mention this tomorrow');
  });
});
