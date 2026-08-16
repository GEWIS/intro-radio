<template>
  <v-container class="py-8" fluid>
    <div class="mx-auto" style="max-width: 1400px">
      <div class="mb-6 text-center">
        <h1 class="text-h4 font-weight-bold gloria-hallelujah-regular">Dashboard</h1>
        <div class="text-body-2 text-medium-emphasis mt-2">Listener metrics and staff activity</div>
      </div>

      <div class="d-flex justify-end mb-2 ga-4">
        <router-link to="/backoffice">Back to chat</router-link>
        <router-link to="/backoffice/agenda">Manage agenda</router-link>
      </div>

      <AdminKeyGate v-if="gate.stage.value !== 'ready'" :gate="gate" />

      <v-alert v-else-if="loadError" class="mb-4" type="error">
        Could not load the dashboard data from the server.

        <div class="mt-3">
          <v-btn :disabled="loading" :loading="loading" variant="tonal" @click="load">Retry</v-btn>
        </div>
      </v-alert>

      <template v-else>
        <!-- Right-now status: audio/video health and live counts. Independent
        of the Metrics card below (which is historical and skeleton-gated) --
        these have their own quieter loading state so a slow initial metrics
        fetch doesn't hold up what's otherwise available immediately. -->
        <v-card class="pa-2 mb-4" color="surface-variant" rounded="lg" variant="tonal">
          <div class="pa-2 d-flex flex-wrap align-center ga-6">
            <div class="d-flex flex-column ga-1">
              <v-chip :color="audioLive ? 'success' : 'error'" prepend-icon="mdi-radio-tower" variant="flat">
                Audio: {{ audioLive ? 'Live' : 'Offline' }}
              </v-chip>

              <HealthHistoryStrip :history="audioHealthHistory" />
            </div>

            <div class="d-flex flex-column ga-1">
              <v-chip :color="videoHealthy ? 'success' : 'error'" prepend-icon="mdi-video" variant="flat">
                Video: {{ videoHealthy ? 'Live' : 'Stalled' }}
              </v-chip>

              <HealthHistoryStrip :history="videoHealthHistory" />
            </div>

            <div>
              <div class="text-caption text-medium-emphasis">Listening now</div>
              <div class="text-h5">{{ liveStatus?.listeners ?? '—' }}</div>
            </div>

            <div>
              <div class="text-caption text-medium-emphasis">Chatting now</div>
              <div class="text-h5">{{ liveStatus?.chatters ?? '—' }}</div>
            </div>

            <div v-if="currentSegment">
              <div class="text-caption text-medium-emphasis">Currently scheduled</div>
              <div class="text-h6">{{ currentSegment.title }}</div>
            </div>

            <router-link v-if="chatStore.totalUnread > 0" class="text-error font-weight-bold" to="/backoffice">
              {{ chatStore.totalUnread }} unread {{ chatStore.totalUnread === 1 ? 'conversation' : 'conversations' }}
            </router-link>
          </div>
        </v-card>

        <v-card class="pa-2" color="surface-variant" rounded="lg" variant="tonal">
          <!-- First load: keep the skeleton inside the same card frame rather
               than swapping cards in and out once data arrives. -->
          <v-skeleton-loader v-if="loading" type="paragraph, image, list-item-three-line@4" />

          <template v-else>
            <v-card-title class="pa-2 d-flex flex-wrap align-center justify-space-between ga-2">
              <span>Metrics</span>

              <!-- Both the chart below and the audit log further down filter to
                   this same day -- there is no separate per-section picker,
                   since they're always looking at the same slice of history. -->
              <v-select
                v-if="availableDays.length > 0"
                v-model="selectedDay"
                density="compact"
                hide-details
                :items="dayOptions"
                style="max-width: 220px"
                variant="outlined"
              />
            </v-card-title>

            <v-divider />

            <div class="pa-2">
              <div v-if="filteredMetrics.length === 0" class="text-body-2 text-medium-emphasis">
                No metrics recorded {{ selectedDay ? 'for this day.' : 'yet.' }}
              </div>

              <div v-else class="d-flex flex-column ga-4">
                <div v-for="series in metricSeries" :key="series.label">
                  <div class="text-caption text-medium-emphasis mb-1 d-flex justify-space-between">
                    <span>{{ series.label }}</span>
                    <span v-if="series.peak">Peak: {{ series.peak.value }} ({{ formatTimestamp(series.peak.timestamp) }})</span>
                  </div>

                  <!-- The axis-label column and the tick-label spacer below it
                       share the same fixed width so the tick row -- shared by
                       both series, since they plot the same timestamps -- lines
                       up with the sparkline's own horizontal extent. VSparkline
                       has no built-in axis, so this is a hand-rolled min/max
                       readout rather than real gridlines. -->
                  <div class="d-flex align-center ga-3">
                    <div
                      class="d-flex flex-column justify-space-between text-caption text-medium-emphasis"
                      style="width: 32px; height: 60px; text-align: right"
                    >
                      <span>{{ series.max }}</span>
                      <span>{{ series.min }}</span>
                    </div>

                    <VSparkline
                      class="flex-grow-1"
                      :color="series.color"
                      height="60"
                      line-width="2"
                      :model-value="series.values"
                      padding="8"
                      smooth
                    />
                  </div>
                </div>

                <div class="d-flex ga-3">
                  <div style="width: 32px"></div>

                  <div class="flex-grow-1 d-flex justify-space-between text-caption text-medium-emphasis">
                    <span v-for="(tick, i) in metricTicks" :key="i">{{ tick }}</span>
                  </div>
                </div>
              </div>
            </div>

            <v-divider class="my-2" />

            <v-card-title class="pa-2">Audit log</v-card-title>
            <v-divider />

            <div class="pa-2">
              <div v-if="filteredAuditGroups.length === 0" class="text-body-2 text-medium-emphasis">
                No audit log entries {{ selectedDay ? 'for this day.' : 'yet.' }}
              </div>

              <div v-else class="overflow-y-auto" style="max-height: 40vh">
                <template v-for="(group, groupIdx) in filteredAuditGroups" :key="group.day">
                  <div v-if="groupIdx > 0" class="my-3">
                    <v-divider />
                  </div>

                  <div class="text-caption font-weight-bold mb-1 d-flex justify-space-between">
                    <span>{{ formatDay(group.day) }}</span>

                    <span class="text-medium-emphasis font-weight-regular">
                      {{ group.uniqueStaff }} {{ group.uniqueStaff === 1 ? 'staff member' : 'staff members' }}
                    </span>
                  </div>

                  <div v-for="(entry, i) in group.entries" :key="i" class="my-1 d-flex">
                    <!-- Fixed-width timestamp column, same layout AdminChat.vue uses
                         for its message rows -- but wider, since these timestamps
                         carry a date too (this log can span multiple days, unlike
                         the always-today live chat). -->
                    <div class="text-caption font-mono mr-2" style="width: 110px; text-align: right">
                      {{ formatTimestamp(entry.timestamp) }}
                    </div>

                    <v-divider class="mx-3" style="align-self: stretch" :thickness="2" vertical />

                    <div class="flex-grow-1">
                      <router-link :to="`/backoffice?user=${entry.lidnr}`">
                        <strong>{{ entry.given_name }} {{ entry.family_name }}</strong>
                        <span class="text-medium-emphasis ml-1">(m{{ entry.lidnr }})</span>
                      </router-link>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </v-card>
      </template>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import AdminKeyGate from '@/components/AdminKeyGate.vue';
