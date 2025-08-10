<template>
  <v-container fluid class="py-8">
    <div class="mx-auto" style="max-width: 1400px">
      <div class="mb-6 text-center">
        <h1 class="text-h4 font-weight-bold gloria-hallelujah-regular">Backoffice</h1>
        <div class="text-body-2 text-medium-emphasis">Manage active chats</div>
      </div>

      <!-- Loading token -->
      <v-card v-if="stage === 'auth'" class="p-4" color="surface-variant" variant="tonal" rounded="lg">
        <v-skeleton-loader type="paragraph, actions" />
      </v-card>

      <!-- Ask for admin key -->
      <div class="d-flex flex-column align-center w-full" v-else-if="stage === 'need-key'">
        <v-card class="px-4 py-4 w-50" color="surface-variant" variant="tonal" rounded="lg">
          <div class="text-h6 mb-2">Admin login</div>
          <div class="text-body-2 mb-4">Enter your radio admin key</div>

          <v-text-field
            v-model="keyInput"
            label="Admin key"
            :disabled="validating"
            :error="!!errorMsg"
            :error-messages="errorMsg"
            hide-details="auto"
            class="mb-3"
            @submit="validateKey"
          />
          <div class="w-full d-flex justify-end">
          <v-btn :loading="validating" color="primary" @click="validateKey">Continue</v-btn>
          </div>
        </v-card>
      </div>

      <!-- Admin chat -->
      <AdminChat v-else-if="stage === 'ready'" :token="token!" :radio-key="radioKey!" />
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useGewisAuth } from '@/composables/useGewisAuth';
import AdminChat from '@/components/AdminChat.vue';

type Stage = 'auth' | 'need-key' | 'ready';

const stage = ref<Stage>('auth');
const token = ref<string | null>(null);
const radioKey = ref<string | null>(null);
const keyInput = ref('');
const validating = ref(false);
const errorMsg = ref('');

const { ensureToken } = useGewisAuth();

onMounted(async () => {
  token.value = await ensureToken();
  // 2) check for existing key in localStorage or URL
  const fromQuery = new URLSearchParams(window.location.search).get('key');
  const fromStore = localStorage.getItem('RADIO_ADMIN_KEY');
  radioKey.value = fromQuery || fromStore || null;

  if (!radioKey.value) {
    stage.value = 'need-key';
    return;
  }

  // 3) key present, validate quickly
  const ok = await validateRadioKeyQuick(token.value, radioKey.value);
  if (ok) {
    localStorage.setItem('RADIO_ADMIN_KEY', radioKey.value);
    stage.value = 'ready';
  } else {
    stage.value = 'need-key';
    errorMsg.value = 'Something went wrong. Try again.';
  }
});

async function validateKey() {
  errorMsg.value = '';
  validating.value = true;
  const ok = await validateRadioKeyQuick(token.value!, keyInput.value.trim());
  validating.value = false;

  if (ok) {
    radioKey.value = keyInput.value.trim();
    localStorage.setItem('RADIO_ADMIN_KEY', radioKey.value);
    stage.value = 'ready';
  } else {
    errorMsg.value = 'Invalid key or connection failed. Try again.';
  }
}

// Opens a WS as radio, sends handshake, and resolves true if the server does not close it immediately.
function validateRadioKeyQuick(tok: string, key: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(`ws://${window.location.host}/ws?role=radio`);
      let closed = false;
      let opened = false;

      const cleanup = () => {
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
      };

      ws.onopen = () => {
        opened = true;
        ws.send(JSON.stringify({ token: tok, radioKey: key }));
        // If it stays open for a short moment, assume valid
        setTimeout(() => {
          if (!closed) {
            cleanup();
            try {
              ws.close();
            } catch {}
            resolve(true);
          }
        }, 200);
      };

      ws.onclose = () => {
        closed = true;
        cleanup();
        resolve(false);
      };

      ws.onerror = () => {
        closed = true;
        cleanup();
        resolve(false);
      };
    } catch {
      resolve(false);
    }
  });
}
</script>
