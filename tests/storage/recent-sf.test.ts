import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  recordVisit, listRecent, getMostRecentlyFocused,
  recordContactVisit, listRecentContacts
} from '../../src/storage/recent-sf';

describe('recent SF opportunities', () => {
  beforeEach(() => __resetGM());
  afterEach(() => __resetGM());

  it('returns empty list when nothing visited', () => {
    expect(listRecent()).toEqual([]);
  });

  it('records an Opportunity visit (no Account) and lists it', () => {
    recordVisit({ id: '006A', name: 'Acme' });
    const list = listRecent();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('006A');
    expect(list[0].name).toBe('Acme');
    expect(list[0].account).toBeUndefined();
    expect(typeof list[0].visitedAt).toBe('string');
  });

  it('records an Opportunity with a nested Account', () => {
    recordVisit({
      id: '006A',
      name: 'Acme Q2 Renewal',
      account: { id: '001AC', name: 'Acme Inc' }
    });
    const list = listRecent();
    expect(list[0].account).toEqual({ id: '001AC', name: 'Acme Inc' });
  });

  it('clears the stored Account when a later visit omits it — caller is responsible for explicit preserve', () => {
    recordVisit({ id: '006A', name: 'Acme', account: { id: '001AC', name: 'Acme Inc' } });
    recordVisit({ id: '006A', name: 'Acme' }); // re-visit without account → clear
    expect(listRecent()[0].account).toBeUndefined();
  });

  it('callers can preserve a stored Account by reading it first and passing it back explicitly', () => {
    recordVisit({ id: '006A', name: 'Acme', account: { id: '001AC', name: 'Acme Inc' } });
    const existingAccount = listRecent()[0].account;
    recordVisit({ id: '006A', name: 'Acme', account: existingAccount });
    expect(listRecent()[0].account).toEqual({ id: '001AC', name: 'Acme Inc' });
  });

  it('dedups by id, updating lastFocusedAt on repeat visit', async () => {
    recordVisit({ id: '006A', name: 'Acme' });
    const firstFocus = listRecent()[0].lastFocusedAt;
    await new Promise(r => setTimeout(r, 5));
    recordVisit({ id: '006A', name: 'Acme' });
    const list = listRecent();
    expect(list.length).toBe(1);
    expect(list[0].lastFocusedAt > firstFocus).toBe(true);
  });

  it('caps the list at 20 entries (oldest dropped)', () => {
    for (let i = 0; i < 25; i++) {
      recordVisit({ id: `006${i}`, name: `Opp ${i}` });
    }
    const list = listRecent();
    expect(list.length).toBe(20);
    const ids = list.map(r => r.id);
    expect(ids).not.toContain('0060');
    expect(ids).toContain('00624');
  });

  it('getMostRecentlyFocused returns the entry with newest lastFocusedAt', async () => {
    recordVisit({ id: '006A', name: 'Acme' });
    await new Promise(r => setTimeout(r, 5));
    recordVisit({ id: '006B', name: 'Beta' });
    await new Promise(r => setTimeout(r, 5));
    recordVisit({ id: '006A', name: 'Acme' });
    expect(getMostRecentlyFocused()?.id).toBe('006A');
  });

  it('migrates legacy entries that have a type field, dropping non-Opportunities', () => {
    GM_setValue('recent_sf_records', [
      { id: '006A', name: 'Acme', type: 'Opportunity', visitedAt: 't', lastFocusedAt: 't', accountName: 'Acme Inc', accountId: '001AC' },
      { id: '001AC', name: 'Acme Inc', type: 'Account', visitedAt: 't', lastFocusedAt: 't' },
      { id: '003C', name: 'Joe', type: 'Contact', visitedAt: 't', lastFocusedAt: 't' }
    ]);
    const list = listRecent();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('006A');
    expect(list[0].account).toEqual({ id: '001AC', name: 'Acme Inc' });
  });
});

describe('recent contacts', () => {
  beforeEach(() => __resetGM());
  afterEach(() => __resetGM());

  it('starts empty', () => {
    expect(listRecentContacts()).toEqual([]);
  });

  it('records a contact visit and lists it', () => {
    recordContactVisit({ id: '003A', name: 'Kesem' });
    const list = listRecentContacts();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe('003A');
    expect(list[0].name).toBe('Kesem');
  });

  it('dedups by id and moves the existing entry to the front', async () => {
    recordContactVisit({ id: '003A', name: 'Kesem' });
    await new Promise(r => setTimeout(r, 5));
    recordContactVisit({ id: '003B', name: 'Joe' });
    await new Promise(r => setTimeout(r, 5));
    recordContactVisit({ id: '003A', name: 'Kesem' });
    const list = listRecentContacts();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('003A');
  });
});
