import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithVuetify } from '@/test-utils';
import Media from '../media.vue';

const { ensureTokenMock, validateRadioKeyQuickMock, connectMock } = vi.hoisted(() => ({
  ensureTokenMock: vi.fn(),
  validateRadioKeyQuickMock: vi.fn(),
  connectMock: vi.fn(),
}));

vi.mock('@/composables/useGewisAuth', () => ({
  useGewisAuth: () => ({ ensureToken: ensureTokenMock, getToken: () => 'tok' }),
}));
vi.mock('@/composables/useRadioKeyValidation', () => ({
  validateRadioKeyQuick: validateRadioKeyQuickMock,
}));
vi.mock('@/composables/useChatSocket', () => ({
  useChatSocket: () => ({
    isClosed: { value: false },
    connecting: { value: false },
    connect: connectMock,
    disconnect: vi.fn(),
    send: vi.fn(),
  }),
}));

function suggestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'a', purpose: 'segment_suggestion', kind: 'photo', senderLidnr: 1,
    senderGivenName: 'Ada', senderFamilyName: 'Lovelace', caption: 'look at this',
    mimeType: 'image/jpeg', sizeBytes: 4, createdAt: '2026-08-16T10:00:00Z',
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

const routerLinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' };
function mount(component: typeof Media) {
  return mountWithVuetify(component, { global: { stubs: { RouterLink: routerLinkStub } } });
}

async function mountMedia(items: unknown[] = [suggestion()]) {
  setActivePinia(createPinia());
  localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
  validateRadioKeyQuickMock.mockResolvedValue(true);
  ensureTokenMock.mockResolvedValue('a-token');

  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url === '/api/v1/media/list') return Promise.resolve(jsonResponse(items));
    throw new Error(`unexpected fetch: ${url}`);
  }));

  const wrapper = mount(Media);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('backoffice/media.vue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows submissions grouped with sender name and caption', async () => {
    const wrapper = await mountMedia();
    expect(wrapper.text()).toContain('Ada Lovelace');
    expect(wrapper.text()).toContain('look at this');
  });

  it('shows an empty state when there are no submissions', async () => {
    const wrapper = await mountMedia([]);
    expect(wrapper.text()).toContain('No submissions');
  });

  it('deletes an item and refetches the list', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/media/list') return Promise.resolve(jsonResponse([suggestion()]));
      if (url === '/api/v1/media/delete') return Promise.resolve(jsonResponse({ deleted: true }));
      throw new Error(`unexpected fetch: ${url}`);
    });
    setActivePinia(createPinia());
    localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
    validateRadioKeyQuickMock.mockResolvedValue(true);
    ensureTokenMock.mockResolvedValue('a-token');
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(Media);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    await wrapper.get('[aria-label="Delete"]').trigger('click');
    await wrapper.vm.$nextTick();

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/media/delete', expect.objectContaining({ method: 'POST' }));
  });
});
