<template>
  <v-container class="py-8" fluid>
    <div class="mx-auto" style="max-width: 1400px">
      <div class="mb-6 text-center">
        <h1 class="text-h4 font-weight-bold gloria-hallelujah-regular">Backoffice</h1>
        <div class="text-body-2 text-medium-emphasis">Manage active chats</div>
      </div>

      <!-- Loading token -->
      <v-card v-if="stage === 'auth'" class="p-4" color="surface-variant" rounded="lg" variant="tonal">
        <v-skeleton-loader type="paragraph, actions" />
      </v-card>

      <!-- Ask for admin key -->
      <div v-else-if="stage === 'need-key'" class="d-flex flex-column align-center w-full">
        <v-card class="px-4 py-4 w-50" color="surface-variant" rounded="lg" variant="tonal">
          <div class="text-h6 mb-2">Admin login</div>
          <div class="text-body-2 mb-4">Enter your radio admin key</div>

          <form @submit.prevent="validateKey">
            <v-text-field
              v-model="keyInput"
              class="mb-3"
              :disabled="validating"
              :error="!!errorMsg"
              :error-messages="errorMsg"
              hide-details="auto"
              label="Admin key"
            />
            <div class="w-full d-flex justify-end">
              <v-btn color="primary" :loading="validating" type="submit">Continue</v-btn>
            </div>
          </form>
        </v-card>
      </div>

      <!-- Admin chat -->
      <AdminChat v-else-if="stage === 'ready'" :radio-key="radioKey!" :token="token!" />
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AdminChat from '@/components/AdminChat.vue';
import { useGewisAuth } from '@/composables/useGewisAuth';

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
// Opens a WS as radio, sends handshake, and resolves true if the server does not close it immediately.
function validateRadioKeyQuick(tok: string, key: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: number | null = null;

    const safeResolve = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      // close is handled in cleanup
      resolve(ok);
    };

    try {
      const ws = new WebSocket(`ws://${window.location.host}/ws?role=radio`);

      const handleOpen = () => {
        ws.send(JSON.stringify({ token: tok, radioKey: key }));
        // If it stays open briefly, assume valid
        timer = window.setTimeout(() => {
          cleanup();
          try {
            ws.close();
          } catch {}
          safeResolve(true);
        }, 200);
      };

      const handleClose = () => {
        cleanup();
        safeResolve(false);
      };

      const handleError = () => {
        cleanup();
        safeResolve(false);
      };

      const cleanup = () => {
        ws.removeEventListener('open', handleOpen);
        ws.removeEventListener('close', handleClose);
        ws.removeEventListener('error', handleError);
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      };

      ws.addEventListener('open', handleOpen);
      ws.addEventListener('close', handleClose);
      ws.addEventListener('error', handleError);
    } catch {
      safeResolve(false);
    }
  });
}
</script>
