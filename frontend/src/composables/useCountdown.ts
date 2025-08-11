import { computed, onMounted, onUnmounted, ref } from 'vue';

function toMs(start: Date | number | null | undefined): number | null {
  if (start instanceof Date) return start.getTime();
  if (typeof start === 'number') return start;
  return null;
}

export function useCountdown(startTime: Date, intervalMs = 1000) {
  const now = ref(Date.now());
  let timer: number | undefined;

  const debugCountdown =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'countdown';

  onMounted(() => {
    timer = window.setInterval(() => {
      now.value = Date.now();
    }, intervalMs);
  });

  onUnmounted(() => {
    if (timer) window.clearInterval(timer);
  });

  const countdown = computed(() => {
    if (debugCountdown) return -1; // force "started"
    const startMs = toMs(startTime);
    return startMs == null ? 0 : startMs - now.value;
  });

  const isStarted = computed(() => countdown.value <= 0 || debugCountdown);

  const formattedCountdown = computed(() => {
    const totalSeconds = Math.max(0, Math.floor(countdown.value / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours} Hour${hours === 1 ? '' : 's'},`);
    if (minutes > 0 || hours > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'} and`);
    parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);

    return parts.join(' ');
  });

  return { now, countdown, isStarted, formattedCountdown };
}
