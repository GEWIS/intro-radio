import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, ref } from 'vue';
import { VApp } from 'vuetify/components';
import AppFooter from '@/components/AppFooter.vue';
import { mountWithVuetify } from '@/test-utils';

// AppFooter renders `<v-footer app>`. The `app` prop registers the footer
// with Vuetify's layout system (`useLayoutItem`), which injects a layout
// context that only a `<v-app>` ancestor provides -- mounting AppFooter
// directly throws "[Vuetify] Could not find injected layout". Wrapping it
// in a real VApp gives it that context without stubbing Vuetify itself.
function mountAppFooter() {
  return mountWithVuetify(VApp, { slots: { default: () => h(AppFooter) } });
}

// vi.mock() factories are hoisted above regular top-level statements (see
// useAdminGate.spec.ts for the same pattern) -- toggleMock must be declared
// via vi.hoisted() so it exists by the time the factory below runs. Mocking
// useDarkMode entirely (rather than stubbing window.matchMedia) means this
// test only asserts AppFooter's own wiring -- that clicking the button
// calls toggle -- not useDarkMode's real theme-flipping behavior, which
// already has its own coverage.
//
// `isDark` must be a real Vue `ref()`, not a plain `{ value: false }`
// object: AppFooter destructures it in `<script setup>` and uses it bare
// in the template (`isDark ? ... : ...`), which only auto-unwraps through
// Vue's internal `isRef()` check. A plain object fails that check and is
// used as-is -- always truthy -- so the toggle button would render as if
// dark mode were permanently on. `ref()` can't be constructed inside
// `vi.hoisted()` (TDZ ReferenceError), so it's created lazily inside the
// mock factory itself.
const { toggleMock } = vi.hoisted(() => ({ toggleMock: vi.fn() }));

vi.mock('@/composables/useDarkMode.ts', () => ({
  useDarkMode: () => ({ isDark: ref(false), toggle: toggleMock }),
}));

describe('AppFooter', () => {
  beforeEach(() => {
    // VFooter measures itself via ResizeObserver -- a real browser API
    // jsdom doesn't implement (same gotcha already handled in
    // AdminKeyGate.vue.spec.ts for a different Vuetify component).
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
    vi.unstubAllEnvs();
  });

  it('shows the current year and a link to the repo', () => {
    const wrapper = mountAppFooter();

    expect(wrapper.text()).toContain(String(new Date().getFullYear()));
    expect(wrapper.get('a[href="https://github.com/GEWIS/intro-radio"]')).toBeTruthy();
  });

  it('calls toggle when the dark-mode button is clicked', async () => {
    const wrapper = mountAppFooter();

    await wrapper.get('[aria-label="Switch to dark mode"]').trigger('click');

    expect(toggleMock).toHaveBeenCalledTimes(1);
  });

  // This is the whole point of the indicator: given a real commit SHA baked
  // in at build time (see frontend/Dockerfile's VITE_GIT_SHA), the footer
  // must show the 7-char short form and link to that exact commit on GitHub
  // -- so anyone looking at a deployed page can tell precisely what's running.
  it('shows the short SHA and links to the commit when VITE_GIT_SHA is set', () => {
    const fullSha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
    vi.stubEnv('VITE_GIT_SHA', fullSha);

    const wrapper = mountAppFooter();
    const link = wrapper.get('[aria-label="View deployed commit on GitHub"]');

    expect(wrapper.text()).toContain('a1b2c3d');
    expect(wrapper.text()).not.toContain(fullSha);
    expect(link.attributes('href')).toBe(`https://github.com/GEWIS/intro-radio/commit/${fullSha}`);
  });

  // A build that never received --build-arg GIT_SHA (e.g. `yarn dev` locally)
  // has no real commit to point at. It must fall back to a plain, non-linking
  // "unknown" label instead of building a broken /commit/undefined URL.
  it('falls back to a disabled "unknown" indicator when VITE_GIT_SHA is unset', () => {
    vi.stubEnv('VITE_GIT_SHA', '');

    const wrapper = mountAppFooter();
    const indicator = wrapper.get('[aria-label="View deployed commit on GitHub"]');

    expect(wrapper.text()).toContain('unknown');
    expect(indicator.attributes('href')).toBeUndefined();
  });
});
