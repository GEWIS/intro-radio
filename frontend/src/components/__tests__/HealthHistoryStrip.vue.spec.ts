import { describe, expect, it } from 'vitest';
import HealthHistoryStrip from '@/components/HealthHistoryStrip.vue';
import { mountWithVuetify } from '@/test-utils';

describe('HealthHistoryStrip', () => {
  it('renders one segment per history sample', () => {
    const history = [
      { ts: 0, healthy: true },
      { ts: 1000, healthy: false },
      { ts: 2000, healthy: true },
    ];
    const wrapper = mountWithVuetify(HealthHistoryStrip, { props: { history } });

    expect(wrapper.findAll('[title]')).toHaveLength(3);
  });

  it('colors a healthy sample differently from an unhealthy one', () => {
    const history = [
      { ts: 0, healthy: true },
      { ts: 1000, healthy: false },
    ];
    const wrapper = mountWithVuetify(HealthHistoryStrip, { props: { history } });

    const segments = wrapper.findAll('[title]');
    expect(segments[0].attributes('style')).toContain('--v-theme-success');
    expect(segments[1].attributes('style')).toContain('--v-theme-error');
  });

  it('labels each segment with its time and up/down state', () => {
    const history = [{ ts: new Date('2026-08-15T10:30:00').getTime(), healthy: false }];
    const wrapper = mountWithVuetify(HealthHistoryStrip, { props: { history } });

    expect(wrapper.get('[title]').attributes('title')).toContain('down');
  });

  it('renders nothing when there is no history yet', () => {
    const wrapper = mountWithVuetify(HealthHistoryStrip, { props: { history: [] } });

    expect(wrapper.findAll('[title]')).toHaveLength(0);
  });
});
