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
      plugins: [vuetify, ...(options.global?.plugins ?? [])],
      ...options.global,
    },
  });
}
