import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { recordVisit, listRecent, getMostRecentlyFocused } from '../../src/storage/recent-sf';

describe('recent SF records', () => {
  beforeEach(() => __resetGM());
  afterEach(() => __resetGM());

  it('returns empty list when nothing visited', () => {
    expect(listRecent()).toEqual([]);
  });

  it('records a visit and lists it', () => {
    recordVisit({ id: '006A', name: 'Acme', type: 'Opportunity' });
    const list = listRecent();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('006A');
    expect(list[0].type).toBe('Opportunity');
    expect(typeof list[0].visitedAt).toBe('string');
    expect(typeof list[0].lastFocusedAt).toBe('string');
  });

  it('dedups by id, updating lastFocusedAt on repeat visit', async () => {
    recordVisit({ id: '006A', name: 'Acme', type: 'Opportunity' });
    const firstFocus = listRecent()[0].lastFocusedAt;
    await new Promise(r => setTimeout(r, 5));
    recordVisit({ id: '006A', name: 'Acme', type: 'Opportunity' });
    const list = listRecent();
    expect(list.length).toBe(1);
    expect(list[0].lastFocusedAt > firstFocus).toBe(true);
  });

  it('caps the list at 20 entries (oldest dropped)', () => {
    for (let i = 0; i < 25; i++) {
      recordVisit({ id: `006${i}`, name: `Opp ${i}`, type: 'Opportunity' });
    }
    const list = listRecent();
    expect(list.length).toBe(20);
    const ids = list.map(r => r.id);
    expect(ids).not.toContain('0060');
    expect(ids).not.toContain('0064');
    expect(ids).toContain('0065');
    expect(ids).toContain('00624');
  });

  it('getMostRecentlyFocused returns the entry with newest lastFocusedAt', async () => {
    recordVisit({ id: '006A', name: 'Acme', type: 'Opportunity' });
    await new Promise(r => setTimeout(r, 5));
    recordVisit({ id: '006B', name: 'Beta', type: 'Opportunity' });
    await new Promise(r => setTimeout(r, 5));
    recordVisit({ id: '006A', name: 'Acme', type: 'Opportunity' });
    const mr = getMostRecentlyFocused('Opportunity');
    expect(mr?.id).toBe('006A');
  });

  it('getMostRecentlyFocused filters by type', () => {
    recordVisit({ id: '006A', name: 'Acme', type: 'Opportunity' });
    recordVisit({ id: '001B', name: 'Beta Account', type: 'Account' });
    expect(getMostRecentlyFocused('Account')?.id).toBe('001B');
    expect(getMostRecentlyFocused('Opportunity')?.id).toBe('006A');
  });
});
