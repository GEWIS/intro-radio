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
          href="https://github.com/GEWIS/intro-radio"
          rel="noopener"
          size="small"
          target="_blank"
          variant="text"
        >
          <v-icon size="medium">mdi-github</v-icon>
        </v-btn>

        <span>•</span>

        <v-tooltip location="top" :text="`Deployed commit: ${gitSha}`">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              aria-label="View deployed commit on GitHub"
              :disabled="!commitUrl"
              :href="commitUrl"
              rel="noopener"
              size="small"
              target="_blank"
              variant="text"
            >
              {{ shortSha }}
            </v-btn>
          </template>
        </v-tooltip>

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

// Baked in at Docker build time (see frontend/Dockerfile and VITE_GIT_SHA),
// not read from a runtime env var -- there's no git history inside the
// running container, and this needs to reflect exactly what was built.
// Falls back to "unknown" for local dev (`yarn dev`) and any build that
// didn't pass --build-arg GIT_SHA, where there's no real commit to point at.
const gitSha = import.meta.env.VITE_GIT_SHA || 'unknown';
const isKnownSha = /^[0-9a-f]{7,40}$/i.test(gitSha);
const shortSha = isKnownSha ? gitSha.slice(0, 7) : gitSha;
const commitUrl = isKnownSha ? `https://github.com/GEWIS/intro-radio/commit/${gitSha}` : undefined;
</script>
