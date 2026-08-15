import { onUnmounted, type Ref, ref } from 'vue';

const HEALTH_POLL_INTERVAL_MS = 5000;

// Consecutive polls (not just one) with no progress, since a single slow
// poll shouldn't flip the whole video off -- only a stream that's genuinely
// stopped advancing over multiple checks.
const STALE_THRESHOLD = 3;

// A stale .m3u8 (the source disconnected but the playlist file is still
// sitting there, unchanged, from before) still returns 200 with valid-looking
// content, so "the URL responds" proves nothing on its own. This follows the
// #EXT-X-STREAM-INF redirect from a master playlist to its actual media
// playlist (re-resolved every poll, so it keeps working across a session-id
// change on the source restarting), then fingerprints on #EXT-X-MEDIA-SEQUENCE
// -- the field that only advances while segments are actually still arriving.
function resolveMediaPlaylistUrl(playlistText: string, playlistUrl: string): string | null {
  const lines = playlistText.split('\n').map((line) => line.trim());
  const streamInfIndex = lines.findIndex((line) => line.startsWith('#EXT-X-STREAM-INF'));
  if (streamInfIndex === -1) return null;
  const uriLine = lines[streamInfIndex + 1];
  if (!uriLine) return null;
  return new URL(uriLine, playlistUrl).toString();
}

function extractFingerprint(playlistText: string): string | null {
  const sequenceMatch = playlistText.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
  if (sequenceMatch) return sequenceMatch[1];
  return playlistText.trim() || null;
}

async function fetchPlaylistFingerprint(src: string): Promise<string | null> {
  const res = await fetch(src, { cache: 'no-store' });
  const text = await res.text();
  const mediaUrl = resolveMediaPlaylistUrl(text, src);
  if (!mediaUrl) return extractFingerprint(text);

  const mediaRes = await fetch(mediaUrl, { cache: 'no-store' });
  return extractFingerprint(await mediaRes.text());
}

// Whether srcRef's HLS playlist is actually advancing, not just reachable.
// start()/stop() are explicit (not auto-started on creation) because
// VideoStream ties this to its own setup/retry lifecycle rather than to
// mount alone -- a retry needs to reset the staleness counter, not just
// keep polling through it.
export function useVideoHealth(srcRef: Ref<string>) {
  const healthy = ref(true);
  let interval: number | null = null;
  let lastFingerprint: string | null = null;
  let staleCount = 0;

  async function check() {
    let fingerprint: string | null;
    try {
      fingerprint = await fetchPlaylistFingerprint(srcRef.value);
    } catch {
      fingerprint = null;
    }

    if (fingerprint !== null && fingerprint !== lastFingerprint) {
      staleCount = 0;
      lastFingerprint = fingerprint;
    } else {
      staleCount += 1;
    }
    healthy.value = staleCount < STALE_THRESHOLD;
  }

  function stop() {
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
    lastFingerprint = null;
    staleCount = 0;
    healthy.value = true;
  }

  function start() {
    stop();
    check();
    interval = setInterval(check, HEALTH_POLL_INTERVAL_MS);
  }

  onUnmounted(stop);

  return { healthy, start, stop };
}
