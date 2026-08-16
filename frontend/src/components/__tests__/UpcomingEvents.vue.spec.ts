import type { ComponentMountingOptions } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UpcomingEvents from '@/components/UpcomingEvents.vue';
import { useAppStore } from '@/stores/app';
import { mountWithVuetify } from '@/test-utils';

function mountWithAgenda(agenda: ReturnType<typeof useAppStore>['agenda'], options: ComponentMountingOptions<typeof UpcomingEvents> = {}) {
  // setActivePinia alone is sufficient: useAppStore() inside the mounted
  // component resolves the active Pinia via getActivePinia(). Installing a
  // *second*, freshly-created Pinia as a global plugin here would make the
  // component pick up an empty store instead of the one just populated
  // above -- do not add `global: { plugins: [createPinia()] }`.
  setActivePinia(createPinia());
  const store = useAppStore();
  store.agenda = agenda;
  return mountWithVuetify(UpcomingEvents, options);
}

describe('UpcomingEvents', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    // UpcomingEvents.vue calls the real useDarkMode() (not mocked -- out of
    // scope for this task) to decide each event row's background; that
    // composable's onMounted hook reaches for window.matchMedia, which
    // jsdom does not implement at all. Without this stub, mounting the
    // component throws before any test-specific assertion ever runs.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('starts collapsed', () => {
    const wrapper = mountWithAgenda([]);
    expect(wrapper.get('[aria-expanded]').attributes('aria-expanded')).toBe('false');
  });

  it('expands on header click and shows event content', async () => {
    const wrapper = mountWithAgenda([
      { title: 'Opener', subtitle: 'Welcome', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2026-06-01', time: '9:00 - 10:00' },
    ]);

    await wrapper.get('[role="button"]').trigger('click');

    expect(wrapper.get('[aria-expanded]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.text()).toContain('Opener');
    expect(wrapper.text()).toContain('Welcome');
  });

  it('excludes events that have already ended', async () => {
    const wrapper = mountWithAgenda([
      { title: 'Past', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2025-01-01', time: '9:00 - 10:00' },
      { title: 'Future', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2027-01-01', time: '9:00 - 10:00' },
    ]);
    await wrapper.get('[role="button"]').trigger('click');

    expect(wrapper.text()).not.toContain('Past');
    expect(wrapper.text()).toContain('Future');
  });

  it('treats an overnight event (end time-of-day before start) as ending the next calendar day', async () => {
    // "Now" is 2026-01-01T00:00:00Z; an event on 2025-12-31 20:00-08:00
    // should still be considered current/upcoming (ends 2026-01-01 08:00),
    // not already-ended.
    const wrapper = mountWithAgenda([
      { title: 'Overnight', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2025-12-31', time: '20:00 - 08:00' },
    ]);
    await wrapper.get('[role="button"]').trigger('click');

    expect(wrapper.text()).toContain('Overnight');
  });

  it('groups same-day events under one weekday heading', async () => {
    const wrapper = mountWithAgenda([
      { title: 'Morning', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2026-06-01', time: '9:00 - 10:00' },
      { title: 'Evening', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2026-06-01', time: '18:00 - 19:00' },
    ]);
    await wrapper.get('[role="button"]').trigger('click');

    expect(wrapper.findAll('.text-caption.font-weight-bold')).toHaveLength(1);
  });

  it('shows a remaining-time progress bar and minutes-left text only on the currently running segment', async () => {
    const wrapper = mountWithAgenda([
      // Same overnight window the test above already proves is "current" at
      // the frozen system time of 2026-01-01T00:00:00Z.
      { title: 'Current', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2025-12-31', time: '20:00 - 08:00' },
      { title: 'Future', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2027-01-01', time: '9:00 - 10:00' },
    ]);
    await wrapper.get('[role="button"]').trigger('click');

    expect(wrapper.text()).toContain('min left');
    // .v-progress-linear--rounded (from this component's own `rounded` prop)
    // excludes Vuetify's own hidden, always-present page-load progress bar,
    // which also matches a bare `.v-progress-linear` or a by-name component
    // lookup but isn't this feature.
    expect(wrapper.findAll('.v-progress-linear--rounded')).toHaveLength(1);
  });

  it('advances the remaining-time bar as time passes, without needing to remount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const wrapper = mountWithAgenda([
      { title: 'Current', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2025-12-31', time: '20:00 - 08:00' },
    ]);
    await wrapper.get('[role="button"]').trigger('click');

    const bar = () => Number(wrapper.get('.v-progress-linear--rounded').attributes('aria-valuenow'));
    const before = bar();

    await vi.advanceTimersByTimeAsync(5 * 60_000); // several 30s ticks of the internal "now" timer

    expect(bar()).toBeGreaterThan(before);
  });

  it('persists the expanded/collapsed state across remounts', async () => {
    const first = mountWithAgenda([]);
    await first.get('[role="button"]').trigger('click');
    expect(first.get('[aria-expanded]').attributes('aria-expanded')).toBe('true');

    const second = mountWithAgenda([]); // fresh component instance, same localStorage
    expect(second.get('[aria-expanded]').attributes('aria-expanded')).toBe('true');
  });
});
