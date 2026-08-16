<template>
  <v-container class="py-8" fluid>
    <div class="mx-auto" style="max-width: 1400px">
      <div class="mb-6 text-center">
        <h1 class="text-h4 font-weight-bold gloria-hallelujah-regular">Agenda</h1>
        <div class="text-body-2 text-medium-emphasis mt-2">Manage the radio schedule</div>
      </div>

      <div class="d-flex justify-end mb-2 ga-4">
        <router-link to="/backoffice">Back to chat</router-link>
        <router-link to="/backoffice/dashboard">Dashboard</router-link>
      </div>

      <v-alert v-if="loadError" class="mb-4" type="error">
        Could not load the agenda from the server, so there is nothing safe to edit yet -- opening the editor on an empty
        list would let the next save wipe the real schedule. Nothing has been changed.

        <div class="mt-3">
          <v-btn variant="tonal" @click="load">Retry</v-btn>
        </div>
      </v-alert>

      <AdminKeyGate v-else-if="gate.stage.value !== 'ready'" :gate="gate" />

      <template v-else>
        <v-alert v-if="saveError" class="mb-4" closable type="error" @click:close="saveError = ''">
          {{ saveError }}
        </v-alert>

        <AgendaEditor ref="editorRef" :initial="initialEvents" />

        <v-btn
          v-if="editorRef?.editor.isDirty.value"
          block
          class="mt-4"
          color="primary"
          :disabled="saving"
          :loading="saving"
          @click="save"
        >
          Save changes
        </v-btn>
      </template>
    </div>
  </v-container>
</template>

<script setup lang="ts">
import type { AgendaEvent } from '@/stores/app';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import AdminKeyGate from '@/components/AdminKeyGate.vue';
import AgendaEditor from '@/components/AgendaEditor.vue';
import { useAdminGate } from '@/composables/useAdminGate';
import { useAppStore } from '@/stores/app';

// `gate` is a plain object whose properties are individual refs (it's not
// itself reactive), so template access needs the explicit `.value` you see
// below (e.g. `gate.stage.value`) -- Vue's template auto-unwrap only
// applies to refs that are directly in the top-level script scope, not to
// refs nested inside a returned object's properties.
const gate = useAdminGate();
const appStore = useAppStore();

const saving = ref(false);
const saveError = ref('');
const loadError = ref(false);
const initialEvents = ref<AgendaEvent[]>([]);
const editorRef = ref<InstanceType<typeof AgendaEditor> | null>(null);

async function load() {
  loadError.value = false;

  // Fetch the agenda before resolving the gate, not after: GET /api/v1/agenda
  // is public and needs no auth, and AgendaEditor (via useAgendaEditor) seeds
  // its local editing state from the `initial` prop only once, at the moment
  // it first mounts -- which happens as soon as gate.stage flips to 'ready'.
  // Awaiting gate.init() first would let that mount happen while
  // initialEvents is still its empty placeholder, permanently starting the
  // editor with an empty list even once the real data arrives.
  const loaded = await appStore.fetchAgenda();

  // fetchAgenda resolves to undefined on any failure (see its comment in
  // stores/app.ts). Bail out before the gate resolves rather than mounting
  // the editor on an empty list: saving is a whole-list PUT, so adding one
  // event to a list that only *looks* empty would replace the entire real
  // schedule with it.
  if (!loaded) {
    loadError.value = true;
    return;
  }

  initialEvents.value = loaded;
  await gate.init();
}

onMounted(load);

// Losing in-progress agenda edits is exactly the kind of mistake this guard
// exists to prevent -- "Save changes" only appears once the editor is
// dirty (see the template above), so there was previously nothing stopping
// an admin from clicking "Back to chat"/"Dashboard" (an in-app route
// change) or closing the tab and silently discarding everything.
function hasUnsavedChanges() {
  return editorRef.value?.editor.isDirty.value ?? false;
}

function confirmDiscard() {
  return window.confirm('You have unsaved agenda changes. Leave without saving?');
}

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (!hasUnsavedChanges()) return;
  // Both of these are required for browsers to actually show their native
  // "leave site?" prompt; the string assigned to returnValue is ignored by
  // every modern browser (each shows its own fixed wording) but some older
  // engines historically displayed it, so it's set for completeness.
  e.preventDefault();
  e.returnValue = '';
}

onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', handleBeforeUnload));

// Covers in-app navigation (the "Back to chat"/"Dashboard" router-links
// above) -- beforeunload above only fires on a real page unload (tab
// close, refresh, typing a new URL), not on a client-side route change.
onBeforeRouteLeave(() => {
  if (!hasUnsavedChanges()) return true;
  return confirmDiscard();
});

async function save() {
  if (!editorRef.value) return;
  saving.value = true;
  saveError.value = '';

  // The editor deliberately doesn't resort while a row is expanded (so the
  // list doesn't reshuffle under whoever's typing), but the backend always
  // returns events sorted -- so if a save changes the expanded event's date
  // or time, the pre-save array order can already disagree with the order
  // the response comes back in. Sort first so the position captured below
  // matches the position markSaved() below will end up applying.
  editorRef.value.editor.sort();

  // markSaved() below replaces every event with a freshly cloned object (see
  // its own comment for why), which would otherwise collapse whatever row is
  // expanded -- capture which one by position now, so it can be re-expanded
  // by position afterward, rather than losing that UI state on every save.
  // `expandedEvent` reads as the current value, not a ref (defineExpose
  // unwraps it), which is exactly what indexOf() below needs.
  const eventsBeforeSave = editorRef.value.editor.events.value;
  const wasExpanded = editorRef.value.expandedEvent;
  const expandedIndex = wasExpanded ? eventsBeforeSave.indexOf(wasExpanded) : -1;

  try {
    const res = await fetch('/api/v1/agenda', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: gate.token.value,
        radioKey: gate.radioKey.value,
        events: eventsBeforeSave,
      }),
    });

    if (res.status === 401) {
      // Deliberately *not* gate.dropToNeedKey(): that flips stage off
      // 'ready', which unmounts AgendaEditor and takes every unsaved edit
      // made since page load with it -- not just the one that failed.
      // Re-entering the key wouldn't buy that back either, because
      // useAdminGate captures the GEWIS token once in init() and
      // submitKey() re-validates that same one, so an expired token fails
      // identically every time. A reload is the honest advice; leaving
      // stage alone keeps the editor (and the edits) on screen until then.
      saveError.value =
        'Your session expired. Reload the page to sign in again -- your changes are still here until you do.';
      return;
    }
    if (!res.ok) {
      // Show the backend's own message. A 400 here means one of the events
      // failed validation, and it names which field on which event; the
      // generic "try again" this used to show was actively misleading,
      // since retrying the same invalid event fails the same way forever.
      const detail = (await res.text()).trim();
      saveError.value = detail
        ? `Could not save: ${detail} -- your changes are still here.`
        : 'Could not save the agenda. Your changes are still here -- try again.';
      return;
    }

    const savedEvents: AgendaEvent[] = await res.json();
    editorRef.value.editor.markSaved(savedEvents);
    appStore.agenda = savedEvents;

    if (expandedIndex !== -1) {
      editorRef.value.setExpandedEvent(editorRef.value.editor.events.value[expandedIndex] ?? null);
    }
  } catch {
    saveError.value = 'Could not reach the server. Your changes are still here -- try again.';
  } finally {
    saving.value = false;
  }
}
</script>
