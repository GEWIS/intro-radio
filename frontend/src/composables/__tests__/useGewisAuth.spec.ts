import { beforeEach, describe, expect, it } from 'vitest';
import { resolveReturnPath, stripTokenParamFromUrl } from '../useGewisAuth';

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

describe('resolveReturnPath', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('returns null when nothing was saved', () => {
    expect(resolveReturnPath(null)).toBeNull();
  });

  it('returns null when the saved path is already where we are', () => {
    window.history.pushState({}, '', '/backoffice/agenda');
    expect(resolveReturnPath('/backoffice/agenda')).toBeNull();
  });

  it('returns the saved path when it differs from the current one', () => {
    window.history.pushState({}, '', '/');
    expect(resolveReturnPath('/backoffice/agenda')).toBe('/backoffice/agenda');
  });

  it('compares against the full path, including query and hash', () => {
    window.history.pushState({}, '', '/backoffice/agenda?key=abc#section');
    expect(resolveReturnPath('/backoffice/agenda?key=abc#section')).toBeNull();
    expect(resolveReturnPath('/backoffice/agenda?key=xyz#section')).toBe('/backoffice/agenda?key=xyz#section');
  });
});
