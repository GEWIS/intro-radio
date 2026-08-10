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
        ok: true,
        json: () => Promise.resolve(events),
      }),
    );

    const store = useAppStore();
    const result = await store.fetchAgenda();

    expect(result).toEqual(events);
    expect(store.agenda).toEqual(events);
  });

  // The two failure cases below both matter because backoffice/agenda.vue
  // saves the agenda back as a whole-list PUT: if a failed fetch resolved to
  // an empty (or garbage) list, the editor would open on it and the next
  // save would overwrite the real schedule. `undefined` is the signal that
  // nothing loaded, and the page refuses to mount the editor on it.
  it('returns undefined and leaves the agenda untouched on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.resolve([]),
      }),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = useAppStore();
    const result = await store.fetchAgenda();

    expect(result).toBeUndefined();
    expect(store.agenda).toEqual([]);
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it('still resolves truthy for a legitimately empty schedule', async () => {
    // backoffice/agenda.vue distinguishes "did not load" from "loaded and
    // is empty" purely on truthiness, so an admin who deletes every event
    // must not get the load-error screen on their next visit.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      }),
    );

    const store = useAppStore();
    const result = await store.fetchAgenda();

    expect(result).toBeTruthy();
    expect(result).toEqual([]);
  });

  it('returns undefined when a 200 body is not an array', async () => {
    // What a proxy serving an HTML error page with a 200 looks like here.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: 'gateway' }),
      }),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = useAppStore();
    const result = await store.fetchAgenda();

    expect(result).toBeUndefined();
    expect(store.agenda).toEqual([]);

    consoleError.mockRestore();
  });
});
