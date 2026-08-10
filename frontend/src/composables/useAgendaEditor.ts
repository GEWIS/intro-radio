import type { AgendaEvent } from '@/stores/app';
import { computed, ref, toRaw } from 'vue';

/**
 * Today in YYYY-MM-DD, in the *local* timezone. Deliberately not
 * `toISOString().slice(0, 10)`: that formats in UTC, so anyone in CEST
 * adding an event after midnight would get yesterday's date prefilled.
 */
function todayLocalISODate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * A blank-but-valid new event. Every field is prefilled rather than left
 * empty on purpose: backend/agenda.go's validateAgendaEvent rejects an
 * empty icon or iconColor and demands 6-digit hex for color/colorDark, so
 * an all-empty event makes the most obvious first-use flow (add an event,
 * type a title and a time, save) fail with a 400 that no amount of
 * retrying can clear. The defaults below are chosen to pass that
 * validation as-is -- keep them in sync with it.
 *
 * iconColor is a hex value rather than a theme name like 'primary' even
 * though the backend accepts either: IconColorPicker edits it with a
 * v-color-picker, and Vuetify's parseColor console-warns twice on any
 * string it can't read as hex. #1867C0 is Vuetify's own default primary.
 */
export function emptyAgendaEvent(): AgendaEvent {
  return {
    title: '',
    subtitle: '',
    icon: 'mdi-calendar-star',
    iconColor: '#1867C0',
    color: '#FFFFFF',
    colorDark: '#000000',
    date: todayLocalISODate(),
    time: '9:00 - 10:00',
  };
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

  // Unlike update() above, markSaved and reset both replace *every* event
  // with a fresh clone, so no reference a caller was holding into `events`
  // survives them. Anything tracking an event by object identity (e.g.
  // AgendaEditor.vue's expanded row) has to re-resolve it afterwards --
  // backoffice/agenda.vue's save() does that by capturing the expanded
  // event's position first and re-expanding by position after.

  function markSaved(newEvents: AgendaEvent[]) {
    saved.value = structuredClone(toRaw(newEvents));
    events.value = structuredClone(toRaw(newEvents));
  }

  function reset() {
    events.value = structuredClone(toRaw(saved.value));
  }

  return { events, isDirty, add, update, remove, moveUp, moveDown, markSaved, reset };
}
