<template>
  <v-card class="pa-2" color="surface-variant" rounded="lg" variant="tonal">
    <v-row class="gap-0" no-gutters>
      <!-- Users list -->
      <v-col class="pr-md-3 mb-4 mb-md-0" cols="12" lg="3" md="4">
        <v-card class="h-100 p-2" flat>
          <v-card-title class="pa-2">Users</v-card-title>
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
          <v-card-title class="p-2 d-flex flex-wrap align-center justify-space-between ga-2">
            <div>
              <span class="font-weight-medium">Chat with:</span>
              <span class="ml-2">{{ activeUserTitle }}</span>

              <span v-if="activeUser && typingUsers[activeUser]" class="ml-2 text-caption text-medium-emphasis">
                typing...
              </span>
            </div>

            <!-- flex-wrap above (not present before the admin-presence chip
                 and Reconnect button were added here) matters specifically
                 on narrow screens: without it, this row doesn't shrink or
                 scroll -- v-card-title's own overflow:hidden just clips
                 whatever doesn't fit, silently making Reconnect unreachable
                 rather than visibly overflowing. -->
            <div class="d-flex align-center ga-3">
              <v-chip
                v-if="admins.length > 0"
                prepend-icon="mdi-account-multiple"
                size="small"
                :title="adminNames"
                variant="tonal"
              >
                {{ admins.length }} {{ admins.length === 1 ? 'admin' : 'admins' }} online
              </v-chip>

              <v-btn :loading="connecting" size="small" variant="text" @click="chatStore.connect">Reconnect</v-btn>
            </div>
          </v-card-title>

          <v-divider />

          <div
            ref="messagesBox"
            class="flex-grow-1 overflow-y-auto py-2 px-2"
            style="min-height: 50vh; max-height: 70vh"
          >
            <template v-if="!isClosed">
              <div v-for="(m, i) in activeMessages" :key="i" class="my-1 d-flex">
                <!-- Timestamp -->
                <div class="text-caption font-mono mr-2" style="width: 48px; text-align: right">
                  {{ formatTime(m.ts) }}
                </div>

                <!-- Vertical separator -->
                <v-divider class="mx-3" style="align-self: stretch" :thickness="2" vertical />

                <!-- Message body -->
                <div class="flex-grow-1">
                  <strong>[{{ messageLabel(m) }}]</strong>

                  <img
                    v-if="m.media_id && mediaUrls[m.media_id]"
                    alt="Attachment"
                    class="ml-2"
                    :src="mediaUrls[m.media_id]"
                    style="max-width: 160px; max-height: 160px; display: inline-block; vertical-align: middle; cursor: pointer"
                    @click="openFullSize(mediaUrls[m.media_id])"
                  />

                  <span v-else-if="m.media_id" class="ml-2 text-medium-emphasis">Loading attachment...</span>

                  <span v-else class="ml-2">{{ m.content }}</span>
                </div>
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
              @input="chatStore.notifyTyping"
              @keydown.enter="send"
            />

            <v-btn class="flex-shrink-0" color="primary" :disabled="isClosed || !activeUser" height="40" @click="send">
              Send
            </v-btn>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <v-dialog v-model="dialogOpen" max-width="90vw">
      <img v-if="typeof fullSizeUrl === 'string'" alt="Attachment" :src="fullSizeUrl" style="max-width: 100%; display: block" />
    </v-dialog>

    <v-snackbar v-model="showReconnected" color="success" timeout="3000">Reconnected</v-snackbar>
  </v-card>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useGewisAuth } from '@/composables/useGewisAuth';
import { useChatStore } from '@/stores/chat';

type ChatMessage = { from: string; to?: string; content: string; given_name?: string; family_name?: string; ts: number; media_id?: string; media_kind?: string };

const props = defineProps<{
  radioKey: string;
}>();

const chatStore = useChatStore();
const { isClosed, connecting, users, activeUser, usersMap, chats, admins, typingUsers } = storeToRefs(chatStore);

const { getToken } = useGewisAuth();
const mediaUrls = ref<Record<string, string>>({});
const fullSizeUrl = ref<string | false>(false);

const input = ref('');
const messagesBox = ref<HTMLDivElement | null>(null);

// Only a *recovery* (closed -> open) shows the toast, not the initial
// connect -- wasClosed starts at whatever isClosed already is at mount, so
// a fresh connection succeeding for the first time never counts as one.
const showReconnected = ref(false);
let wasClosed = isClosed.value;
watch(isClosed, (closed) => {
  if (!closed && wasClosed) showReconnected.value = true;
  wasClosed = closed;
});

