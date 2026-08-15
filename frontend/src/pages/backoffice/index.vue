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
        </div>

        <AdminChat :radio-key="gate.radioKey.value!" />
      </template>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import AdminChat from '@/components/AdminChat.vue';
import AdminKeyGate from '@/components/AdminKeyGate.vue';
import { useAdminGate } from '@/composables/useAdminGate';

const gate = useAdminGate();

onMounted(() => {
  gate.init();
});
</script>