import HealthHistoryStrip from '@/components/HealthHistoryStrip.vue';
import { useAdminGate } from '@/composables/useAdminGate';
import { currentAgendaEvent } from '@/composables/useAgendaTiming';
import { useHealthHistory } from '@/composables/useHealthHistory';
import { useIcecastLiveStatus } from '@/composables/useIcecastLiveStatus';
import { useVideoHealth } from '@/composables/useVideoHealth';
import { useAppStore } from '@/stores/app';
import { useChatStore } from '@/stores/chat';

type MetricPoint = { timestamp: string; listeners: number; chatters: number };
type AuditEntry = { timestamp: string; lidnr: number; given_name: string; family_name: string };
type LiveStatus = { listeners: number | null; chatters: number };

// Refreshing metrics/the audit log faster than this would just refetch the
// same data -- the backend only samples every 5 minutes (see
// backend/metrics.go's metricsSampleInterval).
const METRICS_REFRESH_MS = 5 * 60_000;
// Live status (and the "now" used for the current-segment indicator) is
// worth refreshing much more often, since unlike the sampled history it
// reflects the current instant, not a stored point.
const LIVE_REFRESH_MS = 15_000;
// Number of tick labels shown under the charts -- shared by both series
// since they're sampled at the same timestamps, so there's no need to
// duplicate the row under each sparkline.
const TICK_COUNT = 5;

