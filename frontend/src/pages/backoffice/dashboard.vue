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

      <v-card v-else class="p-2" color="surface-variant" rounded="lg" variant="tonal">
        <!-- First load: keep the skeleton inside the same card frame rather
             than swapping cards in and out once data arrives. -->
        <v-skeleton-loader v-if="loading" type="paragraph, image, list-item-three-line@4" />

        <template v-else>
          <v-card-title class="p-2">Metrics</v-card-title>
          <v-divider />

          <div class="p-2">
            <div v-if="metrics.length === 0" class="text-body-2 text-medium-emphasis">No metrics recorded yet.</div>

            <div v-else class="d-flex flex-column ga-4">
              <div v-for="series in metricSeries" :key="series.label">
                <div class="text-caption text-medium-emphasis mb-1">{{ series.label }}</div>

                <VSparkline
                  :color="series.color"
                  height="60"
                  line-width="2"
                  :model-value="series.values"
                  padding="8"
                  smooth
                />

                <div class="text-caption text-medium-emphasis mt-1 d-flex justify-space-between">
                  <span>{{ formatTimestamp(metrics[0].timestamp) }}</span>
                  <span>{{ formatTimestamp(metrics[metrics.length - 1].timestamp) }}</span>
                </div>
              </div>
            </div>
          </div>

          <v-divider class="my-2" />

          <v-card-title class="p-2">Audit log</v-card-title>
          <v-divider />

          <div class="p-2">
            <div v-if="auditLog.length === 0" class="text-body-2 text-medium-emphasis">No audit log entries yet.</div>

            <div v-else class="overflow-y-auto" style="max-height: 40vh">
              <div v-for="(entry, i) in auditLog" :key="i" class="my-1 d-flex">
                <!-- Fixed-width timestamp column, same layout AdminChat.vue uses
                     for its message rows -- but wider, since these timestamps
                     carry a date too (this log can span multiple days, unlike
                     the always-today live chat). -->
                <div class="text-caption font-mono mr-2" style="width: 110px; text-align: right">
                  {{ formatTimestamp(entry.timestamp) }}
                </div>

                <v-divider class="mx-3" style="align-self: stretch" :thickness="2" vertical />

                <div class="flex-grow-1">
                  <strong>{{ entry.given_name }} {{ entry.family_name }}</strong>
                  <span class="text-medium-emphasis ml-1">(m{{ entry.lidnr }})</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </v-card>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AdminKeyGate from '@/components/AdminKeyGate.vue';
import { useAdminGate } from '@/composables/useAdminGate';

type MetricPoint = { timestamp: string; listeners: number; chatters: number };
type AuditEntry = { timestamp: string; lidnr: number; given_name: string; family_name: string };

const gate = useAdminGate();

const loading = ref(false);
const loadError = ref(false);
const metrics = ref<MetricPoint[]>([]);
const auditLog = ref<AuditEntry[]>([]);

const metricSeries = computed(() => [
  { label: 'Listeners', color: 'primary', values: metrics.value.map((m) => m.listeners) },
  { label: 'Chatters', color: 'accent', values: metrics.value.map((m) => m.chatters) },
]);

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(['nl-NL'])} ${d.toLocaleTimeString(['nl-NL'], { hour: '2-digit', minute: '2-digit' })}`;
}

async function load() {
  loading.value = true;
  loadError.value = false;

  try {
    const body = JSON.stringify({ token: gate.token.value, radioKey: gate.radioKey.value });
    const headers = { 'Content-Type': 'application/json' };

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

onMounted(() => {
  gate.init();
});

// The gate can reach 'ready' either synchronously-ish out of init() (a
// stored key was already valid) or much later, once the admin types a key
// into AdminKeyGate and submitKey() resolves it -- so the fetch is kicked
// off from a watcher on the stage itself, rather than chained after init().
watch(gate.stage, (stage) => {
  if (stage === 'ready') load();
});
</script>
