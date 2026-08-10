import type { AgendaEvent } from '@/stores/app';
import { describe, expect, it } from 'vitest';
import { emptyAgendaEvent, useAgendaEditor } from '../useAgendaEditor';

function makeEvent(title: string): AgendaEvent {
  return {
    title,
    subtitle: '',
    icon: 'mdi-star',
    iconColor: 'blue',
    color: '#fff',
    colorDark: '#000',
    date: '2026-01-01',
    time: '9:00 - 10:00',
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

  it('moveUp and moveDown swap adjacent events', () => {
    const editor = useAgendaEditor([makeEvent('A'), makeEvent('B'), makeEvent('C')]);
    editor.moveDown(0);
    expect(editor.events.value.map((e) => e.title)).toEqual(['B', 'A', 'C']);

    editor.moveUp(2);
    expect(editor.events.value.map((e) => e.title)).toEqual(['B', 'C', 'A']);
  });

  it('moveUp at index 0 and moveDown at the last index are no-ops', () => {
    const editor = useAgendaEditor([makeEvent('A'), makeEvent('B')]);
    editor.moveUp(0);
    editor.moveDown(1);
    expect(editor.events.value.map((e) => e.title)).toEqual(['A', 'B']);
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
