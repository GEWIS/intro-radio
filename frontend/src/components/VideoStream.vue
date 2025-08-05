<template>
  <v-card class="pa-4 comic-outline" color="surface" rounded="lg">
    <div v-if="isMobile && !started" class="d-flex flex-column align-center py-8">
      <v-btn
        color="primary"
        prepend-icon="mdi-play-circle-outline"
        elevation="4"
        size="large"
        rounded="pill"
        class="mb-2"
        @click="startStream"
      >
        Start Video Stream
      </v-btn>
      <div class="text-caption text-secondary font-weight-medium">
        Video streaming may use significant data
      </div>
    </div>
    <video
      v-else
      ref="video"
      autoplay
      muted
      playsinline
      style="width: 100%; border-radius: 8px;"
      :poster="poster"
      title="Radio Livestream"
    />
  </v-card>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import Hls from 'hls.js'

const props = defineProps<{
  src: string
  poster?: string
}>()

const video = ref<HTMLVideoElement | null>(null)
const started = ref(false)

const isMobile = computed(() =>
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
)

function startStream() {
  started.value = true
  // Wait for next tick to ensure video element is rendered
  setTimeout(() => {
    setupStream()
  })
}

function setupStream() {
  if (video.value) {
    if (Hls.isSupported()) {
      const hls = new Hls()
      hls.loadSource(props.src)
      hls.attachMedia(video.value)
    } else if (video.value.canPlayType('application/vnd.apple.mpegurl')) {
      video.value.src = props.src
    }
    video.value.play().catch(() => {})
  }
}

onMounted(() => {
  if (!isMobile.value) {
    started.value = true
    setupStream()
  }
})
</script>
<style scoped>
.comic-outline {
  outline: 3px solid #111;
  outline-offset: -2px;
  border-radius: 8px;
  box-shadow: none;
}
</style>
