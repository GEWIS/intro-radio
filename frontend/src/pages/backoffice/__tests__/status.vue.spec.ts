import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountWithVuetify } from '@/test-utils';
import Status from '../status.vue';

// Same hoisting reasoning as dashboard.vue.spec.ts/agenda.vue.spec.ts.
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

function systemStatus(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    uptimeSeconds: 5400, // 1h 30m
    chatListeners: 3,
    chatAdmins: 2,
    lastMetricsSampleAt: '2026-08-16T10:00:00Z',
    icecastReachable: true,
    ...overrides,
  };
}

function auditEntry(overrides: Partial<{ timestamp: string; lidnr: number; given_name: string; family_name: string }> = {}) {
  return { timestamp: '2026-08-16T10:00:00Z', lidnr: 1, given_name: 'Ada', family_name: 'Lovelace', ...overrides };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

const routerLinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' };
function mount(component: typeof Status) {
  return mountWithVuetify(component, { global: { stubs: { RouterLink: routerLinkStub } } });
}

function defaultFetchImpl(status: unknown = systemStatus(), auditLog: unknown[] = []) {
  return (url: string) => {
    if (url === '/api/v1/status') return jsonResponse(status);
    if (url === '/api/v1/audit-log') return jsonResponse(auditLog);
    throw new Error(`unexpected fetch: ${url}`);
  };
}

async function mountStatus(fetchImpl: (url: string) => unknown) {
  setActivePinia(createPinia());
  localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
  validateRadioKeyQuickMock.mockResolvedValue(true);
  ensureTokenMock.mockResolvedValue('a-token');

  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(fetchImpl(url))));

  const wrapper = mount(Status);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('backoffice/status.vue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the admin key gate before the radio key is validated', async () => {
    setActivePinia(createPinia());
    ensureTokenMock.mockResolvedValue('a-token');
    validateRadioKeyQuickMock.mockResolvedValue(false);
    vi.stubGlobal('fetch', vi.fn());

    const wrapper = mount(Status);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain('Server');
  });

  it('shows uptime, connection counts, and Icecast reachability', async () => {
    const wrapper = await mountStatus(defaultFetchImpl());

    expect(wrapper.text()).toContain('1h 30m');
    expect(wrapper.text()).toContain('3'); // chatListeners
    expect(wrapper.text()).toContain('2'); // chatAdmins
    expect(wrapper.text()).toContain('Reachable');
  });

  it('shows Unreachable when Icecast is down', async () => {
    const wrapper = await mountStatus(defaultFetchImpl(systemStatus({ icecastReachable: false })));

    expect(wrapper.text()).toContain('Unreachable');
  });

  it('shows "none yet" when no metrics sample has been recorded', async () => {
    const wrapper = await mountStatus(defaultFetchImpl(systemStatus({ lastMetricsSampleAt: null })));

    expect(wrapper.text()).toContain('none yet');
  });

  it('shows a retry button and no Server card when a fetch fails', async () => {
    const wrapper = await mountStatus(() => jsonResponse(null, false));

    expect(wrapper.text()).not.toContain('Server');
    expect(wrapper.get('button')).toBeTruthy();
  });

  it('filters recently-validated entries to the last hour, distinct from the full audit log', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T12:00:00Z'));

    setActivePinia(createPinia());
    localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
    validateRadioKeyQuickMock.mockResolvedValue(true);
    ensureTokenMock.mockResolvedValue('a-token');

    const auditLog = [
      auditEntry({ timestamp: '2026-08-16T11:50:00Z', lidnr: 1, given_name: 'Ada', family_name: 'Lovelace' }), // 10 min ago
      auditEntry({ timestamp: '2026-08-16T09:00:00Z', lidnr: 2, given_name: 'Bob', family_name: 'Builder' }), // 3h ago
    ];
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(defaultFetchImpl(systemStatus(), auditLog)(url))));

    const wrapper = mount(Status);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(wrapper.text()).toContain('Ada Lovelace (m1)');
    expect(wrapper.text()).not.toContain('Bob Builder (m2)');
  });

  it('shows a message when no one has validated the key in the last hour', async () => {
    const wrapper = await mountStatus(defaultFetchImpl(systemStatus(), []));

    expect(wrapper.text()).toContain('No one has validated the radio key in the last hour.');
  });

  it('auto-refreshes every 15 seconds', async () => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
    validateRadioKeyQuickMock.mockResolvedValue(true);
    ensureTokenMock.mockResolvedValue('a-token');

    const fetchMock = vi.fn((url: string) => Promise.resolve(defaultFetchImpl()(url)));
    vi.stubGlobal('fetch', fetchMock);

    mount(Status);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterInitialLoad = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterInitialLoad);
  });

  it('stops auto-refreshing on unmount', async () => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
    validateRadioKeyQuickMock.mockResolvedValue(true);
    ensureTokenMock.mockResolvedValue('a-token');

    const fetchMock = vi.fn((url: string) => Promise.resolve(defaultFetchImpl()(url)));
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(Status);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeUnmount = fetchMock.mock.calls.length;

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock.mock.calls.length).toBe(callsBeforeUnmount);
  });
});
