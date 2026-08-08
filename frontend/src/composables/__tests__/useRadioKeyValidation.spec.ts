import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateRadioKeyQuick } from '../useRadioKeyValidation';

describe('validateRadioKeyQuick', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves true when the backend confirms the key is valid', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateRadioKeyQuick('a-token', 'a-key');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/radio-key/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'a-token', radioKey: 'a-key' }),
    });
  });

  it('resolves false on a 401 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );

    const result = await validateRadioKeyQuick('a-token', 'wrong-key');

    expect(result).toBe(false);
  });

  it('resolves false when fetch throws (network failure)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await validateRadioKeyQuick('a-token', 'a-key');

    expect(result).toBe(false);
  });
});
