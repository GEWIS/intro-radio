import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import HealthHistoryStrip from '@/components/HealthHistoryStrip.vue';
import { useAppStore } from '@/stores/app';
import { useChatStore } from '@/stores/chat';
import { mountWithVuetify } from '@/test-utils';
import Dashboard from '../dashboard.vue';

// Same hoisting reasoning as the other admin-gated page/component specs in
// this codebase (see useAdminGate.spec.ts, AdminChat.vue.spec.ts).
const { ensureTokenMock, validateRadioKeyQuickMock, connectMock, audioLiveBox, videoHealthyBox, startVideoHealthMock } =
  vi.hoisted(() => ({
    ensureTokenMock: vi.fn(),
    validateRadioKeyQuickMock: vi.fn(),
    connectMock: vi.fn(),
    audioLiveBox: { current: null as { value: boolean } | null },
    videoHealthyBox: { current: null as { value: boolean } | null },
    startVideoHealthMock: vi.fn(),
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
// The health composables have their own thorough unit tests (useIcecastLiveStatus.spec.ts,
// useVideoHealth.spec.ts) -- mocked here so this file only has to verify
// Dashboard wires their output into the page correctly, not re-verify their
// own polling/fingerprinting logic against a maze of fetch mocks.
vi.mock('@/composables/useIcecastLiveStatus', () => ({
  useIcecastLiveStatus: () => {
    audioLiveBox.current ??= ref(true);
    return { isLive: audioLiveBox.current, normalizedBaseUrl: ref('https://example.com'), statusUrl: ref('') };
  },
}));
vi.mock('@/composables/useVideoHealth', () => ({
  useVideoHealth: () => {
    videoHealthyBox.current ??= ref(true);
    return { healthy: videoHealthyBox.current, start: startVideoHealthMock, stop: vi.fn() };
  },
}));

function metricPoint(overrides: Partial<{ timestamp: string; listeners: number; chatters: number }> = {}) {
  return { timestamp: '2026-08-15T10:00:00Z', listeners: 1, chatters: 1, ...overrides };
}

function auditEntry(overrides: Partial<{ timestamp: string; lidnr: number; given_name: string; family_name: string }> = {}) {
  return { timestamp: '2026-08-15T10:00:00Z', lidnr: 1, given_name: 'Ada', family_name: 'Lovelace', ...overrides };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

function percentFromStyle(style: string, prop: 'left' | 'top'): number {
  const match = style.match(new RegExp(String.raw`${prop}:\s*([\d.]+)%`));
  return match ? Number(match[1]) : Number.NaN;
}

// This page doesn't need real navigation for any of its own tests -- just
// its router-links resolving to a real <a href> so href assertions have
// something concrete to check, without pulling in a full router instance.
const routerLinkStub = { props: ['to'], template: '<a :href="to"><slot /></a>' };
function mount(component: typeof Dashboard) {
  return mountWithVuetify(component, { global: { stubs: { RouterLink: routerLinkStub } } });
}

async function mountDashboard(fetchImpl: (url: string) => unknown) {
  setActivePinia(createPinia());
  localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
  validateRadioKeyQuickMock.mockResolvedValue(true);
  ensureTokenMock.mockResolvedValue('a-token');
  audioLiveBox.current = null;
  videoHealthyBox.current = null;

  const store = useAppStore();
  store.radio.audioUrl = 'https://example.com';
  store.radio.audioMountPoint = '/high';
  store.radio.videoUrl = 'https://example.com/stream.m3u8';

  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(fetchImpl(url))));

  const wrapper = mount(Dashboard);
  // gate.init() (onMounted) and the stage watcher's load()/loadLiveStatus()
  // both resolve across a few microtask turns.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await wrapper.vm.$nextTick();
  return wrapper;
}

function defaultFetchImpl(metrics: unknown[] = [], auditLog: unknown[] = []) {
  return (url: string) => {
    if (url === '/api/v1/metrics') return jsonResponse(metrics);
    if (url === '/api/v1/audit-log') return jsonResponse(auditLog);
    if (url === '/api/v1/live-status') return jsonResponse({ listeners: 7, chatters: 2 });
    throw new Error(`unexpected fetch: ${url}`);
  };
}

describe('backoffice/dashboard.vue', () => {
  beforeEach(() => {
    localStorage.clear();
    connectMock.mockClear();
    startVideoHealthMock.mockClear();
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

    const wrapper = mount(Dashboard);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain('Metrics');
  });

  it('shows audio/video health chips and live listener/chatter counts', async () => {
    const wrapper = await mountDashboard(defaultFetchImpl());

    expect(wrapper.text()).toContain('Audio: Live');
    expect(wrapper.text()).toContain('Video: Live');
    expect(wrapper.text()).toContain('7'); // listening now
    expect(wrapper.text()).toContain('2'); // chatting now
  });

  it('reflects an offline/stalled health state', async () => {
    const wrapper = await mountDashboard(defaultFetchImpl());
    audioLiveBox.current!.value = false;
    videoHealthyBox.current!.value = false;
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Audio: Offline');
    expect(wrapper.text()).toContain('Video: Stalled');
  });

  it('shows "No metrics recorded yet" and "No audit log entries yet" when both are empty', async () => {
    const wrapper = await mountDashboard(defaultFetchImpl([], []));

    expect(wrapper.text()).toContain('No metrics recorded yet.');
    expect(wrapper.text()).toContain('No audit log entries yet.');
  });

  it('shows the peak value and when it happened for each metric series', async () => {
    const metrics = [
      metricPoint({ timestamp: '2026-08-15T10:00:00Z', listeners: 3, chatters: 1 }),
      metricPoint({ timestamp: '2026-08-15T10:05:00Z', listeners: 9, chatters: 4 }),
      metricPoint({ timestamp: '2026-08-15T10:10:00Z', listeners: 2, chatters: 2 }),
    ];
    const wrapper = await mountDashboard(defaultFetchImpl(metrics));

    expect(wrapper.text()).toContain('Peak: 9');
    expect(wrapper.text()).toContain('Peak: 4');
  });

  it('positions each peak marker directly over its series\' actual peak point, not just in the caption', async () => {
    const metrics = [
      metricPoint({ timestamp: '2026-08-15T10:00:00Z', listeners: 3, chatters: 1 }),
      metricPoint({ timestamp: '2026-08-15T10:05:00Z', listeners: 9, chatters: 4 }),
      metricPoint({ timestamp: '2026-08-15T10:10:00Z', listeners: 2, chatters: 2 }),
    ];
    const wrapper = await mountDashboard(defaultFetchImpl(metrics));

    const markers = wrapper.findAll('.peak-marker');
    expect(markers).toHaveLength(2); // one per series

    for (const marker of markers) {
      const style = marker.attributes('style') ?? '';
      // Both series peak at index 1 of 3 -> horizontally centered. Being the
      // max of its own series, a peak always renders at VSparkline's own
      // top padding inset (8px into a 60px-tall, 8px-padded chart) --
      // that's a property of how min/max normalization works, not
      // something specific to these numbers.
      expect(percentFromStyle(style, 'left')).toBeCloseTo(50, 1);
      expect(percentFromStyle(style, 'top')).toBeCloseTo((8 / 60) * 100, 1);
    }
  });

  it('groups audit log entries by day, newest day first, with a unique-staff count', async () => {
    const auditLog = [
      auditEntry({ timestamp: '2026-08-15T10:00:00Z', lidnr: 1, given_name: 'Ada', family_name: 'Lovelace' }),
      auditEntry({ timestamp: '2026-08-15T11:00:00Z', lidnr: 2, given_name: 'Bob', family_name: 'Builder' }),
      auditEntry({ timestamp: '2026-08-14T09:00:00Z', lidnr: 1, given_name: 'Ada', family_name: 'Lovelace' }),
    ];
    const wrapper = await mountDashboard(defaultFetchImpl([], auditLog));

    const text = wrapper.text();
    expect(text).toContain('2 staff members'); // 15 Aug: lidnr 1 and 2
    expect(text).toContain('1 staff member'); // 14 Aug: lidnr 1 only
    expect(text.indexOf('Bob Builder')).toBeLessThan(text.indexOf('14')); // 15 Aug group renders before 14 Aug
  });

  it('filters the metrics chart and audit log down to a single picked day', async () => {
    const metrics = [
      metricPoint({ timestamp: '2026-08-15T10:00:00Z', listeners: 3, chatters: 1 }),
      metricPoint({ timestamp: '2026-08-14T10:00:00Z', listeners: 9, chatters: 4 }),
    ];
    const auditLog = [
      auditEntry({ timestamp: '2026-08-15T10:00:00Z', lidnr: 1, given_name: 'Ada', family_name: 'Lovelace' }),
      auditEntry({ timestamp: '2026-08-14T09:00:00Z', lidnr: 2, given_name: 'Bob', family_name: 'Builder' }),
    ];
    const wrapper = await mountDashboard(defaultFetchImpl(metrics, auditLog));

    // Unfiltered: both days' peaks and both staff members show up.
    expect(wrapper.text()).toContain('Peak: 9');
    expect(wrapper.text()).toContain('Bob Builder');

    const select = wrapper.findComponent({ name: 'VSelect' });
    await select.setValue('2026-08-14');
    await wrapper.vm.$nextTick();

    // Filtered to the 14th: only that day's peak and audit entry remain.
    expect(wrapper.text()).not.toContain('Peak: 3');
    expect(wrapper.text()).toContain('Peak: 9');
    expect(wrapper.text()).not.toContain('Ada Lovelace');
    expect(wrapper.text()).toContain('Bob Builder');
  });

  it('shows a day-scoped empty message once a day with no data is picked', async () => {
    const auditLog = [auditEntry({ timestamp: '2026-08-15T10:00:00Z' })];
    const wrapper = await mountDashboard(defaultFetchImpl([], auditLog));

    const select = wrapper.findComponent({ name: 'VSelect' });
    await select.setValue('2026-08-15');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('No metrics recorded for this day.');

    await select.setValue(null);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('No metrics recorded yet.');
  });

  it('links each audit-log entry to that person\'s chat thread', async () => {
    const wrapper = await mountDashboard(defaultFetchImpl([], [auditEntry({ lidnr: 42 })]));

    const link = wrapper.find('a[href="/backoffice?user=42"]');
    expect(link.exists()).toBe(true);
  });

  it('shows a link to unread conversations only when there are any', async () => {
    const wrapper = await mountDashboard(defaultFetchImpl());
    expect(wrapper.text()).not.toContain('unread');

    const chatStore = useChatStore();
    chatStore.usersMap['5'] = { id: '5', givenName: 'Carl', familyName: 'Gauss', unread: 3, lastActivity: Date.now() };
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('3 unread conversations');
  });

  it('shows the currently scheduled agenda segment when now falls within one', async () => {
    setActivePinia(createPinia());
    localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
    validateRadioKeyQuickMock.mockResolvedValue(true);
    ensureTokenMock.mockResolvedValue('a-token');
    audioLiveBox.current = null;
    videoHealthyBox.current = null;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T09:30:00'));

    const store = useAppStore();
    store.radio.audioUrl = 'https://example.com';
    store.radio.audioMountPoint = '/high';
    store.radio.videoUrl = 'https://example.com/stream.m3u8';
    store.agenda = [
      {
        title: 'Breakfast',
        subtitle: '',
        icon: 'mdi-food',
        iconColor: 'primary',
        color: '#fff',
        colorDark: '#000',
        date: '2026-08-15',
        time: '9:00 - 10:00',
      },
    ];

    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(defaultFetchImpl()(url))));

    const wrapper = mount(Dashboard);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(wrapper.text()).toContain('Currently scheduled');
    expect(wrapper.text()).toContain('Breakfast');
  });

  it('shows a retry button and does not render Metrics when a fetch fails', async () => {
    const wrapper = await mountDashboard(() => jsonResponse(null, false));

    expect(wrapper.text()).toContain('Could not load the dashboard data from the server.');
    expect(wrapper.text()).not.toContain('Metrics');
    expect(wrapper.get('button')).toBeTruthy();
  });

  it('auto-refreshes live status every 15 seconds and metrics/audit-log every 5 minutes', async () => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
    validateRadioKeyQuickMock.mockResolvedValue(true);
    ensureTokenMock.mockResolvedValue('a-token');
    audioLiveBox.current = null;
    videoHealthyBox.current = null;

    const store = useAppStore();
    store.radio.audioUrl = 'https://example.com';
    store.radio.audioMountPoint = '/high';
    store.radio.videoUrl = 'https://example.com/stream.m3u8';

    const fetchMock = vi.fn((url: string) => Promise.resolve(defaultFetchImpl()(url)));
    vi.stubGlobal('fetch', fetchMock);

    mount(Dashboard);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterInitialLoad = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(15_000);
    const liveStatusCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/v1/live-status').length;
    expect(liveStatusCalls).toBeGreaterThanOrEqual(2); // initial + one 15s tick
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/metrics').length).toBe(1); // no metrics tick yet

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/v1/metrics').length).toBe(2);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterInitialLoad);
  });

  it('feeds each health strip a growing history as time passes', async () => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
    validateRadioKeyQuickMock.mockResolvedValue(true);
    ensureTokenMock.mockResolvedValue('a-token');
    audioLiveBox.current = null;
    videoHealthyBox.current = null;

    const store = useAppStore();
    store.radio.audioUrl = 'https://example.com';
    store.radio.audioMountPoint = '/high';
    store.radio.videoUrl = 'https://example.com/stream.m3u8';

    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(defaultFetchImpl()(url))));

    const wrapper = mount(Dashboard);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    const [audioStrip, videoStrip] = wrapper.findAllComponents(HealthHistoryStrip);
    expect(audioStrip.props('history')).toHaveLength(1);
    expect(videoStrip.props('history')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(audioStrip.props('history').length).toBeGreaterThan(1);
    expect(videoStrip.props('history').length).toBeGreaterThan(1);
  });

  it('stops auto-refreshing on unmount', async () => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
    validateRadioKeyQuickMock.mockResolvedValue(true);
    ensureTokenMock.mockResolvedValue('a-token');
    audioLiveBox.current = null;
    videoHealthyBox.current = null;

    const store = useAppStore();
    store.radio.audioUrl = 'https://example.com';
    store.radio.audioMountPoint = '/high';
    store.radio.videoUrl = 'https://example.com/stream.m3u8';

    const fetchMock = vi.fn((url: string) => Promise.resolve(defaultFetchImpl()(url)));
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(Dashboard);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    const callsBeforeUnmount = fetchMock.mock.calls.length;

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(fetchMock.mock.calls.length).toBe(callsBeforeUnmount);
  });
});
