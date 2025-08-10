<template>
  <v-card class="p-2" color="surface-variant" variant="tonal" rounded="lg">
    <v-row class="gap-0" no-gutters>
      <!-- Users list -->
      <v-col cols="12" md="4" lg="3" class="pr-md-3 mb-4 mb-md-0">
        <v-card flat class="h-100 p-2">
          <v-card-title class="p-2">Users</v-card-title>
          <v-divider />
          <v-list class="overflow-y-auto p-2" style="height: calc(70vh - 80px);">
            <v-list-item
              v-for="u in users"
              :key="u.id"
              :title="`${u.givenName} ${u.familyName} (m${u.id})`"
              :subtitle="formatLast(u.lastActivity)"
              density="compact"
              :active="activeUser === u.id"
              @click="selectUser(u.id)"
            >
              <template #append>
                <v-badge v-if="u.unread > 0" :content="u.unread" color="error" inline />
              </template>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>

      <!-- Chat panel -->
      <v-col cols="12" md="8" lg="9" class="pl-md-3">
        <v-card flat class="h-100 d-flex flex-column p-2">
          <v-card-title class="p-2 d-flex align-center justify-space-between">
            <div>
              <span class="font-weight-medium">Chat with:</span>
              <span class="ml-2">{{ activeUserTitle }}</span>
            </div>
            <v-btn size="small" variant="text" @click="reconnect" :loading="connecting">Reconnect</v-btn>
          </v-card-title>
          <v-divider />

          <div ref="messagesBox" class="flex-grow-1 overflow-y-auto py-2 px-2" style="min-height: 50vh; max-height: 70vh;">
            <template v-if="!isClosed">
              <div v-for="(m, i) in activeMessages" :key="i" class="my-1">
                <strong>[{{ m.from === 'radio' ? 'Radio' : usersMap[m.from]?.givenName || m.from }}]</strong>
                <span class="ml-2">{{ m.content }}</span>
              </div>
            </template>
            <template v-else>
              <div class="d-flex flex-column align-center justify-center text-center" style="height: 50vh;">
                <div class="text-h6 mb-1">Whoops, something went wrong!</div>
                <div class="text-body-2">did you log in in another tab?</div>
              </div>
            </template>
          </div>

          <div class="d-flex align-center mt-3 p-2">
            <v-text-field
              v-model="input"
              class="mr-2"
              placeholder="Write a message"
              :disabled="isClosed || !activeUser"
              @keydown.enter="send"
              hide-details
              density="comfortable"
            />
            <v-btn color="primary" height="40" class="flex-shrink-0" @click="send" :disabled="isClosed || !activeUser">
              Send
            </v-btn>
          </div>
        </v-card>
      </v-col>
    </v-row>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';

type Outgoing = {
  from: string;
  to?: string;
  content: string;
  given_name?: string;
  family_name?: string;
};
type Incoming = { token?: string; to?: string; content?: string; radioKey?: string };
type ChatUser = { id: string; givenName: string; familyName: string; unread: number; lastActivity: number };

const props = defineProps<{
  token: string;
  radioKey: string;
}>();

const input = ref('');
const connecting = ref(false);
const isClosed = ref(false);
const messagesBox = ref<HTMLDivElement | null>(null);

const chats = ref<Record<string, Outgoing[]>>({});
const usersMap = ref<Record<string, ChatUser>>({});

const users = computed<ChatUser[]>(() =>
  Object.values(usersMap.value).sort((a, b) => {
    if (b.lastActivity !== a.lastActivity) return b.lastActivity - a.lastActivity;
    const an = `${a.givenName} ${a.familyName}`.trim();
    const bn = `${b.givenName} ${b.familyName}`.trim();
    return an.localeCompare(bn);
  })
);

const activeUser = ref<string | null>(null);
const activeMessages = computed(() => (activeUser.value ? chats.value[activeUser.value] || [] : []));
const activeUserTitle = computed(() => {
  if (!activeUser.value) return '(select user)';
  const u = usersMap.value[activeUser.value];
  if (!u) return activeUser.value;
  return `${u.givenName} ${u.familyName} (${u.id})`;
});

let ws: WebSocket | null = null;

function formatLast(ts: number) {
  if (!ts) return 'no activity';
  const d = new Date(ts);
  return d.toLocaleTimeString(['nl-NL'], { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesBox.value) messagesBox.value.scrollTop = messagesBox.value.scrollHeight;
  });
}

function touchUser(id: string, given?: string, family?: string) {
  const now = Date.now();
  const existing = usersMap.value[id];
  usersMap.value[id] = {
    id,
    givenName: given ?? existing?.givenName ?? '',
    familyName: family ?? existing?.familyName ?? '',
    unread: existing?.unread ?? 0,
    lastActivity: now,
  };
}

function selectUser(id: string) {
  activeUser.value = id;
  if (usersMap.value[id]) usersMap.value[id].unread = 0;
  scrollToBottom();
}

function connect() {
  connecting.value = true;
  ws = new WebSocket(`ws://${window.location.host}/ws?role=radio`);

  ws.onopen = () => {
    isClosed.value = false;
    ws?.send(JSON.stringify({ token: props.token, radioKey: props.radioKey }));
    connecting.value = false;
  };

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data) as Outgoing;
    const from = msg.from;

    if (from && from !== 'radio') {
      touchUser(from, msg.given_name, msg.family_name);
      if (activeUser.value !== from) {
        usersMap.value[from].unread = (usersMap.value[from].unread || 0) + 1;
      }
    }

    if (!chats.value[from]) chats.value[from] = [];
    chats.value[from].push(msg);

    if (!activeUser.value && from !== 'radio') {
      activeUser.value = from;
      usersMap.value[from].unread = 0;
    }

    scrollToBottom();
  };

  ws.onclose = () => {
    isClosed.value = true;
    connecting.value = false;
  };
}

function reconnect() {
  try { ws?.close(); } catch {}
  connect();
}

function send() {
  if (!ws || isClosed.value || !activeUser.value) return;
  const content = input.value.trim();
  if (!content) return;

  const to = activeUser.value;
  const payload: Incoming = { token: props.token, to, content };
  ws.send(JSON.stringify(payload));

  if (!chats.value[to]) chats.value[to] = [];
  chats.value[to].push({ from: 'radio', to, content });

  touchUser(to);
  input.value = '';
  scrollToBottom();
}

onMounted(connect);
onBeforeUnmount(() => ws?.close());
</script>
