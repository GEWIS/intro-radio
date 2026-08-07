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

const isMobile = computed(() =>
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
);

let hls: Hls | null = null;

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
}

async function retry() {
  hasError.value = false;
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
