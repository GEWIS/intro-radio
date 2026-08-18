<template>
  <v-container class="py-8" fluid>
    <div class="mx-auto" style="max-width: 1000px">
      <div class="mb-6 text-center">
        <h1 class="text-h4 font-weight-bold gloria-hallelujah-regular">Media</h1>
        <div class="text-body-2 text-medium-emphasis mt-2">Segment suggestions from listeners</div>
      </div>

      <div class="d-flex justify-end mb-2 ga-4">
        <router-link to="/backoffice">Back to chat</router-link>
        <router-link to="/backoffice/agenda">Manage agenda</router-link>
        <router-link to="/backoffice/dashboard">Dashboard</router-link>
        <router-link to="/backoffice/status">Status</router-link>
      </div>

      <AdminKeyGate v-if="gate.stage.value !== 'ready'" :gate="gate" />

      <v-alert v-else-if="loadError" class="mb-4" type="error">
        Could not load media from the server.
        <div class="mt-3">
          <v-btn :disabled="loading" :loading="loading" variant="tonal" @click="load">Retry</v-btn>
        </div>
      </v-alert>

      <v-card v-else class="pa-2" color="surface-variant" rounded="lg" variant="tonal">
        <v-skeleton-loader v-if="loading" type="paragraph, image, list-item-three-line@4" />

        <template v-else>
          <v-card-title class="pa-2 d-flex flex-wrap align-center justify-space-between ga-2">
            <span>Submissions</span>

            <div class="d-flex align-center ga-2">
              <v-select
                v-if="availableDays.length > 0"
                v-model="selectedDay"
                density="compact"
                hide-details
                :items="dayOptions"
                style="max-width: 220px"
                variant="outlined"
              />

              <v-btn v-if="visibleItems.length > 0" color="error" size="small" variant="tonal" @click="confirmWipe = true">
                Wipe
              </v-btn>
            </div>
          </v-card-title>

          <v-divider />

          <div class="pa-2">
            <div v-if="visibleItems.length === 0" class="text-body-2 text-medium-emphasis">
              No submissions {{ selectedDay ? 'for this day.' : 'yet.' }}
            </div>

            <div v-else class="d-flex flex-column ga-4">
              <div v-for="item in visibleItems" :key="item.id" class="d-flex align-start ga-3">
                <img
                  v-if="item.kind === 'photo' && mediaUrls[item.id]"
                  alt="Submission"
                  :src="mediaUrls[item.id]"
                  style="max-width: 120px; max-height: 120px; border-radius: 4px"
                />

                <video
                  v-else-if="item.kind === 'video' && mediaUrls[item.id]"
                  controls
                  :src="mediaUrls[item.id]"
                  style="max-width: 200px; max-height: 160px"
                />

                <audio v-else-if="item.kind === 'voice' && mediaUrls[item.id]" controls :src="mediaUrls[item.id]" />
                <div v-else class="text-medium-emphasis">Loading...</div>

                <div class="flex-grow-1">
                  <div>
                    <strong>{{ item.senderGivenName }} {{ item.senderFamilyName }}</strong>
                    <span class="text-medium-emphasis ml-1">(m{{ item.senderLidnr }})</span>
                    <span class="text-caption text-medium-emphasis ml-2">{{ formatTimestamp(item.createdAt) }}</span>
                  </div>

                  <div v-if="item.caption" class="text-body-2 mt-1">{{ item.caption }}</div>
                </div>

                <div class="d-flex ga-1">
                  <v-btn aria-label="Download" icon="mdi-download" size="small" variant="text" @click="download(item)" />
                  <v-btn aria-label="Delete" icon="mdi-delete" size="small" variant="text" @click="deleteOne(item.id)" />
                </div>
              </div>
            </div>
          </div>
        </template>
      </v-card>

      <v-dialog v-model="confirmWipe" max-width="400">
        <v-card>
          <v-card-title>Wipe {{ visibleItems.length }} {{ visibleItems.length === 1 ? 'item' : 'items' }}?</v-card-title>
          <v-card-text>This can't be undone. Download anything you want to keep first.</v-card-text>

          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="confirmWipe = false">Cancel</v-btn>
            <v-btn color="error" @click="wipe">Wipe</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AdminKeyGate from '@/components/AdminKeyGate.vue';
import { useAdminGate } from '@/composables/useAdminGate';
import { useChatStore } from '@/stores/chat';

type MediaItem = {
  id: string;
  purpose: string;
  kind: 'photo' | 'voice' | 'video';
  senderLidnr: number;
  senderGivenName: string;
  senderFamilyName: string;
  caption?: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

const gate = useAdminGate();
const chatStore = useChatStore();

const loading = ref(false);
const loadError = ref(false);
const items = ref<MediaItem[]>([]);
const mediaUrls = ref<Record<string, string>>({});
const confirmWipe = ref(false);

// null means "all days" -- same convention as dashboard.vue's own
// selectedDay, deliberately mirrored rather than reinvented.
const selectedDay = ref<string | null>(null);

const availableDays = computed(() => {
  const days = new Set<string>();
  for (const item of items.value) days.add(item.createdAt.slice(0, 10));
  return Array.from(days).toSorted().toReversed();
});

const dayOptions = computed(() => [
  { title: 'All days', value: null },
  ...availableDays.value.map((day) => ({ title: formatDay(day), value: day })),
]);

const visibleItems = computed(() => {
  if (!selectedDay.value) return items.value;
  return items.value.filter((item) => item.createdAt.slice(0, 10) === selectedDay.value);
});

function formatDay(day: string) {
  return new Date(day).toLocaleDateString(['nl-NL'], { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(['nl-NL'])} ${d.toLocaleTimeString(['nl-NL'], { hour: '2-digit', minute: '2-digit' })}`;
}

function authBody(extra: Record<string, unknown> = {}) {
  return JSON.stringify({ token: gate.token.value, radioKey: gate.radioKey.value, ...extra });
}

async function fetchMediaUrl(item: MediaItem) {
  if (mediaUrls.value[item.id]) return;
  try {
    const res = await fetch('/api/v1/media/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: authBody({ id: item.id }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    mediaUrls.value = { ...mediaUrls.value, [item.id]: URL.createObjectURL(blob) };
  } catch {
    // Leaves "Loading..." on screen; the next load() retries.
  }
}

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    const res = await fetch('/api/v1/media/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: authBody(),
    });
    if (!res.ok) {
      loadError.value = true;
      return;
    }
    items.value = await res.json();
    for (const item of items.value) fetchMediaUrl(item);
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

async function download(item: MediaItem) {
  const url = mediaUrls.value[item.id];
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${item.kind}-${item.id}`;
  a.click();
}

async function deleteOne(id: string) {
  await fetch('/api/v1/media/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: authBody({ id }),
  });
  await load();
}

async function wipe() {
  confirmWipe.value = false;
  const ids = visibleItems.value.map((item) => item.id);
  if (ids.length === 0) return;
  await fetch('/api/v1/media/wipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: authBody({ ids }),
  });
  await load();
}

onMounted(() => {
  gate.init();
});

watch(gate.stage, (stage) => {
  if (stage !== 'ready') return;
  load();
  chatStore.ensureConnected(gate.radioKey.value!);
});

// Refetch whenever a segment_suggestion notification arrives over the
// existing WebSocket, rather than polling -- see stores/chat.ts's
// mediaEvent (Task 5 of this plan).
watch(
  () => chatStore.mediaEvent,
  (event) => {
    if (event) load();
  },
);
</script>
