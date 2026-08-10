<template>
  <div>
    <v-card v-for="(event, index) in events" :key="event as unknown as PropertyKey" class="mb-2" variant="outlined">
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
        <v-text-field v-model="event.title" density="compact" label="Title" />
        <v-text-field v-model="event.subtitle" density="compact" label="Subtitle" />

        <div class="d-flex ga-2">
          <v-text-field v-model="event.date" density="compact" hint="YYYY-MM-DD" label="Date" persistent-hint />
          <v-text-field v-model="event.time" density="compact" hint='e.g. "9:00 - 10:00"' label="Time range" persistent-hint />
        </div>

        <IconColorPicker :model-value="event" @update:model-value="(v) => editor.update(index, v)" />

        <div class="d-flex justify-end mt-2">
          <v-btn variant="text" @click="finishEditing">Done</v-btn>
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
