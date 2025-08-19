<template>
  <v-card class="p-2" color="surface-variant" rounded="lg" variant="tonal">
    <v-row class="gap-0" no-gutters>
      <!-- Users list -->
      <v-col class="pr-md-3 mb-4 mb-md-0" cols="12" lg="3" md="4">
        <v-card class="h-100 p-2" flat>
          <v-card-title class="p-2">Users</v-card-title>
          <v-divider />
          <v-list class="overflow-y-auto p-2" style="height: calc(70vh - 80px)">
            <v-list-item
              v-for="u in users"
              :key="u.id"
              :active="activeUser === u.id"
              density="compact"
              :subtitle="formatLast(u.lastActivity)"
              :title="`${u.givenName} ${u.familyName} (m${u.id})`"
              @click="selectUser(u.id)"
            >
              <template #append>
                <v-badge v-if="u.unread > 0" color="error" :content="u.unread" inline />
              </template>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>

      <!-- Chat panel -->
      <v-col class="pl-md-3" cols="12" lg="9" md="8">
        <v-card class="h-100 d-flex flex-column p-2" flat>
          <v-card-title class="p-2 d-flex align-center justify-space-between">
            <div>
              <span class="font-weight-medium">Chat with:</span>
              <span class="ml-2">{{ activeUserTitle }}</span>
            </div>
            <v-btn :loading="connecting" size="small" variant="text" @click="reconnect">Reconnect</v-btn>
          </v-card-title>
          <v-divider />

          <div
            ref="messagesBox"
            class="flex-grow-1 overflow-y-auto py-2 px-2"
            style="min-height: 50vh; max-height: 70vh"
          >
            <template v-if="!isClosed">
              <div v-for="(m, i) in activeMessages" :key="i" class="my-1">
                <strong>[{{ m.from === 'radio' ? 'Radio' : usersMap[m.from]?.givenName || m.from }}]</strong>
                <span class="ml-2">{{ m.content }}</span>
              </div>
            </template>
            <template v-else>
              <div class="d-flex flex-column align-center justify-center text-center" style="height: 50vh">
                <div class="text-h6 mb-1">Whoops, something went wrong!</div>
                <div class="text-body-2">did you log in in another tab?</div>
              </div>
            </template>
          </div>

          <div class="d-flex align-center mt-3 p-2">
            <v-text-field
              v-model="input"
              class="mr-2"
              density="comfortable"
              :disabled="isClosed || !activeUser"
              hide-details
              placeholder="Write a message"
              @keydown.enter="send"
            />
            <v-btn class="flex-shrink-0" color="primary" :disabled="isClosed || !activeUser" height="40" @click="send">
              Send
            </v-btn>
          </div>
        </v-card>
      </v-col>
    </v-row>
  </v-card>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

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
  /** Optional async getter that returns a fresh token */
  getToken?: () => Promise<string>;
}>();

const tokenRef = ref(props.token);
watch(
  () => props.token,
  v => {
    if (v) tokenRef.value = v;
  },
);

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
  }),
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
  ws = new WebSocket(`wss://${window.location.host}/ws?role=radio`);

  ws.addEventListener('open', () => {
    isClosed.value = false;
    ws?.send(JSON.stringify({ token: tokenRef.value, radioKey: props.radioKey }));
    connecting.value = false;
  });

  ws.addEventListener('message', (evt: MessageEvent) => {
    const msg = JSON.parse(evt.data) as Outgoing;

    // If there is a "to", it was sent by a radio and mirrored to us
    const isFromRadio = Boolean(msg.to && msg.to.length > 0);
    const chatId = isFromRadio ? (msg.to as string) : (msg.from as string);
    const displayFrom = isFromRadio ? 'radio' : (msg.from as string);

    // Maintain user activity for the chat thread
    if (chatId && chatId !== 'radio') {
      // We only have names when the user writes to us
      if (isFromRadio) {
        touchUser(chatId);
      } else {
        touchUser(chatId, msg.given_name, msg.family_name);
      }
      if (activeUser.value !== chatId) {
        usersMap.value[chatId].unread = (usersMap.value[chatId].unread || 0) + 1;
      }
    }

    if (!chats.value[chatId]) chats.value[chatId] = [];
    chats.value[chatId].push({ ...msg, from: displayFrom });

    if (!activeUser.value && chatId && chatId !== 'radio') {
      activeUser.value = chatId;
      usersMap.value[chatId].unread = 0;
    }

    scrollToBottom();
  });

  ws.addEventListener('close', () => {
    isClosed.value = true;
    connecting.value = false;
  });
}

async function reconnect() {
  if (connecting.value) return;
  connecting.value = true;

  try {
    if (props.getToken) {
      const fresh = await props.getToken();
      if (fresh) tokenRef.value = fresh;
    }
  } catch {
    // ignore
  } finally {
    try {
      ws?.close();
    } catch {}
    connect();
  }
}

function send() {
  if (!ws || isClosed.value || !activeUser.value) return;
  const content = input.value.trim();
  if (!content) return;

  const to = activeUser.value;
  const payload: Incoming = { token: tokenRef.value, to, content };
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
