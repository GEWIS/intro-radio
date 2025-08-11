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
      @keydown.enter="send"
    />

    <v-btn v-if="!isClosed" block color="primary" @click="send">Send</v-btn>

    <v-btn v-else block color="secondary" @click="connect">Reconnect</v-btn>
  </v-card>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const input = ref('');
const messages = ref<{ from: string; content: string }[]>([]);
const chatBox = ref<HTMLDivElement | null>(null);
const isClosed = ref(false);

let socket: WebSocket | null = null;
const token = localStorage.getItem('token') || '';

function connect() {
  if (socket) socket.close();
  if (!token) {
    console.error('No token found in localStorage');
    return;
  }

  socket = new WebSocket('ws://' + window.location.host + '/ws?role=user');

  socket.addEventListener('open', () => {
    isClosed.value = false;
    // Send handshake with token
    socket?.send(JSON.stringify({ token }));
  });

  socket.addEventListener('message', (event: MessageEvent) => {
    const msg = JSON.parse(event.data);
    messages.value.push({ from: 'radio', content: msg.content });
    scrollToBottom();
  });

  socket.addEventListener('close', () => {
    isClosed.value = true;
    messages.value = [];
    console.log('Socket closed');
  });
}

function send() {
  if (!input.value.trim() || !socket || isClosed.value) return;

  const content = input.value.trim();
  socket.send(JSON.stringify({ token, content }));
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
onBeforeUnmount(() => socket?.close());
</script>
