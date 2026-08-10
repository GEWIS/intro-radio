<template>
  <v-card
    :aria-expanded="expanded"
    class="pa-4 mb-4"
    role="button"
    rounded="lg"
    style="cursor: pointer"
    tabindex="0"
    @click="toggle"
    @keydown.enter.prevent="toggle"
    @keydown.space.prevent="toggle"
  >
    <div class="d-flex align-center">
      <v-icon class="mr-3" color="primary">mdi-calendar-star</v-icon>
      <span class="text-h5">Radio Schedule</span>
      <v-spacer />
      <v-icon color="primary">{{ expanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
    </div>

    <v-expand-transition>
      <div v-if="expanded" class="mt-4">
        <div class="mb-4">Apart from playing the best music, we also have some quality segments for you to enjoy:</div>

        <template v-for="([date, ev], groupIdx) in groupedEvents" :key="date">
          <div v-if="groupIdx > 0" class="my-4">
            <v-divider />
          </div>

          <div class="mb-2 text-caption font-weight-bold">{{ getWeekday(date) }}</div>

          <div
            v-for="event in ev"
            :key="event.title"
            class="d-flex align-center mb-3 pa-3"
            :class="{ 'current-event': isCurrentEvent(event) }"
            :style="{
              background: isDark ? event.colorDark : event.color,
              borderRadius: '10px',
            }"
          >
            <v-icon class="mr-3" :color="event.iconColor">{{ event.icon }}</v-icon>

            <div>
              <div class="font-weight-bold" style="font-size: 1.1rem">
                {{ event.title }}
              </div>

              <div class="text-body-2">{{ event.subtitle }}</div>

              <div class="text-caption text-secondary">
                <span v-if="event.time">{{ event.time }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<script setup lang="ts">
import type { AgendaEvent } from '@/stores/app';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useDarkMode } from '@/composables/useDarkMode.ts';
import { useAppStore } from '@/stores/app';

const { isDark } = useDarkMode();

const expanded = ref(false);

function toggle() {
  expanded.value = !expanded.value;
}

const { agenda: events } = storeToRefs(useAppStore());

// Helper to parse "YYYY-MM-DD HH:mm" to Date
function parseDateTime(date: string, time: string, isEnd = false) {
  const [start, end] = time.split(' - ');
  const t = isEnd ? end : start;
  return new Date(`${date}T${t}:00`);
}

// Only show events that have not ended yet
const upcomingEvents = computed(() => {
  const now = new Date();
  return events.value.filter((event) => {
    const end = parseDateTime(event.date, event.time, true);
    return now < end;
  });
});

// Group events by date and sort by date
const groupedEvents = computed(() => {
  const groups: Record<string, AgendaEvent[]> = {};
  for (const event of upcomingEvents.value) {
    if (!groups[event.date]) groups[event.date] = [];
    groups[event.date].push(event);
  }
  // Return as sorted array of [date, events[]]
  return Object.entries(groups).toSorted(([a], [b]) => a.localeCompare(b));
});

// Show only the weekday name
function getWeekday(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { weekday: 'long' });
}

// Check if event is current
function isCurrentEvent(event: AgendaEvent) {
  const now = new Date();
  const start = parseDateTime(event.date, event.time);
  const end = parseDateTime(event.date, event.time, true);
  return now >= start && now < end;
}
</script>

<style scoped>
.current-event {
  border: 3px solid #ff9800 !important;
  box-shadow: 0 0 0 2px #fff176;
}

/* v-expand-transition only animates height by default; layer a scale + fade
   on top of it so opening/closing reads as the content growing into place
   instead of a flat height slide. */
.expand-transition-enter-active,
.expand-transition-leave-active {
  transition-property: height, transform, opacity !important;
  transform-origin: top center;
}

.expand-transition-enter-from,
.expand-transition-leave-to {
  transform: scale(0.95);
  opacity: 0;
}
</style>
