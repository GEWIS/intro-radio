import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../app';

describe('useAppStore.fetchToken', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the response body directly, since GET /api/v1/token returns a bare string', async () => {
    const bareToken = 'gewis-radio';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve(bareToken),
      }),
    );

    const store = useAppStore();
    const result = await store.fetchToken();

    expect(result).toBe(bareToken);
    expect(store.token).toBe(bareToken);
  });
});

describe('useAppStore.fetchAgenda', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('populates agenda from the response body', async () => {
    const events = [
      {
        title: 'T',
        subtitle: 'S',
        icon: 'mdi-star',
        iconColor: 'blue',
        color: '#fff',
        colorDark: '#000',
        date: '2026-01-01',
        time: '9:00 - 10:00',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve(events),
      }),
    );

    const store = useAppStore();
    const result = await store.fetchAgenda();

    expect(result).toEqual(events);
    expect(store.agenda).toEqual(events);
  });
});
