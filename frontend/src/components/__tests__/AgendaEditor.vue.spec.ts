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
});
