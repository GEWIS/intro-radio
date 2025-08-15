<template>
  <v-card class="py-4 my-4 w-100" color="surface-variant" rounded="lg" variant="tonal">
    <!-- Clickable header only -->
    <div
      :aria-expanded="expanded"
      class="d-flex align-center justify-space-between px-4 py-3 cursor-pointer"
      role="button"
      tabindex="0"
      @click="toggle()"
      @keydown.enter.prevent="toggle()"
      @keydown.space.prevent="toggle()"
    >
      <div class="d-flex align-center">
        <v-icon class="mr-3" icon="mdi-music-note-plus" />
        <div>
          <div class="text-subtitle-1 font-weight-medium">Choose your song</div>
          <div class="text-body-2 text-medium-emphasis">Want to listen to your favourite song?</div>
        </div>
      </div>
      <v-icon :class="expanded ? 'rotate-180' : ''" icon="mdi-chevron-down" />
    </div>

    <v-expand-transition>
      <div v-show="expanded">
        <v-card-text>
          <v-text-field v-model="song" clearable label="Enter song name" @click.stop @keyup.enter="goToSpotify" />
        </v-card-text>

        <v-card-actions class="w-100 justify-end d-flex">
          <v-btn color="primary" :disabled="!song" @click="goToSpotify"> Search </v-btn>
        </v-card-actions>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<script setup lang="ts">
const song = ref('');
const expanded = ref(false);

function toggle() {
  expanded.value = !expanded.value;
}

function goToSpotify() {
  if (!song.value) return;
  window.open(`https://open.spotify.com/search/${encodeURIComponent(song.value)}`, '_blank');
}
</script>

<style scoped>
.rotate-180 {
  transform: rotate(180deg);
  transition: transform 150ms;
}
</style>
