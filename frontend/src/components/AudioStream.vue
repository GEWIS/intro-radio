<template>
  <div>
    <audio
      ref="audio"
      :src="nativeSupported && isLive ? streamUrl : undefined"
      style="display: none"
      @error="handleStreamError"
    />

    <v-card
      v-ripple
      class="py-4"
      color="primary"
      :prepend-icon="isPlaying ? 'mdi-stop-circle-outline' : 'mdi-play-circle-outline'"
      role="button"
      rounded="lg"
      tabindex="0"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <template #title>
        <h2 class="text-h5 font-weight-bold">
          {{ promptText }}
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
import { computed, onUnmounted, ref, toRef, watch } from 'vue';
import { findMatchingSource, useIcecastLiveStatus } from '@/composables/useIcecastLiveStatus';

const props = defineProps<{
  baseUrl: string;
  mountPoint: string;
}>();

const emit = defineEmits<{
  (e: 'update:is-live', value: boolean): void;
}>();

const { isLive, normalizedBaseUrl, statusUrl } = useIcecastLiveStatus(toRef(props, 'baseUrl'), toRef(props, 'mountPoint'));
const streamUrl = computed(() => `${normalizedBaseUrl.value}${props.mountPoint}`);

// Gating this on isLive too (not just nativeSupported) matters: setting src at
// all makes the browser start loading it immediately, and a dead mount point
// 404s -- firing the same error handler play() itself uses. Without the gate,
// a genuinely offline radio showed both the offline message and "something
// went wrong", which looked like a second, unrelated failure.
const audio = ref<HTMLAudioElement | null>(null);
const isPlaying = ref(false);
const nativeSupported = true; // Assume browser can play AAC
const currentlyPlaying = ref<string | null>(null);
const listeners = ref<number | null>(null);
const showListeners = ref(false);
const hasError = ref(false);
const errorMessage = ref<string | null>(null);
let statsInterval: number | null = null;
let switchInterval: number | null = null;

const promptText = computed(() => {
  if (isPlaying.value) return 'Stop listening';
  if (!isLive.value) return 'Radio is currently offline';
  return 'Click to start listening!';
});

async function fetchCurrentlyPlaying() {
  try {
    const res = await fetch(statusUrl.value);
    const data = await res.json();
    const source = findMatchingSource(data, props.mountPoint);
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
  if (!audio.value || !isLive.value) return;
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

function toggle() {
  if (isPlaying.value) {
    stop();
  } else {
    play();
  }
}

watch(isLive, (value) => emit('update:is-live', value), { immediate: true });

onUnmounted(clearPlaybackTimers);
</script>
