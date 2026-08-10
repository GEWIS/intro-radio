import type { AgendaEvent } from '@/stores/app';
import { computed, ref, toRaw } from 'vue';

export function emptyAgendaEvent(): AgendaEvent {
  return { title: '', subtitle: '', icon: '', iconColor: '', color: '', colorDark: '', date: '', time: '' };
}

/**
 * Local, unsaved editing state for the agenda admin page: a working copy
 * of the event list plus add/edit/delete/reorder, and dirty-tracking
 * against the last-saved snapshot so the page only offers "Save changes"
 * when there's something to save. Nothing here touches the network --
 * that's the caller's job (see backoffice/agenda.vue).
 */
export function useAgendaEditor(initial: AgendaEvent[]) {
  // toRaw() before every structuredClone() call in this file is load-bearing,
  // not a leftover: structuredClone() throws DataCloneError on a Vue reactive
  // Proxy (e.g. a ref's .value, or a prop backed by reactive store state),
  // even though Array.isArray() reports true for it. JSON.stringify has no
  // such issue, which is why isDirty's comparison below needs no such fix.
  const saved = ref<AgendaEvent[]>(structuredClone(toRaw(initial)));
  const events = ref<AgendaEvent[]>(structuredClone(toRaw(initial)));

  const isDirty = computed(() => JSON.stringify(events.value) !== JSON.stringify(saved.value));

  function add() {
    events.value.push(emptyAgendaEvent());
    return events.value.length - 1;
  }

  function update(index: number, patch: Partial<AgendaEvent>) {
    const current = events.value[index];
    if (!current) return;
    // Mutate in place rather than replacing the array slot: callers (e.g.
    // AgendaEditor.vue) may hold a reference to this exact object to track
    // which row is expanded, and that reference needs to stay valid across
    // an update, the same way it already does across a plain v-model edit.
    Object.assign(current, patch);
  }

  function remove(index: number) {
    events.value.splice(index, 1);
  }

  function moveUp(index: number) {
    if (index <= 0) return;
    const copy = events.value;
    [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]];
  }

  function moveDown(index: number) {
    if (index >= events.value.length - 1) return;
    const copy = events.value;
    [copy[index], copy[index + 1]] = [copy[index + 1], copy[index]];
  }

  function markSaved(newEvents: AgendaEvent[]) {
    saved.value = structuredClone(toRaw(newEvents));
    events.value = structuredClone(toRaw(newEvents));
  }

  function reset() {
    events.value = structuredClone(toRaw(saved.value));
  }

  return { events, isDirty, add, update, remove, moveUp, moveDown, markSaved, reset };
}
