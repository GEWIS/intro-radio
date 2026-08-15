<template>
  <v-card class="pa-4 comic-outline" color="surface" rounded="lg">
    <div v-if="isMobile && !started" class="d-flex flex-column align-center py-8">
      <v-btn
        class="mb-2"
        color="primary"
        elevation="4"
        prepend-icon="mdi-play-circle-outline"
        rounded="pill"
        size="large"
        @click="startStream"
      >
        Start Video Stream
      </v-btn>

      <div class="text-caption text-secondary font-weight-medium">Video streaming may use significant data</div>
    </div>

    <div v-else-if="hasError" class="d-flex flex-column align-center py-8 text-center">
      <v-icon class="mb-2" color="error" icon="mdi-alert-circle-outline" size="40" />
      <div class="text-body-2 mb-3">Unable to load the video stream.</div>
      <v-btn color="primary" prepend-icon="mdi-refresh" variant="tonal" @click="retry">Try again</v-btn>
    </div>

    <div v-else-if="!videoHealthy" class="d-flex flex-column align-center py-8 text-center">
      <v-icon class="mb-2" color="warning" icon="mdi-progress-alert" size="40" />
      <div class="text-body-2">Oops, something's wrong with the video. Check back later.</div>
    </div>

    <video
      v-else
      ref="video"
      autoplay
      muted
      playsinline
      :poster="poster"
      style="width: 100%; border-radius: 8px"
      title="Radio Livestream"
      @error="handleVideoError"
    />
  </v-card>
</template>

<script setup lang="ts">
import Hls from 'hls.js';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{
  src: string;
  poster?: string;
}>();

const video = ref<HTMLVideoElement | null>(null);
const started = ref(false);
const hasError = ref(false);
const videoHealthy = ref(true);

const isMobile = computed(() =>
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
);

let hls: Hls | null = null;
let healthInterval: number | null = null;
let lastFingerprint: string | null = null;
let staleCount = 0;

// Consecutive polls (not just one) with no progress, since a single slow
// poll shouldn't flip the whole video off -- only a stream that's genuinely
// stopped advancing over multiple checks.
const HEALTH_POLL_INTERVAL_MS = 5000;
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

async function fetchPlaylistFingerprint(): Promise<string | null> {
  const res = await fetch(props.src, { cache: 'no-store' });
  const text = await res.text();
  const mediaUrl = resolveMediaPlaylistUrl(text, props.src);
  if (!mediaUrl) return extractFingerprint(text);

  const mediaRes = await fetch(mediaUrl, { cache: 'no-store' });
  return extractFingerprint(await mediaRes.text());
}

async function checkVideoHealth() {
  let fingerprint: string | null = null;
  try {
    fingerprint = await fetchPlaylistFingerprint();
  } catch {
    fingerprint = null;
  }

  if (fingerprint !== null && fingerprint !== lastFingerprint) {
    staleCount = 0;
    lastFingerprint = fingerprint;
  } else {
    staleCount += 1;
  }
  videoHealthy.value = staleCount < STALE_THRESHOLD;
}

function stopHealthCheck() {
  if (healthInterval !== null) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
  lastFingerprint = null;
  staleCount = 0;
  videoHealthy.value = true;
}

function startHealthCheck() {
  stopHealthCheck();
  checkVideoHealth();
  healthInterval = setInterval(checkVideoHealth, HEALTH_POLL_INTERVAL_MS);
}

function startStream() {
  started.value = true;
  // Wait for next tick to ensure video element is rendered
  setTimeout(() => {
    setupStream();
  });
}

function destroyHls() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
}

function setupStream() {
  if (!video.value) return;

  hasError.value = false;
  destroyHls();

  if (Hls.isSupported()) {
    hls = new Hls();
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        console.error('Fatal Hls.js error', data);
        hasError.value = true;
        destroyHls();
      }
    });
    hls.loadSource(props.src);
    hls.attachMedia(video.value);
  } else if (video.value.canPlayType('application/vnd.apple.mpegurl')) {
    video.value.src = props.src;
  }
  video.value.play().catch(() => {});
  startHealthCheck();
}

async function retry() {
  hasError.value = false;
  // videoHealthy also gates the <video> element's own v-else branch, same as
  // hasError -- if it were still false here, the ref setupStream() needs
  // would never re-render and this would deadlock.
  stopHealthCheck();
  await nextTick();
  setupStream();
}

function handleVideoError() {
  // Fired for native (non-Hls.js) playback failures, e.g. Safari's built-in HLS support.
  hasError.value = true;
}

onMounted(() => {
  if (!isMobile.value) {
    started.value = true;
    setupStream();
  }
});

onBeforeUnmount(() => {
  destroyHls();
  stopHealthCheck();
});
</script>
<style scoped>
.comic-outline {
  outline: 3px solid #111;
  outline-offset: -2px;
  border-radius: 8px;
  box-shadow: none;
}
</style>
