import { describe, expect, it } from 'vitest';
import { mountWithVuetify } from '../test-utils';
import Probe from './fixtures/Probe.vue';

describe('mountWithVuetify', () => {
  it('mounts a component with Vuetify components resolved (not stubbed as unknown elements)', () => {
    const wrapper = mountWithVuetify(Probe);

    // A real Vuetify v-btn renders its own internal <button> and CSS
    // classes (v-btn, v-btn--...) -- an unresolved custom element would
    // just pass the literal tag through with none of that. Asserting on
    // Vuetify's own output class is the check that the plugin is actually
    // installed, not just that the tag didn't crash.
    expect(wrapper.find('button.v-btn').exists()).toBe(true);
  });
});
