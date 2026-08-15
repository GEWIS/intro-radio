import type { ComponentMountingOptions } from '@vue/test-utils';
import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';

// Every *.vue file in this app uses Vuetify components (v-card, v-btn, ...).
// Without a real Vuetify instance installed, v-model and slot-based
// components (v-text-field, v-color-picker, v-dialog) don't behave like
// their real selves under test -- they'd render as inert unknown elements.
// One shared instance, created fresh per call so tests don't leak theme
// state into each other.
export function mountWithVuetify<T>(component: T, options: ComponentMountingOptions<T> = {}) {
  const vuetify = createVuetify();
  return mount(component, {
    ...options,
    global: {
      ...options.global,
      // Spreading options.global first, then overriding plugins here (rather
      // than the other way around), is deliberate: options.global.plugins --
      // if the caller passed one -- would otherwise silently win over (and
      // drop) vuetify entirely, since object spread doesn't merge arrays, it
      // just keeps whichever same-named key comes last.
      plugins: [vuetify, ...(options.global?.plugins ?? [])],
    },
  });
}
