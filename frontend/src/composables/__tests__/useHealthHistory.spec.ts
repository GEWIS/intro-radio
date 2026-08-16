import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { mountWithVuetify } from '@/test-utils';
import { useHealthHistory } from '../useHealthHistory';

function mountHealthHistory(initialHealthy: boolean, options?: Parameters<typeof useHealthHistory>[1]) {
  const healthy = ref(initialHealthy);
  let result!: ReturnType<typeof useHealthHistory>;
  const Host = defineComponent({
    setup() {
      result = useHealthHistory(healthy, options);
      return () => null;
    },
  });
  const wrapper = mountWithVuetify(Host);
  return { ...result, healthy, wrapper };
}

describe('useHealthHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records one sample immediately on start(), then one per sampleMs tick', () => {
    const { history, start } = mountHealthHistory(true, { sampleMs: 1000, windowMs: 10_000 });

    start();
    expect(history.value).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(history.value).toHaveLength(3);
  });

  it('records the current healthy value at each sample, not just changes', () => {
    const { history, healthy, start } = mountHealthHistory(true, { sampleMs: 1000, windowMs: 10_000 });

    start();
    healthy.value = false;
    vi.advanceTimersByTime(1000); // still unhealthy
    vi.advanceTimersByTime(1000); // still unhealthy

    expect(history.value.map((s) => s.healthy)).toEqual([true, false, false]);
  });

  it('caps the buffer at windowMs/sampleMs samples, dropping the oldest first', () => {
    const { history, start } = mountHealthHistory(true, { sampleMs: 1000, windowMs: 3000 });

    start();
    for (let i = 0; i < 10; i++) vi.advanceTimersByTime(1000);

    expect(history.value.length).toBe(3);
  });

  it('resets the buffer when start() is called again', () => {
    const { history, start } = mountHealthHistory(true, { sampleMs: 1000, windowMs: 10_000 });

    start();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(history.value.length).toBeGreaterThan(1);

    start();
    expect(history.value).toHaveLength(1);
  });

  it('stops recording once stop() is called', () => {
    const { history, start, stop } = mountHealthHistory(true, { sampleMs: 1000, windowMs: 10_000 });

    start();
    const lenAfterStart = history.value.length;

    stop();
    vi.advanceTimersByTime(5000);

    expect(history.value.length).toBe(lenAfterStart);
  });

  it('stops recording on unmount', () => {
    const { history, start, wrapper } = mountHealthHistory(true, { sampleMs: 1000, windowMs: 10_000 });

    start();
    const lenBeforeUnmount = history.value.length;

    wrapper.unmount();
    vi.advanceTimersByTime(5000);

    expect(history.value.length).toBe(lenBeforeUnmount);
  });
});