const gate = useAdminGate();
const { radio, agenda } = storeToRefs(useAppStore());
const chatStore = useChatStore();

const loading = ref(false);
const loadError = ref(false);
const metrics = ref<MetricPoint[]>([]);
const auditLog = ref<AuditEntry[]>([]);
const liveStatus = ref<LiveStatus | null>(null);
const now = ref(new Date());

let metricsInterval: number | null = null;
let liveInterval: number | null = null;

// null means "all days" -- the default, unfiltered view. Picking a specific
// "YYYY-MM-DD" narrows both the chart below and the audit log further down
// to that one day, for looking back at a past broadcast day rather than
// only ever seeing the live, all-history view.
const selectedDay = ref<string | null>(null);

const availableDays = computed(() => {
  const days = new Set<string>();
  for (const m of metrics.value) days.add(m.timestamp.slice(0, 10));
  for (const entry of auditLog.value) days.add(entry.timestamp.slice(0, 10));
  return Array.from(days).toSorted().toReversed(); // newest first
});

const dayOptions = computed(() => [
  { title: 'All days', value: null },
  ...availableDays.value.map((day) => ({ title: formatDay(day), value: day })),
]);

const filteredMetrics = computed(() => {
  if (!selectedDay.value) return metrics.value;
  return metrics.value.filter((m) => m.timestamp.slice(0, 10) === selectedDay.value);
});

function peakOf(points: MetricPoint[], key: 'listeners' | 'chatters') {
  if (points.length === 0) return null;
  const peak = points.reduce((max, m) => (m[key] > max[key] ? m : max));
  return { value: peak[key], timestamp: peak.timestamp };
}

function buildSeries(label: string, color: string, points: MetricPoint[], key: 'listeners' | 'chatters') {
  const values = points.map((m) => m[key]);
  return {
    label,
    color,
    values,
    max: values.length > 0 ? Math.max(...values) : 0,
    min: values.length > 0 ? Math.min(...values) : 0,
    peak: peakOf(points, key),
  };
}

const metricSeries = computed(() => [
  buildSeries('Listeners', 'primary', filteredMetrics.value, 'listeners'),
  buildSeries('Chatters', 'accent', filteredMetrics.value, 'chatters'),
]);

// Evenly spaced-by-index tick labels rather than time-scaled ones --
// VSparkline plots values evenly by array index (not by elapsed time), and a
// sample can be missing entirely when an Icecast poll failed (see
// metrics.go's sampleOnce), so the samples aren't reliably evenly spaced in
// time either. Index-even ticks are honest about that rather than implying
// a precision the data doesn't have.
const metricTicks = computed(() => {
  const points = filteredMetrics.value;
  const n = points.length;
  if (n === 0) return [];

  const sameDay = new Date(points[0].timestamp).toDateString() === new Date(points[n - 1].timestamp).toDateString();

  const count = Math.min(TICK_COUNT, n);
  const indices = count === 1 ? [0] : Array.from({ length: count }, (_, i) => Math.round((i * (n - 1)) / (count - 1)));

  return [...new Set(indices)].map((i) => formatTick(points[i].timestamp, sameDay));
});

function formatTick(iso: string, timeOnly: boolean) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(['nl-NL'], { hour: '2-digit', minute: '2-digit' });
  return timeOnly ? time : `${d.toLocaleDateString(['nl-NL'])} ${time}`;
}

const currentSegment = computed(() => currentAgendaEvent(agenda.value, now.value));

type AuditGroup = { day: string; entries: AuditEntry[]; uniqueStaff: number };

// auditLog is already newest-first (see backend/audit.go's AuditLog.List),
// so grouping by day while preserving encounter order naturally keeps the
// most recent day first too -- Map iteration order follows insertion order.
const groupedAuditLog = computed<AuditGroup[]>(() => {
  const groups = new Map<string, AuditEntry[]>();
  for (const entry of auditLog.value) {
    const day = entry.timestamp.slice(0, 10); // the "YYYY-MM-DD" prefix of the ISO timestamp
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(entry);
  }
  return Array.from(groups.entries()).map(([day, entries]) => ({
    day,
    entries,
    uniqueStaff: new Set(entries.map((e) => e.lidnr)).size,
  }));
});

