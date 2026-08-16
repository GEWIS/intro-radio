import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
// Real ref()s, not plain { value: false } objects: AdminChat.vue's new
// reconnect-toast logic reads isClosed.value directly in <script setup>
// (not just via the template's auto-unwrap), and storeToRefs -- which sits
// between the chat store and AdminChat -- only picks up genuinely reactive
// values, silently losing a plain object instead of passing it through.
vi.mock('@/composables/useChatSocket', async () => {
  const { ref } = await import('vue');
  return {
    useChatSocket: () => ({
      isClosed: ref(false),
      connecting: ref(false),
      connect: connectMock,
      disconnect: vi.fn(),
      send: vi.fn(),
    }),
  };
});

let currentWrapper: ReturnType<typeof mountWithVuetify> | null = null;

async function mountAtUrl(url: string) {
  setActivePinia(createPinia());
  localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
  validateRadioKeyQuickMock.mockResolvedValue(true);
  ensureTokenMock.mockResolvedValue('a-token');

  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/backoffice', component: BackofficeIndex }] });
  await router.push(url);
  await router.isReady();

  const wrapper = mountWithVuetify(BackofficeIndex, { global: { plugins: [router] } });
  currentWrapper = wrapper;
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
    // This page renders the real AdminChat, whose reconnect-toast
    // v-snackbar renders via Vuetify's VOverlay -- see
    // AdminChat.vue.spec.ts for why both of these need stubbing.
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
    // Must run before vi.unstubAllGlobals() -- VOverlay's own unmount-time
    // cleanup reaches for visualViewport too (see AdminChat.vue.spec.ts).
    currentWrapper?.unmount();
    currentWrapper = null;
    vi.unstubAllGlobals();
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
