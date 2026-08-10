import { describe, expect, it } from 'vitest';
import { AGENDA_ICON_CATALOG, filterIcons } from '../agendaIconCatalog';

describe('filterIcons', () => {
  it('returns the full catalog for an empty query', () => {
    expect(filterIcons('')).toEqual(AGENDA_ICON_CATALOG);
  });

  it('filters case-insensitively by substring', () => {
    const result = filterIcons('BEER');
    expect(result).toContain('mdi-beer');
    expect(result.every((icon) => icon.includes('beer'))).toBe(true);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterIcons('zzz-nonexistent')).toEqual([]);
  });
});
