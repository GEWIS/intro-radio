import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithVuetify } from '@/test-utils';
import SegmentSuggestion from '../SegmentSuggestion.vue';

// SegmentSuggestion calls useGewisAuth() unconditionally on setup, which in turn
// calls useAppStore() (needs an active Pinia) and useRouter() (needs a router
// context) -- neither of which this test installs. Mocking the whole composable,
// the same way RadioChat.vue.spec.ts and AdminChat.vue.spec.ts do for their own
// media-upload paths, sidesteps both and gives `send()` a token that's always
// truthy so the upload path under test can actually reach `fetch`.
const { ensureTokenMock, getTokenMock } = vi.hoisted(() => ({ ensureTokenMock: vi.fn(), getTokenMock: vi.fn() }));
vi.mock('@/composables/useGewisAuth', () => ({
  useGewisAuth: () => ({ ensureToken: ensureTokenMock, getToken: getTokenMock }),
}));

function mount() {
  return mountWithVuetify(SegmentSuggestion);
}

// Shared by every test that gets past the file picker to an actual send --
// selects a photo (the simplest of the two `kind`s) so `canSend` is true.
function selectPhoto(wrapper: ReturnType<typeof mount>, file: File) {
  const fileInput = wrapper.get('input[type="file"]');
  // configurable: true so a test can select a second file later on the same
  // <input> (e.g. picking a retry file after a first attempt already
  // defined this property) without Object.defineProperty throwing on redefine.
  Object.defineProperty(fileInput.element, 'files', { value: [file], configurable: true });
  return fileInput.trigger('change');
}

// The header's role="button" div isn't a <button> tag, and the Photo/Voice
// toggle renders two <button>s before Send -- find by text rather than
// position/CSS so this doesn't depend on how many buttons precede it.
function findSendButton(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('button').find((b) => b.text() === 'Send')!;
}

// toggle() is async now (it awaits ensureToken() before expanding), so the
// state change from a click doesn't land within trigger()'s own single
// nextTick the way a synchronous handler's would -- callers need this
// extra flushPromises() to see the card actually open.
async function expand(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('[role="button"]').trigger('click');
  await flushPromises();
}

describe('SegmentSuggestion', () => {
  beforeEach(() => {
    ensureTokenMock.mockReset().mockResolvedValue('tok');
    getTokenMock.mockReset().mockReturnValue('tok');
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
    await expand(wrapper);
    expect(wrapper.text()).toContain('Photo');
    expect(wrapper.text()).toContain('Voice');
  });

  it('uploads a selected photo with a caption', async () => {
    const wrapper = mount();
    await expand(wrapper);

    await wrapper.get('textarea').setValue('mention this tomorrow');
    await selectPhoto(wrapper, new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' }));

    await findSendButton(wrapper).trigger('click');
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith('/api/v1/media', expect.objectContaining({ method: 'POST' }));
    const call = (fetch as any).mock.calls[0][1];
    const form = call.body as FormData;
    expect(form.get('purpose')).toBe('segment_suggestion');
    expect(form.get('kind')).toBe('photo');
    expect(form.get('caption')).toBe('mention this tomorrow');
    expect(wrapper.text()).toContain('Sent!');
  });

  it('checks for a token before showing the form, not after filling it in', async () => {
    const wrapper = mount();
    await expand(wrapper);

    expect(ensureTokenMock).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Photo');
  });

  it('calls ensureToken (rather than expanding) when there is no stored token', async () => {
    ensureTokenMock.mockReset().mockResolvedValue(null);
    const wrapper = mount();
    await expand(wrapper);

    expect(ensureTokenMock).toHaveBeenCalledTimes(1);
    // ensureToken resolving null means an auth redirect is in progress (or was
    // declined) -- that already has an implicit user-facing reason, so this
    // just stays collapsed rather than opening a form there's no token to submit.
    expect(wrapper.text()).not.toContain('Photo');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows an inline error instead of redirecting if the session expires while the card is already open', async () => {
    const wrapper = mount();
    await expand(wrapper);
    await selectPhoto(wrapper, new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' }));

    // The token was valid at expand time (that's how the card got open at
    // all) but has since expired -- send() must not discard the user's
    // in-progress selection by redirecting the way ensureToken() would.
    getTokenMock.mockReturnValue(null);
    await findSendButton(wrapper).trigger('click');
    await flushPromises();

    expect(fetch).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Your session expired');
    expect(findSendButton(wrapper).attributes('disabled')).toBeUndefined();
  });

  it('shows the backend error message on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'unsupported content type "text/plain" for kind "photo"' }),
    );
    const wrapper = mount();
    await expand(wrapper);
    await selectPhoto(wrapper, new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' }));

    await findSendButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('unsupported content type "text/plain" for kind "photo"');
    expect(wrapper.text()).not.toContain('Sent!');
  });

  it('shows a generic error message when the fetch itself throws (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));
    const wrapper = mount();
    await expand(wrapper);
    await selectPhoto(wrapper, new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' }));

    await findSendButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Could not reach the server');
    expect(wrapper.text()).not.toContain('Sent!');
  });

  it('resets a previous "Sent!" success message once a new attempt is made, even if that attempt fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'abc' }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error' });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount();
    await expand(wrapper);
    await selectPhoto(wrapper, new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' }));

    await findSendButton(wrapper).trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Sent!');

    // send() clears selectedFile on success, so a retry needs a fresh pick.
    await selectPhoto(wrapper, new File(['more-bytes'], 'photo2.jpg', { type: 'image/jpeg' }));
    await findSendButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('Sent!');
    expect(wrapper.text()).toContain('server error');
  });
});
