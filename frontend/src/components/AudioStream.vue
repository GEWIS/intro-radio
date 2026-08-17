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
      class="py-6"
      color="primary"
      role="button"
      rounded="lg"
      tabindex="0"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <template #prepend>
        <v-icon :icon="isPlaying ? 'mdi-stop-circle-outline' : 'mdi-play-circle-outline'" size="56" />
      </template>

      <template #title>
        <h2 class="text-h4 font-weight-bold">
          {{ promptText }}
        </h2>
      </template>

      <template #subtitle>
        <div v-if="hasError" class="mt-2 text-error">
          {{ errorMessage }}
        </div>

        <div v-else-if="isPlaying" class="mt-2 d-flex align-center ga-2">
          <!-- Decorative, not a real spectrum analyzer -- confirms "audio is
               flowing" at a glance without wiring up Web Audio's
               AnalyserNode just for a visual. -->
          <span aria-hidden="true" class="audio-level">
            <span v-for="i in 4" :key="i" class="audio-level__bar" />
          </span>

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

      <template v-if="isPlaying && !isMobile" #append>
        <div class="d-flex align-center ga-2" style="width: 120px" @click.stop @keydown.enter.stop @keydown.space.stop>
          <v-icon size="small">{{ volume === 0 ? 'mdi-volume-mute' : 'mdi-volume-high' }}</v-icon>

          <v-slider
            v-model="volume"
            color="white"
            hide-details
            max="1"
            min="0"
            step="0.05"
            thumb-label
            track-color="white"
          />
        </div>
      </template>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { findMatchingSource, useIcecastLiveStatus } from '@/composables/useIcecastLiveStatus';
import { useIsMobile } from '@/composables/useIsMobile';

const props = defineProps<{
  baseUrl: string;
  mountPoint: string;
}>();

const emit = defineEmits<{
  (e: 'update:is-live', value: boolean): void;
  (e: 'update:now-playing', value: string | null): void;
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

const { isMobile } = useIsMobile();

const VOLUME_STORAGE_KEY = 'RADIO_VOLUME';
// Persisted across visits, same reasoning as useAdminGate's stored radio
// key -- a listener who turns the volume down once shouldn't have to redo
// it every time they open the page. Falls back to full volume rather than
// silence on a corrupt/out-of-range stored value.
function loadStoredVolume(): number {
  // Number(null) -- the no-value-stored-yet case -- is 0, which would pass
  // the range check below and start first-time visitors muted. Treat "no
  // usable string" as full volume before coercing.
  const stored = localStorage.getItem(VOLUME_STORAGE_KEY);
  if (stored === null || stored === '') return 1;
  const raw = Number(stored);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1;
}
// Mobile browsers (iOS most notably) ignore element.volume -- the hardware
// buttons are the only volume control -- so the slider is hidden there and
// volume stays pinned to full. The stored preference is neither read nor
// overwritten, keeping a later desktop visit's setting intact.
const volume = ref(isMobile.value ? 1 : loadStoredVolume());
watch(volume, (v) => {
  if (audio.value) audio.value.volume = v;
  localStorage.setItem(VOLUME_STORAGE_KEY, String(v));
});

// Lets the tab title (see useDocumentTitle.ts, wired up by Landing.vue) show
// the actual track instead of just "Live" -- fires on every change,
// including back to null once playback stops, without a separate emit call
// at each of currentlyPlaying's own mutation sites below.
watch(currentlyPlaying, (track) => emit('update:now-playing', track));

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
  audio.value.volume = volume.value;
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

<style scoped>
.audio-level {
  display: inline-flex;
  align-items: flex-end;
  gap: 3px;
  height: 18px;
}

/* Taller swing (5px-18px, up from 4px-14px) so the pulse actually reads at
   a glance instead of looking like a static row of dashes. */
.audio-level__bar {
  width: 4px;
  height: 5px;
  background: currentColor;
  border-radius: 1px;
  animation: audio-level-bounce 1s ease-in-out infinite;
}

.audio-level__bar:nth-child(1) {
  animation-delay: 0s;
}
.audio-level__bar:nth-child(2) {
  animation-delay: 0.2s;
}
.audio-level__bar:nth-child(3) {
  animation-delay: 0.4s;
}
.audio-level__bar:nth-child(4) {
  animation-delay: 0.1s;
}

@keyframes audio-level-bounce {
  0%,
  100% {
    height: 5px;
  }
  50% {
    height: 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .audio-level__bar {
    animation: none;
    height: 11px;
  }
}
</style>
