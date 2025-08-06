<template>
  <v-card class="pa-4" color="surface-variant" rounded="lg" variant="tonal">
    <div ref="chatBox" style="height: 300px; overflow-y: auto">
      <div v-for="(msg, index) in messages" :key="index">
        <strong>{{ msg.from === 'radio' ? 'Radio' : 'You' }}:</strong>
        {{ msg.content }}
      </div>
    </div>

    <v-text-field v-model="input" placeholder="Type your message..." @keydown.enter="send" class="mt-2" />

    <v-btn @click="send" color="primary" block>Send</v-btn>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onBeforeUnmount, nextTick } from 'vue';

const input = ref('');
const messages = ref<{ from: string; content: string }[]>([]);
const chatBox = ref<HTMLDivElement | null>(null);

let socket: WebSocket | null = null;

function connect() {
  socket = new WebSocket('ws://localhost:8080/ws?role=user');

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    messages.value.push({ from: 'radio', content: msg.content });
    scrollToBottom();
  };

  socket.onclose = () => {
    console.log('Socket closed');
  };
}

function send() {
  if (!input.value.trim() || !socket) return;

  const content = input.value.trim();
  socket.send(JSON.stringify({ content }));
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
