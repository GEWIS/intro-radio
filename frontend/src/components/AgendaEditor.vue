<template>
  <div>
    <div v-for="group in groupedEvents" :key="group.day">
      <div class="agenda-day-header d-flex align-center ga-2 mt-4 mb-2">
        <v-divider class="flex-grow-1" />
        <span class="text-caption font-weight-bold text-medium-emphasis">{{ formatDayHeader(group.day) }}</span>
        <v-divider class="flex-grow-1" />
      </div>

      <v-card
        v-for="{ event, index } in group.items"
        :key="event as unknown as PropertyKey"
        class="agenda-card mb-2"
        :elevation="index === expandedIndex ? 6 : 0"
        :style="{ background: isDark ? event.colorDark : event.color }"
        variant="outlined"
      >
        <v-card-item v-if="expandedIndex !== index">
          <template #prepend>
            <v-icon :color="event.iconColor">{{ event.icon || 'mdi-help-circle-outline' }}</v-icon>
          </template>

          <v-card-title>{{ event.title || '(untitled event)' }}</v-card-title>
          <v-card-subtitle>{{ event.date }} &middot; {{ event.time }}</v-card-subtitle>

          <template #append>
            <v-btn icon="mdi-pencil" size="small" variant="text" @click="expandedEvent = event" />
            <v-btn icon="mdi-delete" size="small" variant="text" @click="confirmRemove(index)" />
          </template>
        </v-card-item>

        <v-card-text v-if="expandedIndex !== index && event.subtitle" class="pt-0 text-body-2">
          {{ event.subtitle }}
        </v-card-text>

        <v-card-text v-if="expandedIndex === index">
          <v-text-field v-model="event.title" density="compact" label="Title" :rules="[requiredRule]" />
          <v-text-field v-model="event.subtitle" density="compact" label="Subtitle" />

          <div class="d-flex ga-2 flex-wrap">
            <v-text-field v-model="event.date" density="compact" label="Date" :rules="[dateRule]" type="date" />

            <v-text-field
              density="compact"
              label="Start time"
              :model-value="startTimeOf(event)"
              :rules="[timeRule]"
              type="time"
              @update:model-value="(v: string) => setStartTime(event, v)"
            />

            <v-text-field
              density="compact"
              label="End time"
              :model-value="endTimeOf(event)"
              :rules="[timeRule]"
              type="time"
              @update:model-value="(v: string) => setEndTime(event, v)"
            />
          </div>

          <IconColorPicker :model-value="event" @update:model-value="(v) => editor.update(index, v)" />

          <div class="d-flex justify-end mt-2">
            <v-btn variant="text" @click="finishEditing">Done</v-btn>
          </div>
        </v-card-text>
      </v-card>
    </div>

    <v-btn prepend-icon="mdi-plus" variant="tonal" @click="addEvent">Add event</v-btn>
  </div>
</template>

<script setup lang="ts">
import type { AgendaEvent } from '@/stores/app';
import { computed, ref } from 'vue';
import IconColorPicker from '@/components/IconColorPicker.vue';
import { useAgendaEditor } from '@/composables/useAgendaEditor';
import { useDarkMode } from '@/composables/useDarkMode';

const props = defineProps<{
  initial: AgendaEvent[];
}>();

const editor = useAgendaEditor(props.initial);
const { events } = editor;
const { isDark } = useDarkMode();

// Tracked by object identity, not array position. Events are distinct
// objects, so holding the expanded one directly (instead of its index)
// means the open editor pane stays attached to the right event across a
// sort() and neighboring deletes -- useAgendaEditor's update() mutates
// events in place rather than replacing them, so this reference also
// survives edits made through IconColorPicker. The `:key` above relies on
// the same guarantee: sort()/add()/remove() never clone existing event
// objects (only markSaved()/reset() do, and neither is called from here),
// so Vue's Map-based, reference-equality key diffing (see
// patchKeyedChildren/isSameVNodeType in @vue/runtime-core) keeps each
// row's identity stable across a resort too. The `as unknown as PropertyKey`
// cast is type-only -- values pass through unchanged at runtime -- and is
// needed only because the `key` prop's own .d.ts type is `PropertyKey`,
// narrower than what the diffing algorithm actually accepts.
const expandedEvent = ref<AgendaEvent | null>(null);
const expandedIndex = computed(() => (expandedEvent.value ? events.value.indexOf(expandedEvent.value) : -1));

