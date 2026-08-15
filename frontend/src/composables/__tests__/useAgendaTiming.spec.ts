import type { AgendaEvent } from '@/stores/app';
import { describe, expect, it } from 'vitest';
import { currentAgendaEvent, isCurrentAgendaEvent, parseAgendaDateTime } from '../useAgendaTiming';

function event(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    title: 'Breakfast',
    subtitle: '',
    icon: 'mdi-food',
    iconColor: 'primary',
    color: '#fff',
    colorDark: '#000',
    date: '2026-08-17',
    time: '9:00 - 10:00',
    ...overrides,
  };
}

describe('parseAgendaDateTime', () => {
  it('pads a single-digit hour so Date parsing succeeds', () => {
    const start = parseAgendaDateTime('2026-08-17', '9:00 - 10:00');
    expect(start.getHours()).toBe(9);
    expect(start.getMinutes()).toBe(0);
  });

  it('parses the end of the range when isEnd is true', () => {
    const end = parseAgendaDateTime('2026-08-17', '9:00 - 10:00', true);
    expect(end.getHours()).toBe(10);
  });

  it('advances the end to the next calendar day for an overnight range', () => {
    const start = parseAgendaDateTime('2026-08-17', '20:00 - 08:00');
    const end = parseAgendaDateTime('2026-08-17', '20:00 - 08:00', true);
    expect(end.getDate()).toBe(start.getDate() + 1);
    expect(end.getHours()).toBe(8);
  });
});

describe('isCurrentAgendaEvent', () => {
  it('is true while now falls within the range', () => {
    const now = new Date('2026-08-17T09:30:00');
    expect(isCurrentAgendaEvent(event(), now)).toBe(true);
  });

  it('is false before the range starts', () => {
    const now = new Date('2026-08-17T08:59:00');
    expect(isCurrentAgendaEvent(event(), now)).toBe(false);
  });

  it('is false once the range has ended', () => {
    const now = new Date('2026-08-17T10:00:00');
    expect(isCurrentAgendaEvent(event(), now)).toBe(false);
  });

  it('handles an overnight range correctly after midnight', () => {
    const overnightEvent = event({ time: '20:00 - 08:00' });
    const now = new Date('2026-08-18T02:00:00');
    expect(isCurrentAgendaEvent(overnightEvent, now)).toBe(true);
  });
});

describe('currentAgendaEvent', () => {
  it('returns the event covering now', () => {
    const now = new Date('2026-08-17T09:30:00');
    const events = [event({ title: 'Breakfast' }), event({ title: 'Lunch', time: '12:00 - 13:00' })];
    expect(currentAgendaEvent(events, now)?.title).toBe('Breakfast');
  });

  it('returns null when no event covers now', () => {
    const now = new Date('2026-08-17T11:00:00');
    const events = [event({ title: 'Breakfast' }), event({ title: 'Lunch', time: '12:00 - 13:00' })];
    expect(currentAgendaEvent(events, now)).toBeNull();
  });
});
