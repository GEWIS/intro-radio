<template>
  <v-container class="py-8" fluid>
    <div class="mx-auto" style="max-width: 1400px">
      <div class="mb-6 text-center">
        <h1 class="text-h4 font-weight-bold gloria-hallelujah-regular">Backoffice</h1>
        <div class="text-body-2 text-medium-emphasis">Manage active chats</div>
      </div>

      <v-card v-if="gate.stage.value === 'auth'" class="p-4" color="surface-variant" rounded="lg" variant="tonal">
        <v-skeleton-loader type="paragraph, actions" />
      </v-card>

      <div v-else-if="gate.stage.value === 'need-key'" class="d-flex flex-column align-center w-full">
        <v-card class="px-4 py-4 w-50" color="surface-variant" rounded="lg" variant="tonal">
          <div class="text-h6 mb-2">Admin login</div>
          <div class="text-body-2 mb-4">Enter your radio admin key</div>

          <form @submit.prevent="submitKey">
            <v-text-field
              v-model="keyInput"
              class="mb-3"
              :disabled="validating"
              :error="!!gate.errorMsg.value"
              :error-messages="gate.errorMsg.value"
              hide-details="auto"
              label="Admin key"
            />

            <div class="w-full d-flex justify-end">
              <v-btn color="primary" :loading="validating" type="submit">Continue</v-btn>
            </div>
          </form>
        </v-card>
      </div>

      <template v-else-if="gate.stage.value === 'ready'">
        <div class="d-flex justify-end mb-2">
          <router-link to="/backoffice/agenda">Manage agenda</router-link>
        </div>

        <AdminChat :radio-key="gate.radioKey.value!" />
      </template>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AdminChat from '@/components/AdminChat.vue';
import { useAdminGate } from '@/composables/useAdminGate';

const gate = useAdminGate();
const keyInput = ref('');
const validating = ref(false);

onMounted(() => {
  gate.init();
});

async function submitKey() {
  validating.value = true;
  await gate.submitKey(keyInput.value);
  validating.value = false;
}
</script>
