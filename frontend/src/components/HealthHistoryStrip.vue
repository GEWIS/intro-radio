<template>
  <div class="d-flex ga-px" style="height: 10px; width: 160px">
    <div
      v-for="(s, i) in history"
      :key="i"
      class="flex-grow-1"
      :style="{ background: s.healthy ? 'rgb(var(--v-theme-success))' : 'rgb(var(--v-theme-error))', borderRadius: '1px' }"
      :title="sampleTitle(s)"
    />
  </div>
</template>

<script setup lang="ts">
import type { HealthSample } from '@/composables/useHealthHistory';

defineProps<{ history: HealthSample[] }>();

function sampleTitle(s: HealthSample) {
  const time = new Date(s.ts).toLocaleTimeString(['nl-NL'], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${time}: ${s.healthy ? 'up' : 'down'}`;
}
</script>
