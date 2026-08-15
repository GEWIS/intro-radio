import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useChatNotifications } from '@/composables/useChatNotifications';
import { useChatSocket } from '@/composables/useChatSocket';
import { useGewisAuth } from '@/composables/useGewisAuth';

type Outgoing = {
  from: string;
  to?: string;
  content: string;
  given_name?: string;
  family_name?: string;
};
export type ChatUser = { id: string; givenName: string; familyName: string; unread: number; lastActivity: number };
type ChatMessage = Outgoing & { ts: number };

// AdminChat's WebSocket connection used to live inside AdminChat.vue itself,
// opened on mount and closed on unmount -- which meant navigating to the
// Dashboard (or anywhere else in the backoffice) killed it, so nothing could
// track unread messages while looking at a different page. Pinia stores
// persist for the lifetime of the tab regardless of which route is active,
// which is what a "how many unread conversations do I have" indicator
// elsewhere in the backoffice actually needs. ensureConnected() is the entry
// point for that: idempotent, safe to call from every backoffice page's
// onMounted, and only the very first call actually opens the socket.
export const useChatStore = defineStore('chat', () => {
  const { getToken } = useGewisAuth();
  const { notify } = useChatNotifications();

  const usersMap = ref<Record<string, ChatUser>>({});
  const chats = ref<Record<string, ChatMessage[]>>({});
  const activeUser = ref<string | null>(null);

  let radioKey = '';
  let started = false;

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

  const {
    isClosed,
    connecting,
    connect,
    disconnect,
    send: sendRaw,
  } = useChatSocket<Outgoing>({
    path: '/ws?role=radio',
    getToken: () => getToken(),
    buildHandshake: (token) => ({ token, radioKey }),
    onMessage: (msg) => {
      // If there is a "to", it was sent by a radio and mirrored to us
      const isFromRadio = Boolean(msg.to && msg.to.length > 0);
      const chatId = isFromRadio ? (msg.to as string) : msg.from;

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

      if (!isFromRadio) {
        const senderName = `${msg.given_name ?? ''} ${msg.family_name ?? ''}`.trim();
        notify(senderName || msg.from, msg.content);
      }

      if (!chats.value[chatId]) chats.value[chatId] = [];
      chats.value[chatId].push({ ...msg, ts: Date.now() });

      if (!activeUser.value && chatId && chatId !== 'radio') {
        activeUser.value = chatId;
        usersMap.value[chatId].unread = 0;
      }
    },
  });

  function ensureConnected(key: string) {
    radioKey = key;
    if (started) return;
    started = true;
    connect();
  }

  function selectUser(id: string) {
    activeUser.value = id;
    if (usersMap.value[id]) usersMap.value[id].unread = 0;
  }

  function send(content: string): boolean {
    if (!activeUser.value) return false;
    const to = activeUser.value;
    if (!sendRaw({ to, content })) return false;

    if (!chats.value[to]) chats.value[to] = [];
    chats.value[to].push({ from: 'you', to, content, ts: Date.now() });
    touchUser(to);
    return true;
  }

  const users = computed<ChatUser[]>(() =>
    Object.values(usersMap.value).toSorted((a, b) => {
      if (b.lastActivity !== a.lastActivity) return b.lastActivity - a.lastActivity;
      const an = `${a.givenName} ${a.familyName}`.trim();
      const bn = `${b.givenName} ${b.familyName}`.trim();
      return an.localeCompare(bn);
    }),
  );

  const totalUnread = computed(() => Object.values(usersMap.value).reduce((sum, u) => sum + u.unread, 0));

  return {
    usersMap,
    chats,
    activeUser,
    users,
    totalUnread,
    isClosed,
    connecting,
    ensureConnected,
    connect,
    disconnect,
    selectUser,
    send,
  };
});
