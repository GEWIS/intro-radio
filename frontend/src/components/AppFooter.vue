<template>
  <v-footer app height="40">
    <div class="text-caption text-disabled d-flex align-center justify-center w-100 gap-2">
      <div class="text-caption text-disabled d-flex align-center gap-2">
        <span>&copy; {{ new Date().getFullYear() }} Intro Radio</span>
        <span class="mx-2">•</span>
        <PrivacyPolicy />
      </div>

      <v-tooltip location="top" text="Toggle dark mode">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
            icon
            variant="text"
            @click="toggle"
          >
            <v-icon>{{ isDark ? 'mdi-white-balance-sunny' : 'mdi-moon-waxing-crescent' }}</v-icon>
          </v-btn>
        </template>
      </v-tooltip>
    </div>
  </v-footer>
</template>

<script setup lang="ts">
import PrivacyPolicy from '@/components/PrivacyPolicy.vue';
import { useDarkMode } from '@/composables/useDarkMode.ts';

const { isDark, toggle } = useDarkMode();
</script>
