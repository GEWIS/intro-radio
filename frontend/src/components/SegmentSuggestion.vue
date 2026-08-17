<template>
  <v-card class="py-4 my-4 w-100" color="surface-variant" rounded="lg" variant="tonal">
    <div
      :aria-expanded="expanded"
      class="d-flex align-center justify-space-between px-4 py-3 cursor-pointer"
      role="button"
      tabindex="0"
      @click="toggle()"
      @keydown.enter.prevent="toggle()"
      @keydown.space.prevent="toggle()"
    >
      <div class="d-flex align-center">
        <v-icon class="mr-3" icon="mdi-bullhorn-outline" />

        <div>
          <div class="text-subtitle-1 font-weight-medium">Something for tomorrow's show?</div>
          <div class="text-body-2 text-medium-emphasis">Share a photo or voice memo, radio isn't live yet? No problem.</div>
        </div>
      </div>

      <v-icon :class="expanded ? 'rotate-180' : ''" icon="mdi-chevron-down" />
    </div>

    <v-expand-transition>
      <!-- v-if (not RequestSong's v-show) because a collapsed CSS-hidden block
           still leaves its text in wrapper.text() under Vue Test Utils --
           v-if actually removes it from the DOM, which is what the collapsed
           state's test asserts on. v-expand-transition still animates a v-if
           toggle the same way it animates v-show. -->
      <div v-if="expanded">
        <v-card-text>
          <v-btn-toggle v-model="kind" class="mb-4" color="primary" divided mandatory @click.stop>
            <v-btn value="photo">Photo</v-btn>
            <v-btn value="voice">Voice</v-btn>
          </v-btn-toggle>

          <div v-if="kind === 'photo'">
            <input ref="fileInput" accept="image/jpeg,image/png,image/webp" type="file" @change="onFileSelected" />
          </div>

          <div v-else>
            <div v-if="recordingState === 'idle'">
              <v-btn prepend-icon="mdi-microphone" variant="tonal" @click.stop="startRecording">Record</v-btn>
            </div>

            <div v-else-if="recordingState === 'recording'">
              <v-btn color="error" prepend-icon="mdi-stop" variant="tonal" @click.stop="stopRecording">Stop</v-btn>
            </div>

            <div v-else-if="recordingState === 'preview' && recordedUrl">
              <audio controls :src="recordedUrl" />
              <v-btn class="ml-2" variant="text" @click.stop="discardRecording">Re-record</v-btn>
            </div>
          </div>

          <v-textarea
            v-model="caption"
            class="mt-4"
            clearable
            label="Caption (optional)"
            rows="2"
            @click.stop
          />
        </v-card-text>

        <v-card-actions class="w-100 justify-end d-flex">
          <v-btn color="primary" :disabled="!canSend" :loading="sending" @click.stop="send">Send</v-btn>
        </v-card-actions>

        <v-alert v-if="sent" class="mx-4 mb-4" density="compact" type="success">Sent!</v-alert>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGewisAuth } from '@/composables/useGewisAuth';

const { getToken } = useGewisAuth();

const expanded = ref(false);
const kind = ref<'photo' | 'voice'>('photo');
const caption = ref('');
const sending = ref(false);
const sent = ref(false);

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);

const recordingState = ref<'idle' | 'recording' | 'preview'>('idle');
const recordedBlob = ref<Blob | null>(null);
const recordedUrl = ref<string | null>(null);
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];

function toggle() {
  expanded.value = !expanded.value;
}

function onFileSelected(e: Event) {
  selectedFile.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
    recordedBlob.value = blob;
    recordedUrl.value = URL.createObjectURL(blob);
    recordingState.value = 'preview';
    for (const t of stream.getTracks()) t.stop();
  };
  mediaRecorder.start();
  recordingState.value = 'recording';
}

function stopRecording() {
  mediaRecorder?.stop();
}

function discardRecording() {
  if (recordedUrl.value) URL.revokeObjectURL(recordedUrl.value);
  recordedBlob.value = null;
  recordedUrl.value = null;
  recordingState.value = 'idle';
}

const canSend = computed(() => {
  if (kind.value === 'photo') return selectedFile.value !== null;
  return recordedBlob.value !== null;
});

async function send() {
  const token = getToken();
  if (!token || !canSend.value) return;

  sending.value = true;
  try {
    const form = new FormData();
    form.append('token', token);
    form.append('purpose', 'segment_suggestion');
    form.append('kind', kind.value);
    if (caption.value.trim()) form.append('caption', caption.value.trim());

    if (kind.value === 'photo' && selectedFile.value) {
      form.append('file', selectedFile.value);
    } else if (kind.value === 'voice' && recordedBlob.value) {
      form.append('file', recordedBlob.value, 'voice-memo.webm');
    } else {
      return;
    }

    const res = await fetch('/api/v1/media', { method: 'POST', body: form });
    if (!res.ok) return;

    sent.value = true;
    selectedFile.value = null;
    if (fileInput.value) fileInput.value.value = '';
    discardRecording();
    caption.value = '';
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.rotate-180 {
  transform: rotate(180deg);
  transition: transform 150ms;
}

.expand-transition-enter-active,
.expand-transition-leave-active {
  transition-property: height, transform, opacity !important;
  transform-origin: top center;
}

.expand-transition-enter-from,
.expand-transition-leave-to {
  transform: scale(0.95);
  opacity: 0;
}
</style>
