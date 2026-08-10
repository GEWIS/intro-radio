<template>
  <v-card v-if="gate.stage.value === 'auth'" class="p-4" color="surface-variant" rounded="lg" variant="tonal">
    <v-skeleton-loader type="paragraph, actions" />
  </v-card>

  <div v-else-if="gate.stage.value === 'need-key'" class="d-flex flex-column align-center w-full">
    <v-card class="px-4 py-4 w-50" color="surface-variant" rounded="lg" variant="tonal">
      <div class="text-h6 mb-2">Admin login</div>
      <div class="text-body-2 mb-4">Enter your radio admin key</div>

      <form @submit.prevent="submit">
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
</template>

<script setup lang="ts">
import type { useAdminGate } from '@/composables/useAdminGate';
import { ref } from 'vue';

// The shared admin-key gate UI for every backoffice page: a loading
// skeleton while useAdminGate.init() resolves, then (if no valid key was
// already stored) a form to enter one. Renders nothing once
// gate.stage.value is 'ready' -- callers wrap their own ready-state content
// in a v-else alongside <AdminKeyGate v-if="gate.stage.value !== 'ready'">.
const props = defineProps<{ gate: ReturnType<typeof useAdminGate> }>();

const keyInput = ref('');
const validating = ref(false);

async function submit() {
  validating.value = true;
  await props.gate.submitKey(keyInput.value);
  validating.value = false;
}
</script>
