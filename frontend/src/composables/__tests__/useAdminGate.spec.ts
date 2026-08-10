import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAdminGate } from '../useAdminGate';

// vi.mock() factories are hoisted above regular top-level statements, so a
// plain `const foo = vi.fn()` referenced inside one would still be in its
// TDZ when the factory runs. vi.hoisted() hoists these declarations
// together with the vi.mock() calls below so the factories can see them.
const { ensureTokenMock, validateRadioKeyQuickMock } = vi.hoisted(() => ({
  ensureTokenMock: vi.fn(),
  validateRadioKeyQuickMock: vi.fn(),
}));

vi.mock('@/composables/useGewisAuth', () => ({
  useGewisAuth: () => ({ ensureToken: ensureTokenMock }),
}));
vi.mock('@/composables/useRadioKeyValidation', () => ({
  validateRadioKeyQuick: validateRadioKeyQuickMock,
}));

describe('useAdminGate', () => {
  beforeEach(() => {
    ensureTokenMock.mockReset();
    validateRadioKeyQuickMock.mockReset();
    localStorage.clear();
  });

  it('goes to need-key when no key is stored', async () => {
    ensureTokenMock.mockResolvedValue('a-token');
    const gate = useAdminGate();

    await gate.init();

    expect(gate.stage.value).toBe('need-key');
  });

  it('goes straight to ready when a stored key validates', async () => {
    localStorage.setItem('RADIO_ADMIN_KEY', 'stored-key');
    ensureTokenMock.mockResolvedValue('a-token');
    validateRadioKeyQuickMock.mockResolvedValue(true);

    const gate = useAdminGate();
    await gate.init();

    expect(gate.stage.value).toBe('ready');
    expect(gate.radioKey.value).toBe('stored-key');
  });

  it('falls back to need-key with an error when the stored key fails validation', async () => {
    localStorage.setItem('RADIO_ADMIN_KEY', 'stale-key');
    ensureTokenMock.mockResolvedValue('a-token');
    validateRadioKeyQuickMock.mockResolvedValue(false);

    const gate = useAdminGate();
    await gate.init();

    expect(gate.stage.value).toBe('need-key');
    expect(gate.errorMsg.value).not.toBe('');
  });

  it('submitKey moves to ready and persists the key on success', async () => {
    ensureTokenMock.mockResolvedValue('a-token');
    validateRadioKeyQuickMock.mockResolvedValue(true);

    const gate = useAdminGate();
    gate.token.value = 'a-token';
    const ok = await gate.submitKey('typed-key');

    expect(ok).toBe(true);
    expect(gate.stage.value).toBe('ready');
    expect(localStorage.getItem('RADIO_ADMIN_KEY')).toBe('typed-key');
  });

  it('submitKey reports failure without changing stage on a bad key', async () => {
    ensureTokenMock.mockResolvedValue('a-token');
    validateRadioKeyQuickMock.mockResolvedValue(false);

    const gate = useAdminGate();
    gate.token.value = 'a-token';
    gate.stage.value = 'need-key';
    const ok = await gate.submitKey('wrong-key');

    expect(ok).toBe(false);
    expect(gate.stage.value).toBe('need-key');
    expect(gate.errorMsg.value).not.toBe('');
  });

  it('dropToNeedKey resets stage and sets an error message', () => {
    const gate = useAdminGate();
    gate.stage.value = 'ready';

    gate.dropToNeedKey('key was rotated');

    expect(gate.stage.value).toBe('need-key');
    expect(gate.errorMsg.value).toBe('key was rotated');
  });
});
