import type { AdminGateStage, useAdminGate } from '@/composables/useAdminGate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import AdminKeyGate from '@/components/AdminKeyGate.vue';
import { mountWithVuetify } from '@/test-utils';

type Gate = ReturnType<typeof useAdminGate>;

// AdminKeyGate only reads gate.stage.value/gate.errorMsg.value and calls
// gate.submitKey(), but its prop type is the full useAdminGate() return
// shape (`{ stage, token, radioKey, errorMsg, init, submitKey,
// dropToNeedKey }`), so the fake mirrors that whole shape rather than a
// partial guess -- keeping the prop type honest under yarn type-check.
function makeGate(overrides: Partial<Gate> = {}): Gate {
  return {
    stage: ref<AdminGateStage>('auth'),
    token: ref<string | null>(null),
    radioKey: ref<string | null>(null),
    errorMsg: ref(''),
    init: vi.fn(),
    submitKey: vi.fn().mockResolvedValue(true),
    dropToNeedKey: vi.fn(),
    ...overrides,
  };
}

describe('AdminKeyGate', () => {
  beforeEach(() => {
    // The "Continue" v-btn switches to a spinner (VProgressCircular) while
    // validating is true, and that component measures itself via
    // ResizeObserver -- a real browser API jsdom doesn't implement. Stub it
    // so the loading-state test can mount without a ReferenceError.
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
  });

  it('shows a loading skeleton in the auth stage', () => {
    const wrapper = mountWithVuetify(AdminKeyGate, { props: { gate: makeGate() } });

    expect(wrapper.find('.v-skeleton-loader').exists()).toBe(true);
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('shows the key-entry form in the need-key stage', () => {
    const gate = makeGate();
    gate.stage.value = 'need-key';
    const wrapper = mountWithVuetify(AdminKeyGate, { props: { gate } });

    expect(wrapper.find('form').exists()).toBe(true);
  });

  it('renders nothing once the gate is ready', () => {
    const gate = makeGate();
    gate.stage.value = 'ready';
    const wrapper = mountWithVuetify(AdminKeyGate, { props: { gate } });

    expect(wrapper.find('.v-skeleton-loader').exists()).toBe(false);
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('submits the typed key and disables the field while validating', async () => {
    let resolveSubmit!: (value: boolean) => void;
    const submitKey = vi.fn().mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const gate = makeGate({ submitKey });
    gate.stage.value = 'need-key';
    const wrapper = mountWithVuetify(AdminKeyGate, { props: { gate } });

    await wrapper.get('input').setValue('my-key');
    await wrapper.get('form').trigger('submit');

    expect(submitKey).toHaveBeenCalledWith('my-key');
    expect(wrapper.get('input').attributes('disabled')).toBeDefined();

    resolveSubmit(true);
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    expect(wrapper.get('input').attributes('disabled')).toBeUndefined();
  });

  it('shows the gate error message in the field', () => {
    const gate = makeGate();
    gate.stage.value = 'need-key';
    gate.errorMsg.value = 'that key is no good';
    const wrapper = mountWithVuetify(AdminKeyGate, { props: { gate } });

    expect(wrapper.text()).toContain('that key is no good');
  });
});
