import { describe, it, expect, beforeEach } from 'vitest';

describe('GM mock smoke test', () => {
  beforeEach(() => __resetGM());

  it('round-trips a value through GM_setValue / GM_getValue', () => {
    GM_setValue('foo', { a: 1 });
    expect(GM_getValue<{ a: number }>('foo')).toEqual({ a: 1 });
  });

  it('returns default when key absent', () => {
    expect(GM_getValue<string>('missing', 'default')).toBe('default');
  });
});
