import type { AgendaEvent } from '@/stores/app';
import { describe, expect, it } from 'vitest';
import { emptyAgendaEvent, useAgendaEditor } from '../useAgendaEditor';

function makeEvent(title: string, date = '2026-01-01', time = '9:00 - 10:00'): AgendaEvent {
  return {
    title,
    subtitle: '',
    icon: 'mdi-star',
    iconColor: 'blue',
    color: '#fff',
    colorDark: '#000',
    date,
    time,
  };
}

describe('emptyAgendaEvent', () => {
  // Mirrors backend/agenda.go's validateAgendaEvent. A newly added event
  // has to clear that validation with nothing filled in but a title, or
  // else "add event, type a title, save" 400s and no retry ever fixes it.
  it('produces an event the backend accepts without further editing', () => {
    const event = emptyAgendaEvent();

    expect(event.icon).not.toBe('');
    expect(event.iconColor).not.toBe('');
    expect(event.color).toMatch(/^#[\da-f]{6}$/i);
    expect(event.colorDark).toMatch(/^#[\da-f]{6}$/i);
    expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(event.time).toMatch(/^\d{1,2}:\d{2} - \d{1,2}:\d{2}$/);
  });

  it("defaults the date to today in the user's own timezone", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    expect(emptyAgendaEvent().date).toBe(expected);
  });
});

describe('useAgendaEditor', () => {
  it('starts not dirty', () => {
    const editor = useAgendaEditor([makeEvent('A')]);
    expect(editor.isDirty.value).toBe(false);
  });

  it('becomes dirty after an edit and clean again after reset', () => {
    const editor = useAgendaEditor([makeEvent('A')]);
    editor.update(0, { title: 'Changed' });
    expect(editor.isDirty.value).toBe(true);

    editor.reset();
    expect(editor.isDirty.value).toBe(false);
    expect(editor.events.value[0].title).toBe('A');
  });

  it('add appends a blank event and marks dirty', () => {
    const editor = useAgendaEditor([makeEvent('A')]);
    const index = editor.add();

    expect(index).toBe(1);
    expect(editor.events.value).toHaveLength(2);
    expect(editor.isDirty.value).toBe(true);
  });

  it('remove drops the event at the given index', () => {
    const editor = useAgendaEditor([makeEvent('A'), makeEvent('B')]);
    editor.remove(0);
    expect(editor.events.value.map((e) => e.title)).toEqual(['B']);
  });

  it('sort orders events by date, then by start time within a date', () => {
    const editor = useAgendaEditor([
      makeEvent('late-on-2nd', '2026-01-02', '20:00 - 21:00'),
      makeEvent('early-on-1st', '2026-01-01', '9:00 - 10:00'),
      makeEvent('early-on-2nd', '2026-01-02', '8:00 - 09:00'),
      makeEvent('late-on-1st', '2026-01-01', '18:00 - 19:00'),
    ]);

    editor.sort();

    expect(editor.events.value.map((e) => e.title)).toEqual([
      'early-on-1st',
      'late-on-1st',
      'early-on-2nd',
      'late-on-2nd',
    ]);
  });

  it('sort keeps the original relative order for a tie on date and start time', () => {
    // Array.prototype.sort is stable since ES2019, so two events with an
    // identical (date, start-of-time) key must not swap places.
    const editor = useAgendaEditor([
      makeEvent('first', '2026-01-01', '9:00 - 10:00'),
      makeEvent('second', '2026-01-01', '9:00 - 11:00'),
    ]);

    editor.sort();

    expect(editor.events.value.map((e) => e.title)).toEqual(['first', 'second']);
  });

  it('sort is a no-op on an already-sorted list', () => {
    const editor = useAgendaEditor([
      makeEvent('first', '2026-01-01', '9:00 - 10:00'),
      makeEvent('second', '2026-01-02', '9:00 - 10:00'),
    ]);

    editor.sort();

    expect(editor.events.value.map((e) => e.title)).toEqual(['first', 'second']);
  });

  it('sort is a no-op on an empty list', () => {
    const editor = useAgendaEditor([]);
    editor.sort();
    expect(editor.events.value).toEqual([]);
  });

  it('markSaved resets the dirty baseline', () => {
    const editor = useAgendaEditor([makeEvent('A')]);
    editor.update(0, { title: 'Changed' });
    editor.markSaved(editor.events.value);
    expect(editor.isDirty.value).toBe(false);
  });

  it('update mutates the event object in place instead of replacing it', () => {
    // AgendaEditor.vue tracks which row is expanded by holding a reference
    // to the event object itself (see its expandedEvent/expandedIndex), so
    // that reference has to stay valid after an update -- otherwise editing
    // through IconColorPicker (which goes through update()) would silently
    // detach the expanded pane from the row the user is looking at.
    const editor = useAgendaEditor([makeEvent('A'), makeEvent('B')]);
    const before = editor.events.value[1];

    editor.update(1, { title: 'Changed' });

    expect(editor.events.value[1]).toBe(before);
    expect(before.title).toBe('Changed');
  });
});
