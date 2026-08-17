<template>
  <v-card class="pa-4" color="surface-variant" rounded="lg" variant="tonal">
    <div ref="chatBox" style="height: 300px; overflow-y: auto">
      <template v-if="!isClosed">
        <div v-for="(msg, index) in messages" :key="index">
          <strong>{{ msg.from === 'radio' ? 'Radio' : 'You' }}:</strong>
          <img v-if="msg.mediaUrl" alt="Sent attachment" :src="msg.mediaUrl" style="max-width: 200px; display: block" />
          <template v-else>{{ msg.content }}</template>
        </div>
      </template>

      <template v-else>
        <div class="d-flex flex-column align-center justify-center text-center" style="height: 100%">
          <div class="text-h6 mb-1">Whoops, something went wrong!</div>
          <div class="text-body-2">did you log in in another tab?</div>
        </div>
      </template>
    </div>

    <div class="text-caption text-medium-emphasis mt-1" style="height: 1.2em">
      <span v-if="radioTyping">Radio is typing...</span>
    </div>

    <div class="d-flex align-center mt-2">
      <v-text-field
        v-model="input"
        class="mr-2"
        :disabled="isClosed"
        hide-details
        placeholder="Type your message..."
        @input="notifyTyping"
        @keydown.enter="sendMessage"
      />

      <v-btn
        class="mr-2"
        :disabled="isClosed || uploading"
        icon="mdi-image-plus"
        :loading="uploading"
        variant="text"
        @click="fileInput?.click()"
      />

      <input ref="fileInput" accept="image/jpeg,image/png,image/webp" style="display: none" type="file" @change="onFileSelected" />
    </div>

    <v-alert v-if="uploadError" class="mt-2" closable density="compact" type="error" @click:close="uploadError = null">
      {{ uploadError }}
    </v-alert>

    <v-btn v-if="!isClosed" block class="mt-2" color="primary" @click="sendMessage">Send</v-btn>
    <v-btn v-else block class="mt-2" color="secondary" @click="connect">Reconnect</v-btn>
  </v-card>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useChatNotifications } from '@/composables/useChatNotifications';
import { useChatSocket } from '@/composables/useChatSocket';
import { useGewisAuth } from '@/composables/useGewisAuth';

type ChatIncoming = { content: string };
// The backend's Chat.dispatchTyping sends this to a listener when a radio
// is typing back to them, under the generic "radio" identity (see
// backend/chat.go) -- no `from`/`to` needed on this side, since a listener
// only ever has one counterparty.
type TypingIncoming = { type: 'typing' };
type Incoming = ChatIncoming | TypingIncoming;
type SentMessage = { from: string; content: string; mediaUrl?: string };

function isTypingMessage(msg: Incoming): msg is TypingIncoming {
  return (msg as TypingIncoming).type === 'typing';
}

// Mirrors the admin-side chat store's own typing constants (see
// stores/chat.ts) -- how long the indicator stays lit after the last
// signal, and how often notifyTyping() actually sends one while typing.
const TYPING_DISPLAY_MS = 3000;
const TYPING_SEND_THROTTLE_MS = 2000;

const input = ref('');
const messages = ref<SentMessage[]>([]);
const chatBox = ref<HTMLDivElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const radioTyping = ref(false);
const uploading = ref(false);
const uploadError = ref<string | null>(null);
let radioTypingTimer: ReturnType<typeof setTimeout> | null = null;
let lastTypingSentAt = 0;

const { getToken } = useGewisAuth();
const { notify } = useChatNotifications();

const { isClosed, connect, disconnect, send } = useChatSocket<Incoming>({
  path: '/ws?role=user',
  getToken: () => getToken(),
  buildHandshake: (token) => ({ token }),
  onMessage: (msg) => {
    if (isTypingMessage(msg)) {
      radioTyping.value = true;
      if (radioTypingTimer) clearTimeout(radioTypingTimer);
      radioTypingTimer = setTimeout(() => {
        radioTyping.value = false;
      }, TYPING_DISPLAY_MS);
      return;
    }

    messages.value.push({ from: 'radio', content: msg.content });
    notify('Radio', msg.content);
    scrollToBottom();
  },
});

function notifyTyping() {
  const now = Date.now();
  if (now - lastTypingSentAt < TYPING_SEND_THROTTLE_MS) return;
  lastTypingSentAt = now;
  send({ type: 'typing' });
}

async function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const token = getToken();
  if (!token) return;

  uploadError.value = null;
  uploading.value = true;
  try {
    const form = new FormData();
    form.append('token', token);
    form.append('purpose', 'chat_attachment');
    form.append('kind', 'photo');
    form.append('file', file);

    const res = await fetch('/api/v1/media', { method: 'POST', body: form });
    if (!res.ok) {
      uploadError.value = (await res.text()).trim() || `Could not send the attachment (${res.status}).`;
      return;
    }

    messages.value.push({ from: 'you', content: '', mediaUrl: URL.createObjectURL(file) });
    scrollToBottom();
    if (fileInput.value) fileInput.value.value = '';
  } catch {
    uploadError.value = 'Could not reach the server. Please try again.';
  } finally {
    uploading.value = false;
  }
}

function sendMessage() {
  if (!input.value.trim() || isClosed.value) return;

  const content = input.value.trim();
  if (!send({ content })) return;
  messages.value.push({ from: 'you', content });
  input.value = '';
  scrollToBottom();
}

function scrollToBottom() {
  nextTick(() => {
    if (chatBox.value) {
      chatBox.value.scrollTop = chatBox.value.scrollHeight;
    }
  });
}

onMounted(connect);
onBeforeUnmount(() => {
  disconnect();
  if (radioTypingTimer) clearTimeout(radioTypingTimer);
});
</script>
