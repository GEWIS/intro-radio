import { computed, onUnmounted, type Ref, ref, watch } from 'vue';

const LIVE_POLL_INTERVAL_MS = 15_000;

// The backend's default RADIO_AUDIO_URL has no scheme (e.g. "bata-radio.snt.utwente.nl"),
// which makes a URL built from it resolve as a same-origin relative path
// instead of an absolute one. Default to https:// when no scheme is present.
const SCHEME_PATTERN = /^[a-z][a-z\d+\-.]*:\/\//i;

export function normalizeIcecastBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  return SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// icestats.source is a single JSON object when only one mount point is live
// on the Icecast server, and an array when several are -- that shape switch
// is Icecast's own quirk, not ours, so both are handled here. Mirrors
// backend/metrics.go's fetchListenerCount, which replicates this same logic
// server-side so the two agree on what counts as "the mount point's source."
export function findMatchingSource(data: any, mountPoint: string) {
  const sources = data?.icestats?.source;
  if (Array.isArray(sources)) {
    return sources.find((s: any) => s.listenurl?.endsWith(mountPoint)) ?? null;
  }
  if (sources && sources.listenurl?.endsWith(mountPoint)) {
    return sources;
  }
  return null;
}

// Whether Icecast currently has a live source for mountPoint, polled
// continuously from the moment this is called (not gated behind anything
// else) -- both AudioStream's play prompt and the backoffice dashboard's
// health row need to know this independently of whether anyone is actually
// listening right now.
export function useIcecastLiveStatus(baseUrl: Ref<string>, mountPoint: Ref<string>) {
  const normalizedBaseUrl = computed(() => normalizeIcecastBaseUrl(baseUrl.value));
  const statusUrl = computed(() => `${normalizedBaseUrl.value}/status-json.xsl`);

  const isLive = ref(false);
  let interval: number | null = null;

  async function check() {
    try {
      const res = await fetch(statusUrl.value);
      const data = await res.json();
      isLive.value = findMatchingSource(data, mountPoint.value) !== null;
    } catch {
      isLive.value = false;
    }
  }

  function start() {
    stop();
    check();
    interval = setInterval(check, LIVE_POLL_INTERVAL_MS);
  }

  function stop() {
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  }

  // Re-fetching status-json.xsl from a different base URL, or re-matching
  // against a different mount point, on every change keeps this correct if
  // either prop changes after mount -- not just at the moment this was
  // first called.
  watch([baseUrl, mountPoint], start, { immediate: true });
  onUnmounted(stop);

  return { isLive, normalizedBaseUrl, statusUrl };
}
