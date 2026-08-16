import type { AgendaEvent } from '@/stores/app';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgendaEditor from '@/components/AgendaEditor.vue';
import { mountWithVuetify } from '@/test-utils';

function makeEvent(title: string, date: string, time = '9:00 - 10:00'): AgendaEvent {
  return { title, subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date, time };
}

function pencilButtons(wrapper: ReturnType<typeof mountWithVuetify>) {
  return wrapper.findAll('button').filter((b) => b.html().includes('mdi-pencil'));
}

function deleteButtons(wrapper: ReturnType<typeof mountWithVuetify>) {
  return wrapper.findAll('button').filter((b) => b.html().includes('mdi-delete'));
}

describe('AgendaEditor', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    // AgendaEditor.vue calls the real useDarkMode() (not mocked -- out of
    // scope for this task) to decide the expanded row's background; that
    // composable's onMounted hook reaches for window.matchMedia, which
    // jsdom does not implement at all. Without this stub, mounting the
    // component throws before any test-specific assertion ever runs.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one collapsed card per initial event', () => {
    const wrapper = mountWithVuetify(AgendaEditor, {
      props: { initial: [makeEvent('First', '2026-01-01'), makeEvent('Second', '2026-01-02')] },
    });

    expect(wrapper.text()).toContain('First');
    expect(wrapper.text()).toContain('Second');
    // Text fields (title/subtitle/date/time) only render for the expanded
    // row -- no inputs at all is this component's signal that nothing is
    // currently expanded (it never uses a <form> element).
    expect(wrapper.findAll('input')).toHaveLength(0);
  });

  it('expands a card to show its edit form on pencil click, and only that one', async () => {
    const wrapper = mountWithVuetify(AgendaEditor, {
      props: { initial: [makeEvent('First', '2026-01-01'), makeEvent('Second', '2026-01-02')] },
    });

    await pencilButtons(wrapper)[0].trigger('click');

    const titleInputs = wrapper.findAll('input').filter((i) => (i.element as HTMLInputElement).value === 'First');
    expect(titleInputs).toHaveLength(1);
    // The second row stays collapsed -- its title never appears in an input.
    const secondTitleInputs = wrapper.findAll('input').filter((i) => (i.element as HTMLInputElement).value === 'Second');
    expect(secondTitleInputs).toHaveLength(0);
  });

  it('adds a new event, expands it immediately, and it validates with just a title', async () => {
    const wrapper = mountWithVuetify(AgendaEditor, { props: { initial: [] } });

    await wrapper.get('button').trigger('click'); // "Add event" is the only button when the list starts empty

    const titleInput = wrapper.get('input');
    expect((titleInput.element as HTMLInputElement).value).toBe('');
    // The new row is expanded (has a Done button) rather than sitting collapsed.
    expect(wrapper.text()).toContain('Done');
  });

  it('sorts and collapses the row on Done', async () => {
    const wrapper = mountWithVuetify(AgendaEditor, {
      props: { initial: [makeEvent('Later', '2026-02-01'), makeEvent('Earlier', '2026-01-01')] },
    });

    await pencilButtons(wrapper)[0].trigger('click'); // expand "Later"

    await wrapper.findAll('button').find((b) => b.text() === 'Done')?.trigger('click');

    const cardTitles = wrapper.findAll('.v-card-title').map((el) => el.text());
    expect(cardTitles.indexOf('Earlier')).toBeLessThan(cardTitles.indexOf('Later'));
  });

  it('removes an event after confirming, and does nothing if the confirm is declined', async () => {
    const confirmMock = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal('confirm', confirmMock);
    const wrapper = mountWithVuetify(AgendaEditor, { props: { initial: [makeEvent('Removable', '2026-01-01')] } });

    const deleteBtn = deleteButtons(wrapper)[0];
    await deleteBtn.trigger('click'); // declined
    expect(wrapper.text()).toContain('Removable');

    await deleteBtn.trigger('click'); // confirmed
    expect(wrapper.text()).not.toContain('Removable');
  });

  it('groups events under one day header per distinct date, in list order', () => {
    const wrapper = mountWithVuetify(AgendaEditor, {
      props: {
        initial: [
          makeEvent('Morning show', '2026-01-01'),
          makeEvent('Evening show', '2026-01-01'),
          makeEvent('Next day show', '2026-01-02'),
        ],
      },
    });

    // Two distinct dates -> exactly two day headers, not one per event --
    // proves same-day events share a header instead of getting one each.
    // (The header's exact localized text depends on ICU data that may not
    // be available in every test environment, so this checks the *count*
    // rather than asserting specific "januari"/weekday wording.)
    expect(wrapper.findAll('.agenda-day-header')).toHaveLength(2);

    const text = wrapper.text();
    expect(text.indexOf('Morning show')).toBeLessThan(text.indexOf('Next day show'));
    expect(text.indexOf('Evening show')).toBeLessThan(text.indexOf('Next day show'));
  });

  it('shows every card\'s own background color, not just the expanded one', () => {
    const wrapper = mountWithVuetify(AgendaEditor, {
      props: { initial: [{ ...makeEvent('First', '2026-01-01'), color: '#ff00ff', colorDark: '#000000' }] },
    });

    const card = wrapper.find('.agenda-card');
    // jsdom normalizes an inline hex background to its rgb() equivalent.
    expect(card.attributes('style')).toContain('rgb(255, 0, 255)');
  });

  it('edits date and time through native date/time inputs, keeping the "H:MM - H:MM" storage shape', async () => {
    const wrapper = mountWithVuetify(AgendaEditor, {
      props: { initial: [makeEvent('First', '2026-01-01', '9:00 - 10:00')] },
    });

    await pencilButtons(wrapper)[0].trigger('click');

    const dateInput = wrapper.get('input[type="date"]');
    expect((dateInput.element as HTMLInputElement).value).toBe('2026-01-01');

    // A native time input silently blanks itself on a non-zero-padded hour
    // ("9:00"), so these must come back zero-padded even though the
    // underlying stored value ("9:00 - 10:00") isn't.
    const timeInputs = wrapper.findAll('input[type="time"]');
    expect(timeInputs).toHaveLength(2);
    expect((timeInputs[0].element as HTMLInputElement).value).toBe('09:00');
    expect((timeInputs[1].element as HTMLInputElement).value).toBe('10:00');

    await timeInputs[0].setValue('09:30');
    // Re-querying after the update reflects the same underlying event object
    // AgendaEditor tracks by reference -- there is no separate "commit" step.
    expect((wrapper.findAll('input[type="time"]')[0].element as HTMLInputElement).value).toBe('09:30');
  });

  it('shows an inline "Required" message for a blank title, which clears once filled in', async () => {
    const wrapper = mountWithVuetify(AgendaEditor, { props: { initial: [] } });

    await wrapper.get('button').trigger('click'); // "Add event" on an empty list
    const titleInput = wrapper.get('input');
    // Vuetify only validates on a real focus-then-blur transition, not on
    // blur alone (it tracks the field's own isFocused state internally).
    await titleInput.trigger('focus');
    await titleInput.trigger('blur');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Required');

    await titleInput.setValue('Now titled');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).not.toContain('Required');
  });
});
