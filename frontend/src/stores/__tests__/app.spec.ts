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
