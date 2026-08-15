import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mountWithVuetify } from '@/test-utils';
import { useDarkMode } from '../useDarkMode';

function mountDarkMode() {
  let result!: ReturnType<typeof useDarkMode>;
  const Host = defineComponent({
    setup() {
      result = useDarkMode();
      return () => null;
    },
  });
  mountWithVuetify(Host);
  return result;
}

function mockMatchMedia(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: prefersDark,
      addEventListener: vi.fn(),
    }),
  );
}

describe('useDarkMode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('applies the system preference when nothing is stored yet', () => {
    mockMatchMedia(true);
    const { isDark } = mountDarkMode();

    expect(isDark.value).toBe(true);
    expect(localStorage.getItem('dark-mode')).toBe('true');
  });

  it('applies a stored preference over the system preference', () => {
    localStorage.setItem('dark-mode', 'false');
    mockMatchMedia(true); // system says dark, stored says light -- stored wins

    const { isDark } = mountDarkMode();

    expect(isDark.value).toBe(false);
  });

  it('toggle() flips isDark and persists the new value', () => {
    localStorage.setItem('dark-mode', 'false');
    mockMatchMedia(false);
    const { isDark, toggle } = mountDarkMode();

    toggle();

    expect(isDark.value).toBe(true);
    expect(localStorage.getItem('dark-mode')).toBe('true');
  });

  it('enable()/disable() set an explicit value regardless of current state', () => {
    localStorage.setItem('dark-mode', 'false');
    mockMatchMedia(false);
    const { isDark, enable, disable } = mountDarkMode();

    enable();
    expect(isDark.value).toBe(true);

    disable();
    expect(isDark.value).toBe(false);
  });
});
