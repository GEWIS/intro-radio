<template>
  <div>
    <audio
      ref="audio"
      :src="nativeSupported ? streamUrl : undefined"
      style="display: none"
      @error="handleStreamError"
    />
    <v-card
      v-ripple
      class="py-4"
      color="primary"
      :prepend-icon="isPlaying ? 'mdi-stop-circle-outline' : 'mdi-play-circle-outline'"
      rounded="lg"
      @click="isPlaying ? stop() : play()"
    >
      <template #title>
        <h2 class="text-h5 font-weight-bold">
          {{ isPlaying ? 'Stop listening' : showLive ? 'Now live' : 'Click to start listening!' }}
        </h2>
      </template>
      <template #subtitle>
        <div v-if="hasError" class="mt-2 text-error">
          {{ errorMessage }}
        </div>
        <div v-else-if="isPlaying" class="mt-2">
          <span v-if="!showListeners">
            Currently playing:
            <strong>{{ currentlyPlaying || 'Loading...' }}</strong>
          </span>
          <span v-else>
            There currently {{ listeners === 1 ? 'is' : 'are' }}
            <strong>{{ listeners !== null ? listeners : 'Loading...' }}</strong>
            {{ listeners === 1 ? 'listener' : 'listeners' }}!
          </span>
        </div>
      </template>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

const props = defineProps<{
  baseUrl: string;
  mountPoint: string;
}>();

// The backend's default RADIO_AUDIO_URL has no scheme (e.g. "bata-radio.snt.utwente.nl"),
// which makes the <audio> src resolve as a same-origin relative path instead of an
// absolute stream URL. Default to https:// when no scheme is present.
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;
const normalizedBaseUrl = computed(() => {
  const trimmed = props.baseUrl.replace(/\/$/, '');
  return SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;
});
const streamUrl = computed(() => `${normalizedBaseUrl.value}${props.mountPoint}`);
const statusUrl = computed(() => `${normalizedBaseUrl.value}/status-json.xsl`);

const audio = ref<HTMLAudioElement | null>(null);
const isPlaying = ref(false);
const nativeSupported = true; // Assume browser can play AAC
const showLive = ref(false);
const currentlyPlaying = ref<string | null>(null);
const listeners = ref<number | null>(null);
const showListeners = ref(false);
const hasError = ref(false);
const errorMessage = ref<string | null>(null);
let intervalId: number | null = null;
let statsInterval: number | null = null;
let switchInterval: number | null = null;

async function fetchCurrentlyPlaying() {
  try {
    const res = await fetch(statusUrl.value);
    const data = await res.json();
    const sources = data.icestats?.source;
    let source = null;
    if (Array.isArray(sources)) {
      source = sources.find((s: any) => s.listenurl?.endsWith(props.mountPoint));
    } else if (sources && sources.listenurl?.endsWith(props.mountPoint)) {
      source = sources;
    }
    currentlyPlaying.value = source?.title || null;
    listeners.value = typeof source?.listeners === 'number' ? source.listeners : null;
  } catch {
    currentlyPlaying.value = null;
    listeners.value = null;
  }
}

function clearPlaybackTimers() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  if (switchInterval) {
    clearInterval(switchInterval);
    switchInterval = null;
  }
}

function play() {
  if (!audio.value) return;
  hasError.value = false;
  errorMessage.value = null;
  audio.value.src = streamUrl.value;
  isPlaying.value = true;
  audio.value.play().catch((error) => {
    console.error('Failed to start audio playback', error);
    handleStreamError();
  });
  fetchCurrentlyPlaying();
  statsInterval = setInterval(fetchCurrentlyPlaying, 15_000);
  switchInterval = setInterval(() => {
    showListeners.value = !showListeners.value;
  }, 4000);
}

function stop() {
  if (!audio.value) return;
  audio.value.pause();
  audio.value.currentTime = 0;
  isPlaying.value = false;
  currentlyPlaying.value = null;
  listeners.value = null;
  clearPlaybackTimers();
}

function handleStreamError() {
  hasError.value = true;
  errorMessage.value = 'Something went wrong playing the stream. Please try again.';
  stop();
}

onMounted(() => {
  intervalId = setInterval(() => {
    showLive.value = isPlaying.value ? false : !showLive.value;
  }, 1500);
});

onUnmounted(() => {
  if (intervalId !== null) clearInterval(intervalId);
  clearPlaybackTimers();
});
</script>