const filteredAuditGroups = computed(() => {
  if (!selectedDay.value) return groupedAuditLog.value;
  return groupedAuditLog.value.filter((g) => g.day === selectedDay.value);
});

function formatDay(day: string) {
  return new Date(day).toLocaleDateString(['nl-NL'], { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(['nl-NL'])} ${d.toLocaleTimeString(['nl-NL'], { hour: '2-digit', minute: '2-digit' })}`;
}

function authBody() {
  return JSON.stringify({ token: gate.token.value, radioKey: gate.radioKey.value });
}

async function load() {
  loading.value = true;
  loadError.value = false;

  try {
    const headers = { 'Content-Type': 'application/json' };
    const body = authBody();

    // Both endpoints take the same auth body and are independent of each
    // other, so fetch them together rather than round-tripping twice.
    const [metricsRes, auditRes] = await Promise.all([
      fetch('/api/v1/metrics', { method: 'POST', headers, body }),
      fetch('/api/v1/audit-log', { method: 'POST', headers, body }),
    ]);

    // This is a read-only view, so unlike agenda.vue there's no saved state
    // that a bad response could clobber -- any non-ok response (401
    // included) just falls back to the retry alert instead of the card,
    // rather than rendering a chart/log that quietly looks merely empty.
    if (!metricsRes.ok || !auditRes.ok) {
      loadError.value = true;
      return;
    }

    metrics.value = await metricsRes.json();
    auditLog.value = await auditRes.json();
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

async function loadLiveStatus() {
  try {
    const res = await fetch('/api/v1/live-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: authBody(),
    });
    if (!res.ok) return;
    liveStatus.value = await res.json();
  } catch {
    // A failed refresh just leaves the last-known value on screen -- this is
    // a nice-to-have readout, not something the rest of the page should
    // block or error out on.
  }
}

function stopAutoRefresh() {
  if (metricsInterval !== null) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
  if (liveInterval !== null) {
    clearInterval(liveInterval);
    liveInterval = null;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  metricsInterval = setInterval(load, METRICS_REFRESH_MS);
  liveInterval = setInterval(() => {
    loadLiveStatus();
    now.value = new Date();
  }, LIVE_REFRESH_MS);
}

// Audio/video health rows -- reuse the exact same detection AudioStream.vue
// and VideoStream.vue use for the public page, so "is it actually live"
// means the same thing here as it does to a listener.
const audioBaseUrl = computed(() => radio.value.audioUrl);
const audioMountPoint = computed(() => radio.value.audioMountPoint);
const videoUrl = computed(() => radio.value.videoUrl);

const { isLive: audioLive } = useIcecastLiveStatus(audioBaseUrl, audioMountPoint);
const { healthy: videoHealthy, start: startVideoHealthCheck } = useVideoHealth(videoUrl);

// Uptime strips shown next to each health chip -- audioLive/videoHealthy
// only ever tell you the current instant, so these fill in the last hour's
// worth of that same signal for "was this actually stable, or just happens
// to be up right now."
const { history: audioHealthHistory, start: startAudioHealthHistory } = useHealthHistory(audioLive);
const { history: videoHealthHistory, start: startVideoHealthHistory } = useHealthHistory(videoHealthy);

watch(
  videoUrl,
  (url) => {
    if (url) startVideoHealthCheck();
  },
  { immediate: true },
);

onMounted(() => {
  gate.init();
});

// The gate can reach 'ready' either synchronously-ish out of init() (a
// stored key was already valid) or much later, once the admin types a key
// into AdminKeyGate and submitKey() resolves it -- so everything gated on
// being ready is kicked off from a watcher on the stage itself, rather than
// chained after init().
watch(gate.stage, (stage) => {
  if (stage !== 'ready') return;
  load();
  loadLiveStatus();
  startAutoRefresh();
  startAudioHealthHistory();
  startVideoHealthHistory();
  // Same persistent connection AdminChat.vue uses -- opening it here too
  // means unread counts (once surfaced) keep tracking accurately even if
  // staff spend most of their time on this page instead of the chat one.
  chatStore.ensureConnected(gate.radioKey.value!);
});

onUnmounted(stopAutoRefresh);
</script>
