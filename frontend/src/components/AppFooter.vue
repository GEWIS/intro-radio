<template>
  <v-footer app height="40">
    <div class="text-caption text-disabled d-flex align-center justify-space-between w-100 gap-1">
      <div class="d-flex align-center gap-1">
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

      <!-- Deliberately apart from the icon cluster above -- this is a
      diagnostic aid ("what's actually running"), not a social/legal link,
      and grouping it with those made it easy to miss. Hidden below the `sm`
      breakpoint: the icon cluster alone already fills nearly the full
      375px-wide footer, leaving this nowhere to go -- the footer's fixed
      40px height means it can't wrap onto a second line without either
      group clipping instead, so on a phone this stays reachable from the
      GitHub commit history rather than from this bar. -->
      <div class="d-none d-sm-flex align-center gap-1">
        <v-tooltip location="top" :text="`Deployed commit: ${gitSha}`">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              aria-label="View deployed commit on GitHub"
              class="text-none"
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

        <span>{{ appVersion }}</span>
      </div>
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

// Same build-time-only reasoning as gitSha above (see frontend/Dockerfile's
// VITE_APP_VERSION) -- this is the semantic-release version tied to whatever
// release actually produced this image, not a runtime lookup.
const appVersion = import.meta.env.VITE_APP_VERSION || 'unknown';
</script>
