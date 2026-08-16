import { onUnmounted, type Ref, ref } from 'vue';

const DEFAULT_WINDOW_MS = 60 * 60_000; // last hour
const DEFAULT_SAMPLE_MS = 15_000; // matches the dashboard's own live-status refresh cadence

export type HealthSample = { ts: number; healthy: boolean };

export interface UseHealthHistoryOptions {
  /** How far back the buffer keeps samples for. Defaults to one hour. */
  windowMs?: number;
  /** How often to record a sample. Defaults to 15s. */
  sampleMs?: number;
}

// Renders as a small uptime strip on the dashboard: one sample per tick,
// capped to windowMs/sampleMs entries so the buffer represents a fixed time
// window rather than growing forever. Samples the ref's *current* value on a
// timer rather than watching it for changes, so a health state that never
// flips still fills in a solid strip -- a `watch` would only record the
// moments it changed, leaving long healthy/unhealthy stretches looking like
// a single point.
export function useHealthHistory(healthyRef: Ref<boolean>, options: UseHealthHistoryOptions = {}) {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const sampleMs = options.sampleMs ?? DEFAULT_SAMPLE_MS;
  const maxSamples = Math.max(1, Math.ceil(windowMs / sampleMs));

  const history = ref<HealthSample[]>([]);
  let interval: number | null = null;

  function sample() {
    history.value.push({ ts: Date.now(), healthy: healthyRef.value });
    if (history.value.length > maxSamples) history.value.shift();
  }

  function stop() {
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  }

  function start() {
    stop();
    history.value = [];
    sample();
    interval = setInterval(sample, sampleMs);
  }

  onUnmounted(stop);

  return { history, start, stop };
}
