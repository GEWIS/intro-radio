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
          <v-card-title class="p-2 d-flex align-center justify-space-between">
            <div>
              <span class="font-weight-medium">Chat with:</span>
              <span class="ml-2">{{ activeUserTitle }}</span>
            </div>

            <v-btn :loading="connecting" size="small" variant="text" @click="chatStore.connect">Reconnect</v-btn>
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
                  <span class="ml-2">{{ m.content }}</span>
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
import { storeToRefs } from 'pinia';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useChatStore } from '@/stores/chat';

type ChatMessage = { from: string; to?: string; content: string; given_name?: string; family_name?: string; ts: number };

const props = defineProps<{
  radioKey: string;
}>();

const chatStore = useChatStore();
const { isClosed, connecting, users, activeUser, usersMap, chats } = storeToRefs(chatStore);

const input = ref('');
const messagesBox = ref<HTMLDivElement | null>(null);

const activeMessages = computed(() => (activeUser.value ? chats.value[activeUser.value] || [] : []));
const activeUserTitle = computed(() => {
  if (!activeUser.value) return '(select user)';
  const u = usersMap.value[activeUser.value];
  if (!u) return activeUser.value;
  return `${u.givenName} ${u.familyName} (${u.id})`;
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

// Covers every way activeMessages can change -- a new message arriving over
// the socket (including while a different backoffice page had it open),
// send()'s own local echo, and switching to a different user's thread --
// without each of those call sites needing its own explicit scroll call.
watch(activeMessages, scrollToBottom, { flush: 'post' });

onMounted(() => chatStore.ensureConnected(props.radioKey));
</script>