// Falls back to the bare id for an admin whose token carried no name, same
// reasoning as messageLabel's 'Radio' fallback below.
const adminNames = computed(() =>
  admins.value.map((a) => `${a.given_name ?? ''} ${a.family_name ?? ''}`.trim() || a.id).join(', '),
);

const activeMessages = computed(() => (activeUser.value ? chats.value[activeUser.value] || [] : []));
const activeUserTitle = computed(() => {
  if (!activeUser.value) return '(select user)';
  const u = usersMap.value[activeUser.value];
  if (!u) return activeUser.value;
  return `${u.givenName} ${u.familyName} (${u.id})`;
});
const dialogOpen = computed({
  get: () => typeof fullSizeUrl.value === 'string',
  set: (val: boolean) => {
    if (!val) fullSizeUrl.value = false;
  },
});

function formatLast(ts: number) {
  if (!ts) return 'no activity';
  const d = new Date(ts);
  return d.toLocaleTimeString(['nl-NL'], { hour: '2-digit', minute: '2-digit' });
}
function formatTime(ts?: number) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString(['nl-NL'], { hour: '2-digit', minute: '2-digit' });
}

// 'you' is our own sentinel for the optimistic local echo in the store's
// send() -- never a real lidnr. A `to` on any other message means it's a
// radio-to-radio mirror (listener-authored messages never carry `to`), so
// we can tell those apart from the listener's own messages without a
// separate flag.
function messageLabel(m: ChatMessage): string {
  if (m.from === 'you') return 'You';
  if (m.to) return m.given_name || m.family_name || 'Radio';
  return usersMap.value[m.from]?.givenName || m.from;
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesBox.value) messagesBox.value.scrollTop = messagesBox.value.scrollHeight;
  });
}

function selectUser(id: string) {
  chatStore.selectUser(id);
}

function send() {
  if (isClosed.value || !activeUser.value) return;
  const content = input.value.trim();
  if (!content) return;
  if (!chatStore.send(content)) return;

  input.value = '';
}

function openFullSize(url: string) {
  fullSizeUrl.value = url;
}

async function fetchMediaUrl(mediaId: string) {
  if (mediaUrls.value[mediaId]) return;
  const token = getToken();
  if (!token) return;

  try {
    const res = await fetch('/api/v1/media/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, radioKey: props.radioKey, id: mediaId }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    mediaUrls.value = { ...mediaUrls.value, [mediaId]: URL.createObjectURL(blob) };
  } catch {
    // A failed fetch just leaves "Loading attachment..." on screen -- the
    // next watch trigger (e.g. reselecting the thread) will retry.
  }
}

// Covers every way activeMessages can change -- a new message arriving over
// the socket (including while a different backoffice page had it open),
// send()'s own local echo, and switching to a different user's thread --
// without each of those call sites needing its own explicit scroll call.
watch(activeMessages, scrollToBottom, { flush: 'post' });

// Fetches the blob for every media message currently in view, whenever the
// active thread's messages change (new message arrives, or a different
// user is selected).
watch(
  activeMessages,
  (msgs) => {
    for (const m of msgs) {
      if (m.media_id) fetchMediaUrl(m.media_id);
    }
  },
  { immediate: true },
);

// Alt+Up/Down cycles through unread conversations without touching the
// mouse -- Alt- rather than a bare arrow key, since a bare arrow needs to
// keep moving the caret inside the message v-text-field. Only the users
// with unread > 0 form the cycle; jumping into it from a user that isn't
// itself unread (the common case, since selecting a user clears its own
// unread count) starts at whichever end direction points toward.
function cycleUnread(direction: 1 | -1) {
  const queue = users.value.filter((u) => u.unread > 0);
  if (queue.length === 0) return;

  const currentIdx = queue.findIndex((u) => u.id === activeUser.value);
  const nextIdx =
    currentIdx === -1 ? (direction === 1 ? 0 : queue.length - 1) : (currentIdx + direction + queue.length) % queue.length;

  chatStore.selectUser(queue[nextIdx].id);
}

function handleKeydown(e: KeyboardEvent) {
  if (!e.altKey) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    cycleUnread(1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    cycleUnread(-1);
  }
}

onMounted(() => {
  chatStore.ensureConnected(props.radioKey);
  window.addEventListener('keydown', handleKeydown);
});
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
</script>
