<template>
  <v-footer app height="40">
    <div class="text-caption text-disabled d-flex align-center justify-center w-100 gap-2">
      <span>&copy; {{ new Date().getFullYear() }} Intro Radio</span>
      <span class="mx-2">•</span>
      <PrivacyPolicy />
    </div>
  </v-footer>
</template>

<script setup lang="ts">
import PrivacyPolicy from '@/components/PrivacyPolicy.vue';
</script>
