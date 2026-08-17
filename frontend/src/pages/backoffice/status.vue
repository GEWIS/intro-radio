<template>
  <v-container class="py-8" fluid>
    <div class="mx-auto" style="max-width: 900px">
      <div class="mb-6 text-center">
        <h1 class="text-h4 font-weight-bold gloria-hallelujah-regular">Status</h1>
        <div class="text-body-2 text-medium-emphasis mt-2">System health at a glance</div>
      </div>

      <div class="d-flex justify-end mb-2 ga-4">
        <router-link to="/backoffice">Back to chat</router-link>
        <router-link to="/backoffice/agenda">Manage agenda</router-link>
        <router-link to="/backoffice/dashboard">Dashboard</router-link>
      </div>

      <AdminKeyGate v-if="gate.stage.value !== 'ready'" :gate="gate" />

      <v-alert v-else-if="loadError" class="mb-4" type="error">
        Could not load system status from the server.

        <div class="mt-3">
          <v-btn :disabled="loading" :loading="loading" variant="tonal" @click="load">Retry</v-btn>
        </div>
      </v-alert>

      <template v-else>
        <v-card class="pa-2 mb-4" color="surface-variant" rounded="lg" variant="tonal">
          <v-skeleton-loader v-if="loading" type="paragraph, list-item-three-line@2" />

          <template v-else-if="status">
            <v-card-title class="pa-2">Server</v-card-title>
            <v-divider />

            <div class="pa-2 d-flex flex-wrap ga-6">
              <div>
                <div class="text-caption text-medium-emphasis">Uptime</div>
                <div class="text-h6">{{ formatUptime(status.uptimeSeconds) }}</div>
              </div>

              <div>
                <!-- "Connected listeners" read as Icecast's audience count to
                     anyone comparing it against the real stream -- this is
                     actually just who's connected to our own chat, same
                     number as the dashboard's "Chatting now", so it gets the
                     same label rather than implying it's the same thing as
                     Icecast's listener count. -->
                <div class="text-caption text-medium-emphasis">Chatting now</div>
                <div class="text-h6">{{ status.chatListeners }}</div>
              </div>

              <div>
                <div class="text-caption text-medium-emphasis">Connected admins</div>
                <div class="text-h6">{{ status.chatAdmins }}</div>
              </div>

              <div>
                <div class="text-caption text-medium-emphasis mb-1">Icecast</div>

                <v-chip :color="status.icecastReachable ? 'success' : 'error'" size="small">
                  {{ status.icecastReachable ? 'Reachable' : 'Unreachable' }}
                </v-chip>
              </div>

              <div>
                <div class="text-caption text-medium-emphasis">Last metrics sample</div>

                <div class="text-body-1">
                  {{ status.lastMetricsSampleAt ? formatTimestamp(status.lastMetricsSampleAt) : 'none yet' }}
                </div>
              </div>
            </div>
          </template>
        </v-card>

        <v-card class="pa-2" color="surface-variant" rounded="lg" variant="tonal">
          <v-card-title class="pa-2">Recently validated (last hour)</v-card-title>
          <v-divider />

          <!-- Distinct from the dashboard's admin-presence chip (who's
               connected to chat right this second): this is "who could get
               in," derived from the same audit log the dashboard's full
               history uses, just narrowed to the last hour. -->
          <div class="pa-2">
            <div v-if="recentAccess.length === 0" class="text-body-2 text-medium-emphasis">
              No one has validated the radio key in the last hour.
            </div>

            <div v-else>
              <div v-for="(entry, i) in recentAccess" :key="i" class="my-1 d-flex">
                <div class="text-caption font-mono mr-2" style="width: 60px; text-align: right">
                  {{ formatTime(entry.timestamp) }}
                </div>

                <v-divider class="mx-3" style="align-self: stretch" :thickness="2" vertical />

                <div>{{ entry.given_name }} {{ entry.family_name }} (m{{ entry.lidnr }})</div>
              </div>
            </div>
          </div>
        </v-card>
      </template>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import AdminKeyGate from '@/components/AdminKeyGate.vue';
import { useAdminGate } from '@/composables/useAdminGate';

type SystemStatus = {
  uptimeSeconds: number;
  chatListeners: number;
  chatAdmins: number;
  lastMetricsSampleAt: string | null;
  icecastReachable: boolean;
};
type AuditEntry = { timestamp: string; lidnr: number; given_name: string; family_name: string };

// Refreshed far more often than the dashboard's own metrics/audit-log poll
// (5 minutes) -- this page exists specifically to answer "right now,"
// mirroring statusHandler's own live Icecast check on the backend.
const STATUS_REFRESH_MS = 15_000;
const RECENT_ACCESS_WINDOW_MS = 60 * 60_000;

const gate = useAdminGate();

const loading = ref(false);
const loadError = ref(false);
const status = ref<SystemStatus | null>(null);
const recentAccess = ref<AuditEntry[]>([]);

let refreshInterval: number | null = null;

function authBody() {
  return JSON.stringify({ token: gate.token.value, radioKey: gate.radioKey.value });
}

async function load() {
  loading.value = true;
  loadError.value = false;

  try {
    const headers = { 'Content-Type': 'application/json' };
    const body = authBody();

    const [statusRes, auditRes] = await Promise.all([
      fetch('/api/v1/status', { method: 'POST', headers, body }),
      fetch('/api/v1/audit-log', { method: 'POST', headers, body }),
    ]);

    if (!statusRes.ok || !auditRes.ok) {
      loadError.value = true;
      return;
    }

    status.value = await statusRes.json();
    const auditLog: AuditEntry[] = await auditRes.json();
    const cutoff = Date.now() - RECENT_ACCESS_WINDOW_MS;
    recentAccess.value = auditLog.filter((entry) => new Date(entry.timestamp).getTime() >= cutoff);
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(['nl-NL'])} ${d.toLocaleTimeString(['nl-NL'], { hour: '2-digit', minute: '2-digit' })}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(['nl-NL'], { hour: '2-digit', minute: '2-digit' });
}

function stopAutoRefresh() {
  if (refreshInterval !== null) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshInterval = setInterval(load, STATUS_REFRESH_MS);
}

onMounted(() => {
  gate.init();
});

// Same reasoning as dashboard.vue/agenda.vue: the gate can reach 'ready'
// either synchronously-ish out of init() or later once an admin types a
// key, so everything gated on being ready is kicked off from a watcher on
// the stage itself.
watch(gate.stage, (stage) => {
  if (stage !== 'ready') return;
  load();
  startAutoRefresh();
});

onUnmounted(stopAutoRefresh);
</script>
