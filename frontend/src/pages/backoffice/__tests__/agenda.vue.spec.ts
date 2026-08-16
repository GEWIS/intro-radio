import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mountWithVuetify } from '@/test-utils';
import Agenda from '../agenda.vue';

// Same hoisting reasoning as index.vue.spec.ts and dashboard.vue.spec.ts.
const { ensureTokenMock, validateRadioKeyQuickMock } = vi.hoisted(() => ({
  ensureTokenMock: vi.fn(),
  validateRadioKeyQuickMock: vi.fn(),
}));

vi.mock('@/composables/useGewisAuth', () => ({
  useGewisAuth: () => ({ ensureToken: ensureTokenMock, getToken: () => 'tok' }),
}));
vi.mock('@/composables/useRadioKeyValidation', () => ({
  validateRadioKeyQuick: validateRadioKeyQuickMock,
}));

// AgendaEditor.vue calls the real useDarkMode() (not mocked here either),
// same jsdom gap AgendaEditor.vue.spec.ts already works around.
function stubMatchMedia() {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }));
}

let currentWrapper: ReturnType<typeof mountWithVuetify> | null = null;

// onBeforeRouteLeave only resolves an "active route record" for a component
// actually rendered *by* <router-view> -- mounting Agenda directly (the way
// index.vue.spec.ts mounts its page component) leaves that guard unable to
// find one at all. Routing through a tiny host component's <router-view>
// is what makes this test meaningfully exercise the guard.
async function mountAgenda() {
  setActivePinia(createPinia());
  localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
  validateRadioKeyQuickMock.mockResolvedValue(true);
  ensureTokenMock.mockResolvedValue('a-token');
  stubMatchMedia();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/backoffice/agenda', component: Agenda },
      { path: '/backoffice', component: { template: '<div>chat</div>' } },
    ],
  });
  await router.push('/backoffice/agenda');
  await router.isReady();

  const wrapper = mountWithVuetify(
    { template: '<router-view />' },
    { global: { plugins: [router] } },
  );
  currentWrapper = wrapper;

  // load() (onMounted) resolves fetchAgenda() then gate.init() across a
  // couple of microtask turns, same as the other admin-gated page specs.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();
  return { wrapper, router };
}

function makeDirty(wrapper: Awaited<ReturnType<typeof mountAgenda>>['wrapper']) {
  // "Add event" is the only button on a freshly loaded, empty agenda --
  // clicking it genuinely dirties the real (unmocked) AgendaEditor/
  // useAgendaEditor state, rather than reaching into internals.
  return wrapper.get('button').trigger('click');
}

describe('backoffice/agenda.vue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    // Each test's beforeunload listener stays registered on the real
    // `window` until its component unmounts -- without this, a leftover
    // listener from one test can intercept another test's dispatched event.
    currentWrapper?.unmount();
    currentWrapper = null;
    vi.unstubAllGlobals();
  });

  it('navigates away freely when there are no unsaved changes', async () => {
    const { router } = await mountAgenda();
    const confirmMock = vi.fn();
    vi.stubGlobal('confirm', confirmMock);

    await router.push('/backoffice');

    expect(router.currentRoute.value.path).toBe('/backoffice');
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('blocks in-app navigation with unsaved changes until the admin confirms discarding them', async () => {
    const { wrapper, router } = await mountAgenda();
    await makeDirty(wrapper);

    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
    await router.push('/backoffice');
    expect(router.currentRoute.value.path).toBe('/backoffice/agenda'); // blocked

    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    await router.push('/backoffice');
    expect(router.currentRoute.value.path).toBe('/backoffice'); // confirmed
  });

  it('warns on a real page unload only when there are unsaved changes', async () => {
    const { wrapper } = await mountAgenda();

    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    await makeDirty(wrapper);

    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
  });

  it('stops listening for beforeunload once unmounted', async () => {
    const { wrapper } = await mountAgenda();
    await makeDirty(wrapper);

    wrapper.unmount();
    currentWrapper = null; // already unmounted here; don't double-unmount in afterEach

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
