import { beforeEach, describe, expect, it } from 'vitest';
import { stripTokenParamFromUrl } from '../useGewisAuth';

describe('stripTokenParamFromUrl', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/backoffice?token=abc123&key=def456');
  });

  it('removes only the token param and keeps sibling params like key', () => {
    stripTokenParamFromUrl();

    const params = new URLSearchParams(window.location.search);
    expect(params.has('token')).toBe(false);
    expect(params.get('key')).toBe('def456');
  });

  it('keeps the path and hash intact', () => {
    window.history.pushState({}, '', '/backoffice?token=abc123&key=def456#section');

    stripTokenParamFromUrl();

    expect(window.location.pathname).toBe('/backoffice');
    expect(window.location.hash).toBe('#section');
  });
});
