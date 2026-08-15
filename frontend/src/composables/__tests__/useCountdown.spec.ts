import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mountWithVuetify } from '@/test-utils';
import { useCountdown } from '../useCountdown';

function mountCountdown(startTime: Date, intervalMs?: number) {
  let result!: ReturnType<typeof useCountdown>;
  const Host = defineComponent({
    setup() {
      result = useCountdown(startTime, intervalMs);
      return () => null;
    },
  });
  mountWithVuetify(Host);
  return result;
}

describe('useCountdown', () => {
  it('reports not started with a positive formatted countdown before start time', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { isStarted, countdown, formattedCountdown } = mountCountdown(new Date('2026-01-01T01:01:05Z'));

    expect(isStarted.value).toBe(false);
    expect(countdown.value).toBe(61 * 60 * 1000 + 5000);
    expect(formattedCountdown.value).toBe('1 Hour, 1 minute and 5 seconds');
  });

  it('reports started once start time has passed', () => {
    vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));
    const { isStarted, countdown } = mountCountdown(new Date('2026-01-01T01:00:00Z'));

    expect(isStarted.value).toBe(true);
    expect(countdown.value).toBeLessThanOrEqual(0);
  });

  it('pluralizes hours/minutes/seconds correctly at exactly 1 of each', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { formattedCountdown } = mountCountdown(new Date('2026-01-01T01:01:01Z'));

    expect(formattedCountdown.value).toBe('1 Hour, 1 minute and 1 second');
  });

  it('omits the hours segment entirely under an hour', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { formattedCountdown } = mountCountdown(new Date('2026-01-01T00:05:09Z'));

    expect(formattedCountdown.value).toBe('5 minutes and 9 seconds');
  });

  it('shows just seconds under a minute', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { formattedCountdown } = mountCountdown(new Date('2026-01-01T00:00:09Z'));

    expect(formattedCountdown.value).toBe('9 seconds');
  });

  it('re-derives countdown as `now` advances on the interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { countdown } = mountCountdown(new Date('2026-01-01T00:00:10Z'), 1000);

    expect(countdown.value).toBe(10_000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(countdown.value).toBe(6000);
    vi.useRealTimers();
  });

  it('forces isStarted via ?debug=countdown regardless of start time', () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, search: '?debug=countdown' },
      writable: true,
    });

    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { isStarted, countdown } = mountCountdown(new Date('2200-01-01T00:00:00Z'));

    expect(isStarted.value).toBe(true);
    expect(countdown.value).toBe(-1);

    Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
  });
});
