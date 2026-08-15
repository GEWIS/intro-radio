import type { AgendaEvent } from '@/stores/app';
import { describe, expect, it } from 'vitest';
import IconColorPicker from '@/components/IconColorPicker.vue';
import { mountWithVuetify } from '@/test-utils';

function makeEvent(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    title: '',
    subtitle: '',
    icon: 'mdi-star',
    iconColor: 'blue',
    color: '#ffffff',
    colorDark: '#000000',
    date: '2026-01-01',
    time: '9:00 - 10:00',
    ...overrides,
  };
}

describe('IconColorPicker', () => {
  it('emits the picked icon merged onto the existing model value', async () => {
    const wrapper = mountWithVuetify(IconColorPicker, { props: { modelValue: makeEvent() } });

    // 'guitar' matches exactly one entry in the icon catalog
    // (mdi-guitar-acoustic), so it's a stable, unambiguous target.
    await wrapper.get('input[type="text"]').setValue('guitar');
    const guitarBtn = wrapper.findAll('button').find((b) => b.html().includes('mdi-guitar-acoustic'));
    await guitarBtn?.trigger('click');

    const emitted = wrapper.emitted('update:model-value');
    expect(emitted).toBeTruthy();
    const [payload] = emitted!.at(-1) as [AgendaEvent];
    expect(payload.icon).toBe('mdi-guitar-acoustic');
    expect(payload.title).toBe(''); // rest of the model passed through unchanged
  });

  it('offers a custom mdi-name candidate for an exact, unmatched query', async () => {
    const wrapper = mountWithVuetify(IconColorPicker, { props: { modelValue: makeEvent() } });

    await wrapper.get('input[type="text"]').setValue('mdi-something-totally-custom');

    expect(wrapper.text()).toContain('Use "mdi-something-totally-custom"');
  });

  it('does not offer a custom-icon candidate for a query that is not a valid mdi-name', async () => {
    const wrapper = mountWithVuetify(IconColorPicker, { props: { modelValue: makeEvent() } });

    await wrapper.get('input[type="text"]').setValue('not valid!!');

    expect(wrapper.text()).not.toContain('Use "');
  });

  it('renders the three color fields with their current values', () => {
    const wrapper = mountWithVuetify(IconColorPicker, {
      props: { modelValue: makeEvent({ iconColor: 'red', color: '#abcdef', colorDark: '#123456' }) },
    });

    expect(wrapper.text()).toContain('red');
    expect(wrapper.text()).toContain('#abcdef');
    expect(wrapper.text()).toContain('#123456');
  });
});
