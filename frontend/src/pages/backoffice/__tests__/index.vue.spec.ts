import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { useChatStore } from '@/stores/chat';
import { mountWithVuetify } from '@/test-utils';
import BackofficeIndex from '../index.vue';

// Same hoisting reasoning as useAdminGate.spec.ts and AdminChat.vue.spec.ts.
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

async function mountAtUrl(url: string) {
  setActivePinia(createPinia());
  localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
  validateRadioKeyQuickMock.mockResolvedValue(true);
  ensureTokenMock.mockResolvedValue('a-token');

  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/backoffice', component: BackofficeIndex }] });
  await router.push(url);
  await router.isReady();

  const wrapper = mountWithVuetify(BackofficeIndex, { global: { plugins: [router] } });
  // gate.init() (onMounted) and the resulting stage/query watcher both
  // resolve across a couple of microtask turns.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('backoffice/index.vue', () => {
  beforeEach(() => {
    localStorage.clear();
    connectMock.mockClear();
  });

  it('selects the user named in ?user= once the admin gate is ready', async () => {
    await mountAtUrl('/backoffice?user=42');

    const chatStore = useChatStore();
    expect(chatStore.activeUser).toBe('42');
  });

  it('leaves activeUser untouched when there is no ?user= param', async () => {
    await mountAtUrl('/backoffice');

    const chatStore = useChatStore();
    expect(chatStore.activeUser).toBeNull();
  });
});
