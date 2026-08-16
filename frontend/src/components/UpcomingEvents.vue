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

    <!-- A CSS grid track animates smoothly between 0fr and 1fr, which is how
    this grows/shrinks with real height (pushing whatever's below it) without
    needing v-expand-transition's JS-measured height, or any dependency on
    Vuetify's own .expand-transition-* rules -- see the <style> block below
    for why that dependency didn't actually animate anything. The content
    stays mounted at all times (just clipped to ~0px via overflow: hidden
    when collapsed) so there's no v-if mount/unmount step to coordinate with
    the class-driven transition. -->
    <div :aria-hidden="!expanded" class="schedule-panel" :class="{ 'schedule-panel--open': expanded }">
      <div class="schedule-panel__inner">
        <div class="mb-4">Apart from playing the best music, we also have some quality segments for you to enjoy:</div>

        <template v-for="([date, ev], groupIdx) in groupedEvents" :key="date">
          <div v-if="groupIdx > 0" class="my-4">
            <v-divider />
          </div>

          <div class="mb-2 text-caption font-weight-bold">{{ getWeekday(date) }}</div>

          <div
            v-for="(event, idx) in ev"
            :key="`${date}-${idx}`"
            class="d-flex align-center mb-3 pa-3"
            :class="{ 'current-event': isCurrentAgendaEvent(event, now) }"
            :style="{
              background: isDark ? event.colorDark : event.color,
              borderRadius: '10px',
            }"
          >
            <v-icon class="mr-3" :color="event.iconColor">{{ event.icon }}</v-icon>

            <div class="flex-grow-1">
              <div class="font-weight-bold" style="font-size: 1.1rem">
                {{ event.title }}
              </div>

              <div class="text-body-2">{{ event.subtitle }}</div>

              <div class="text-caption text-secondary">
                <span v-if="event.time">{{ event.time }}</span>
              </div>

              <!-- Only the currently-running segment gets this -- upcoming
                   and past segments have no "remaining" to speak of. -->
              <div v-if="isCurrentAgendaEvent(event, now)" class="mt-1" style="max-width: 220px">
                <v-progress-linear
                  color="orange"
                  height="4"
                  :model-value="remainingPercent(event)"
                  rounded
                />

                <div class="text-caption text-secondary mt-1">{{ minutesRemaining(event) }} min left</div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import type { AgendaEvent } from '@/stores/app';
import { storeToRefs } from 'pinia';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { isCurrentAgendaEvent, parseAgendaDateTime } from '@/composables/useAgendaTiming.ts';
import { useDarkMode } from '@/composables/useDarkMode.ts';
import { useAppStore } from '@/stores/app';

const { isDark } = useDarkMode();

// Persisted so a listener who left this open (or closed it) doesn't have to
// redo that on every visit -- same reasoning as AudioStream's stored volume.
const EXPANDED_STORAGE_KEY = 'RADIO_SCHEDULE_EXPANDED';
const expanded = ref(localStorage.getItem(EXPANDED_STORAGE_KEY) === 'true');

function toggle() {
  expanded.value = !expanded.value;
  localStorage.setItem(EXPANDED_STORAGE_KEY, String(expanded.value));
}

// Drives both isCurrentAgendaEvent's highlight and the remaining-time bar
// below -- without a reactive "now," neither would ever update after the
// initial render, since evaluating `new Date()` inside a template
// expression doesn't itself trigger a re-render as time passes.
const now = ref(new Date());
let nowInterval: number | null = null;
onMounted(() => {
  nowInterval = window.setInterval(() => {
    now.value = new Date();
  }, 30_000);
});
onUnmounted(() => {
  if (nowInterval !== null) clearInterval(nowInterval);
});

function remainingPercent(event: AgendaEvent): number {
  const start = parseAgendaDateTime(event.date, event.time).getTime();
  const end = parseAgendaDateTime(event.date, event.time, true).getTime();
  const total = end - start;
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, ((now.value.getTime() - start) / total) * 100));
}

function minutesRemaining(event: AgendaEvent): number {
  const end = parseAgendaDateTime(event.date, event.time, true).getTime();
  return Math.max(0, Math.round((end - now.value.getTime()) / 60_000));
}

const { agenda: events } = storeToRefs(useAppStore());

// Only show events that have not ended yet
// Reactive on the ticking `now` above (not a local `new Date()`), so an
// event that just ended drops out of the list on its own instead of only
// updating the next time `events` itself changes.
const upcomingEvents = computed(() => {
  return events.value.filter((event) => {
    const end = parseAgendaDateTime(event.date, event.time, true);
    return now.value < end;
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
</script>

<style scoped>
.current-event {
  border: 3px solid #ff9800 !important;
  box-shadow: 0 0 0 2px #fff176;
}

/* A single-row grid track transitions smoothly between 0fr and 1fr, which
   is what actually makes this grow/shrink by real height (not just a
   height snap) -- min-height: 0 on the grid item is required for the 0fr
   state to collapse below its content's natural height at all, and
   overflow: hidden on the grid container clips whatever hasn't animated
   into view yet. Paired with a scale + fade on the inner content so it
   reads as growing into place rather than a flat height slide. */
.schedule-panel {
  display: grid;
  grid-template-rows: 0fr;
  overflow: hidden;
  transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.schedule-panel--open {
  grid-template-rows: 1fr;
}

.schedule-panel__inner {
  /* No padding/margin here, even conditionally-zero ones: both are added on
     top of whatever height min-height: 0 lets the content shrink to, so
     *any* fixed top spacing on this element -- margin or padding -- puts a
     permanent floor under the collapsed height that 0fr can never close.
     The 16px gap only exists as padding-top once --open is added below, so
     collapsed really is 0, not 16px of "collapsed" padding. */
  min-height: 0;
  opacity: 0;
  transform: scale(0.95);
  transform-origin: top center;
  transition:
    opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    padding-top 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.schedule-panel--open .schedule-panel__inner {
  padding-top: 16px;
  opacity: 1;
  transform: scale(1);
}

@media (prefers-reduced-motion: reduce) {
  .schedule-panel,
  .schedule-panel__inner {
    transition: none;
  }
}
</style>
