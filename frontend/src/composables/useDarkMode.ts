import { onMounted } from 'vue';
import { useTheme } from 'vuetify';

const DARK_MODE_KEY = 'dark-mode';

export function useDarkMode() {
  const theme = useTheme();
  const isDark = computed(() => theme.global.name.value === 'dark');

  const set = (value: boolean) => {
    theme.global.name.value = value ? 'dark' : 'light';
    localStorage.setItem(DARK_MODE_KEY, value ? 'true' : 'false');
  };

  const applyFromSystem = () => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    set(prefersDark);
  };

  const toggle = () => set(!isDark.value);

  onMounted(() => {
    const stored = localStorage.getItem(DARK_MODE_KEY);
    if (stored === null) applyFromSystem();
    else set(stored === 'true');

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => set(e.matches);
    mq.addEventListener?.('change', handler);
  });

  return {
    isDark,
    toggle,
    enable: () => set(true),
    disable: () => set(false),
  };
}