// `expandedEvent` (read) and `setExpandedEvent` (write) are exposed
// alongside `editor` so a caller's save() can carry the open row across a
// save: useAgendaEditor's markSaved() replaces `events` with freshly cloned
// objects (see its own comment for why), which would otherwise silently
// collapse whatever row is open -- not just the one being edited, but any
// row left expanded while the caller batches up several edits before
// saving. A setter is exposed rather than the bare ref because Vue's
// defineExpose proxy unwraps top-level refs on read (the same auto-unwrap
// template refs get), so a caller reading `editorRef.value.expandedEvent`
// sees the current value directly -- but assigning `editorRef.value
// .expandedEvent = x` from outside would set that unwrapped property, not
// the ref, and never reach this component's actual state.
defineExpose({ editor, expandedEvent, setExpandedEvent: (event: AgendaEvent | null) => (expandedEvent.value = event) });

// Groups the event list into contiguous same-day runs for the day-header
// dividers above. Relies on the same "the list is sorted before it needs
// to display correctly" invariant sort()/finishEditing() already maintain
// elsewhere in this file -- a run of matching dates is never split across
// two groups in practice, so this is a single linear pass rather than a
// full group-by-then-resort.
type EventRow = { event: AgendaEvent; index: number };
const groupedEvents = computed(() => {
  const groups: { day: string; items: EventRow[] }[] = [];
  for (const [index, event] of events.value.entries()) {
    const last = groups.at(-1);
    if (last && last.day === event.date) {
      last.items.push({ event, index });
    } else {
      groups.push({ day: event.date, items: [{ event, index }] });
    }
  }
  return groups;
});

function formatDayHeader(day: string) {
  const parsed = new Date(day);
  // Still typing a new date (or it hasn't been entered yet) -- show the raw
  // value rather than "Invalid Date" until it becomes parseable.
  if (Number.isNaN(parsed.getTime())) return day || '(no date yet)';
  return parsed.toLocaleDateString(['nl-NL'], { weekday: 'long', day: 'numeric', month: 'long' });
}

// Inline feedback for the expanded editor's fields, shown live as an admin
// types rather than only surfacing as a 400 once they hit Save (see
// backend/agenda.go's validateAgendaEvent, which these mirror).
const requiredRule = (v: string) => !!v?.trim() || 'Required';
const dateRule = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) || 'Pick a date';
const timeRule = (v: string) => /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(v) || 'Pick a time';

// event.time is stored as a single "H:MM - H:MM" string (see
// backend/agenda.go's AgendaEvent.Time doc comment, and its
// timeRangePattern, which accepts an hour with or without a leading zero),
// but a native <input type="time"> silently *blanks itself* if fed a
// non-zero-padded hour like "9:00" -- the HTML spec requires a strictly
// valid "HH:MM" value, so existing data (or anything typed by hand before
// this UI added pickers) would otherwise appear empty despite being there.
// Padding here is display-only; setStartTime/setEndTime below don't need
// the inverse, since a zero-padded "09:00 - 10:00" is equally valid input
// to the backend's own pattern.
function normalizeTimeForInput(raw: string): string {
  const [h, m] = raw.split(':');
  if (h === undefined || m === undefined) return '';
  return `${h.padStart(2, '0')}:${m}`;
}
function startTimeOf(event: AgendaEvent) {
  return normalizeTimeForInput(event.time.split(' - ', 1)[0] ?? '');
}
function endTimeOf(event: AgendaEvent) {
  return normalizeTimeForInput(event.time.split(' - ', 2)[1] ?? '');
}
function setStartTime(event: AgendaEvent, value: string) {
  event.time = `${value} - ${endTimeOf(event)}`;
}
function setEndTime(event: AgendaEvent, value: string) {
  event.time = `${startTimeOf(event)} - ${value}`;
}

function addEvent() {
  // Capture the newly-created event by reference before sorting: its index
  // is only valid pre-sort, and re-reading events.value[index] afterwards
  // could resolve to a different event once the array reorders.
  const index = editor.add();
  const created = events.value[index];
  editor.sort();
  expandedEvent.value = created;
}

function confirmRemove(index: number) {
  if (window.confirm(`Delete "${events.value[index].title || 'this event'}"?`)) {
    editor.remove(index);
  }
}

// Sort before collapsing, not on every keystroke: resorting a row while
// it's still expanded would yank it out from under whoever's editing it.
// Waiting until "Done" lets the row visibly settle into its correct
// position as the admin finishes, rather than while they're still typing.
function finishEditing() {
  editor.sort();
  expandedEvent.value = null;
}
</script>

<style scoped>
/* Cards now always show their real color/colorDark background (not just the
   expanded row -- see the template above), so a color-picker edit or a
   light/dark toggle should ease into place rather than snap; the hover lift
   is a cheap affordance that this list is interactive, not static text. */
.agenda-card {
  transition:
    background-color 0.25s ease,
    box-shadow 0.2s ease,
    transform 0.15s ease;
}
.agenda-card:hover {
  transform: translateY(-2px);
}
</style>
