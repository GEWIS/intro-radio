<template>
  <v-container class="py-8" fluid>
    <div class="mx-auto" style="max-width: 1400px">
      <div class="mb-6 text-center">
        <h1 class="text-h4 font-weight-bold gloria-hallelujah-regular">Backoffice</h1>
        <div class="text-body-2 text-medium-emphasis mt-2">Manage active chats</div>
      </div>

      <AdminKeyGate v-if="gate.stage.value !== 'ready'" :gate="gate" />

      <template v-else>
        <div class="d-flex justify-end mb-2 ga-4">
          <router-link to="/backoffice/agenda">Manage agenda</router-link>
          <router-link to="/backoffice/dashboard">Dashboard</router-link>
          <router-link to="/backoffice/status">Status</router-link>
          <router-link to="/backoffice/media">Media</router-link>
        </div>

        <AdminChat :radio-key="gate.radioKey.value!" />
      </template>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import AdminChat from '@/components/AdminChat.vue';
import AdminKeyGate from '@/components/AdminKeyGate.vue';
import { useAdminGate } from '@/composables/useAdminGate';
import { useChatStore } from '@/stores/chat';

const gate = useAdminGate();
const route = useRoute();
const chatStore = useChatStore();

onMounted(() => {
  gate.init();
});

// Lets the dashboard's audit-log link straight into a specific person's
// thread (?user=<lidnr>) instead of just dropping the admin on the chat page
// to go find them manually. Selecting someone with no messages yet is fine
// -- AdminChat renders an empty thread and lets staff message them first.
// Watches gate.stage too, not just the query param: the query param is
// already set on first navigation, before init() resolves it to 'ready', so
// only watching the param would miss firing once the gate actually opens.
watch(
  [() => route.query.user, gate.stage],
  ([user, stage]) => {
    if (typeof user === 'string' && stage === 'ready') chatStore.selectUser(user);
  },
  { immediate: true },
);
</script>
