<template>
  <v-card class="pa-4 mb-4" rounded="lg" style="cursor: pointer" @click="expanded = !expanded">
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
              background: event.color,
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
import { computed, ref } from 'vue';
import schedule from '@/assets/schedule.json';

const expanded = ref(false);
type Event = {
  title: string;
  subtitle: string;
  icon: string;
  iconColor: string;
  color: string;
  date: string;
  time: string;
};
const events = schedule as Event[];

// Helper to parse "YYYY-MM-DD HH:mm" to Date
function parseDateTime(date: string, time: string, isEnd = false) {
  const [start, end] = time.split(' - ');
  const t = isEnd ? end : start;
  return new Date(`${date}T${t}:00`);
}

// Only show events that have not ended yet
const upcomingEvents = computed(() => {
  const now = new Date();
  return events.filter((event) => {
    const end = parseDateTime(event.date, event.time, true);
    return now < end;
  });
});

// Group events by date and sort by date
const groupedEvents = computed(() => {
  const groups: Record<string, Event[]> = {};
  for (const event of upcomingEvents.value) {
    if (!groups[event.date]) groups[event.date] = [];
    groups[event.date].push(event);
  }
  // Return as sorted array of [date, events[]]
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
});

// Show only the weekday name
function getWeekday(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, { weekday: 'long' });
}

// Check if event is current
function isCurrentEvent(event: Event) {
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
</style>
