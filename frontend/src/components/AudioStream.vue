<template>
  <div>
    <audio ref="audio" :src="nativeSupported ? streamUrl : undefined" style="display: none" />
    <v-card
      class="py-4"
      color="primary"
      :prepend-icon="isPlaying ? 'mdi-stop-circle-outline' : 'mdi-play-circle-outline'"
      rounded="lg"
      v-ripple
      @click="isPlaying ? stop() : play()"
    >
      <template #title>
        <h2 class="text-h5 font-weight-bold">
          {{ isPlaying ? 'Stop listening' : showLive ? 'Now live' : 'Click to start listening!' }}
        </h2>
      </template>
      <template #subtitle>
        <div v-if="isPlaying" class="mt-2">
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
import { ref, computed, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  baseUrl: string;
  mountPoint: string;
}>();

const streamUrl = computed(() => `${props.baseUrl.replace(/\/$/, '')}${props.mountPoint}`);
const statusUrl = computed(() => `${props.baseUrl.replace(/\/$/, '')}/status-json.xsl`);

const audio = ref<HTMLAudioElement | null>(null);
const isPlaying = ref(false);
const nativeSupported = true; // Assume browser can play AAC
const showLive = ref(false);
const currentlyPlaying = ref<string | null>(null);
const listeners = ref<number | null>(null);
const showListeners = ref(false);
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

function play() {
  if (!audio.value) return;
  audio.value.src = streamUrl.value;
  audio.value.play();
  isPlaying.value = true;
  fetchCurrentlyPlaying();
  statsInterval = setInterval(fetchCurrentlyPlaying, 15000);
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
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  if (switchInterval) {
    clearInterval(switchInterval);
    switchInterval = null;
  }
}

onMounted(() => {
  intervalId = setInterval(() => {
    if (!isPlaying.value) {
      showLive.value = !showLive.value;
    } else {
      showLive.value = false;
    }
  }, 1500);
});

onUnmounted(() => {
  if (intervalId !== null) clearInterval(intervalId);
  if (statsInterval !== null) clearInterval(statsInterval);
  if (switchInterval !== null) clearInterval(switchInterval);
});
</script>
