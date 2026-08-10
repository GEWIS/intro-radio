<template>
  <div>
    <v-card v-for="(event, index) in events" :key="index" class="mb-2" variant="outlined">
      <v-card-item v-if="expandedIndex !== index">
        <template #prepend>
          <v-icon :color="event.iconColor">{{ event.icon || 'mdi-help-circle-outline' }}</v-icon>
        </template>

        <v-card-title>{{ event.title || '(untitled event)' }}</v-card-title>
        <v-card-subtitle>{{ event.date }} &middot; {{ event.time }}</v-card-subtitle>

        <template #append>
          <v-btn :disabled="index === 0" icon="mdi-arrow-up" size="small" variant="text" @click="editor.moveUp(index)" />

          <v-btn
            :disabled="index === events.length - 1"
            icon="mdi-arrow-down"
            size="small"
            variant="text"
            @click="editor.moveDown(index)"
          />

          <v-btn icon="mdi-pencil" size="small" variant="text" @click="expandedEvent = event" />
          <v-btn icon="mdi-delete" size="small" variant="text" @click="confirmRemove(index)" />
        </template>
      </v-card-item>

      <v-card-text v-if="expandedIndex !== index && event.subtitle" class="pt-0 text-body-2">
        {{ event.subtitle }}
      </v-card-text>

      <v-card-text v-if="expandedIndex === index">
        <v-text-field v-model="event.title" density="compact" label="Title" />
        <v-text-field v-model="event.subtitle" density="compact" label="Subtitle" />

        <div class="d-flex ga-2">
          <v-text-field v-model="event.date" density="compact" hint="YYYY-MM-DD" label="Date" persistent-hint />
          <v-text-field v-model="event.time" density="compact" hint='e.g. "9:00 - 10:00"' label="Time range" persistent-hint />
        </div>

        <IconColorPicker :model-value="event" @update:model-value="(v) => editor.update(index, v)" />

        <div class="d-flex justify-end mt-2">
          <v-btn variant="text" @click="expandedEvent = null">Done</v-btn>
        </div>
      </v-card-text>
    </v-card>

    <v-btn prepend-icon="mdi-plus" variant="tonal" @click="addEvent">Add event</v-btn>
  </div>
</template>

<script setup lang="ts">
import type { AgendaEvent } from '@/stores/app';
import { computed, ref } from 'vue';
import IconColorPicker from '@/components/IconColorPicker.vue';
import { useAgendaEditor } from '@/composables/useAgendaEditor';

const props = defineProps<{
  initial: AgendaEvent[];
}>();

const editor = useAgendaEditor(props.initial);
const { events } = editor;

// Tracked by object identity, not array position. Events are distinct
// objects, so holding the expanded one directly (instead of its index)
// means the open editor pane stays attached to the right event across
// reorders and neighboring deletes -- useAgendaEditor's update() mutates
// events in place rather than replacing them, so this reference also
// survives edits made through IconColorPicker.
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

function addEvent() {
  const index = editor.add();
  expandedEvent.value = events.value[index];
}

function confirmRemove(index: number) {
  if (window.confirm(`Delete "${events.value[index].title || 'this event'}"?`)) {
    editor.remove(index);
  }
}
</script>
