<template>
  <v-footer app height="40">
    <div class="text-caption text-disabled d-flex align-center justify-center w-100 gap-1">
      <div class="text-caption text-disabled d-flex align-center gap-1">
        <v-btn size="small" variant="text">&copy; {{ new Date().getFullYear() }}</v-btn>
        <span>•</span>
        <PrivacyPolicy />
        <span>•</span>
        <Credits />
        <span>•</span>

        <v-btn
          aria-label="View source on GitHub"
          href="https://github.com/GEWIS/radioweb"
          rel="noopener"
          size="small"
          target="_blank"
          variant="text"
        >
          <v-icon size="medium">mdi-github</v-icon>
        </v-btn>

        <span>•</span>
      </div>

      <v-tooltip location="top" text="Toggle dark mode">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
            icon
            size="small"
            variant="text"
            @click="toggle"
          >
            <v-icon size="small">
              {{ isDark ? 'mdi-white-balance-sunny' : 'mdi-moon-waxing-crescent' }}
            </v-icon>
          </v-btn>
        </template>
      </v-tooltip>
    </div>
  </v-footer>
</template>
<script setup lang="ts">
import Credits from '@/components/Credits.vue';
import PrivacyPolicy from '@/components/PrivacyPolicy.vue';
import { useDarkMode } from '@/composables/useDarkMode.ts';

const { isDark, toggle } = useDarkMode();
</script>
