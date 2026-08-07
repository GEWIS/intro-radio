<template>
  <v-card class="pa-4" color="surface-variant" rounded="lg" variant="tonal">
    <div ref="chatBox" style="height: 300px; overflow-y: auto">
      <template v-if="!isClosed">
        <div v-for="(msg, index) in messages" :key="index">
          <strong>{{ msg.from === 'radio' ? 'Radio' : 'You' }}:</strong>
          {{ msg.content }}
        </div>
      </template>

      <template v-else>
        <div class="d-flex flex-column align-center justify-center text-center" style="height: 100%">
          <div class="text-h6 mb-1">Whoops, something went wrong!</div>
          <div class="text-body-2">did you log in in another tab?</div>
        </div>
      </template>
    </div>

    <v-text-field
      v-model="input"
      class="mt-2"
      :disabled="isClosed"
      placeholder="Type your message..."
      @keydown.enter="sendMessage"
    />

    <v-btn v-if="!isClosed" block color="primary" @click="sendMessage">Send</v-btn>

    <v-btn v-else block color="secondary" @click="connect">Reconnect</v-btn>
  </v-card>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useChatSocket } from '@/composables/useChatSocket';
import { useGewisAuth } from '@/composables/useGewisAuth';

type Incoming = { content: string };

const input = ref('');
const messages = ref<{ from: string; content: string }[]>([]);
const chatBox = ref<HTMLDivElement | null>(null);

const { getToken } = useGewisAuth();

const { isClosed, connect, disconnect, send } = useChatSocket<Incoming>({
  path: '/ws?role=user',
  getToken: () => getToken(),
  buildHandshake: (token) => ({ token }),
  onMessage: (msg) => {
    messages.value.push({ from: 'radio', content: msg.content });
    scrollToBottom();
  },
});

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
onBeforeUnmount(disconnect);
</script>
