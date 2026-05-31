import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  recordVisit, listRecent, getMostRecentlyFocused,
  recordContactVisit, listRecentContacts,
  bumpLastFocused, clearLastFocused
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

  it('bumpLastFocused updates lastFocusedAt to roughly now', async () => {
    recordVisit({ id: '006A', name: 'Acme' });
    const initial = listRecent()[0].lastFocusedAt;
    await new Promise(r => setTimeout(r, 5));
    bumpLastFocused('006A');
    const after = listRecent()[0].lastFocusedAt;
    expect(after > initial).toBe(true);
  });

  it('bumpLastFocused is a no-op when the Opp is not in storage', () => {
    bumpLastFocused('006MISSING');
    expect(listRecent()).toEqual([]);
  });

  it('clearLastFocused sets lastFocusedAt to the epoch so strategy 1 fails immediately', () => {
    recordVisit({ id: '006A', name: 'Acme' });
    clearLastFocused('006A');
    const stored = listRecent()[0];
    expect(stored.lastFocusedAt).toBe('1970-01-01T00:00:00.000Z');
    // The other fields stay intact
    expect(stored.id).toBe('006A');
    expect(stored.name).toBe('Acme');
  });

  it('clearLastFocused is a no-op when the Opp is not in storage', () => {
    expect(() => clearLastFocused('006MISSING')).not.toThrow();
    expect(listRecent()).toEqual([]);
  });

  it('unions contacts on repeat Opp visits, keyed by Contact id', () => {
    recordVisit({
      id: '006A',
      name: 'Acme',
      contacts: [{ id: '003A', name: 'Kesem', lastSeenAt: '2026-05-27T10:00:00Z' }]
    });
    recordVisit({
      id: '006A',
      name: 'Acme',
      contacts: [{ id: '003B', name: 'Joe', lastSeenAt: '2026-05-27T11:00:00Z' }]
    });
    const list = listRecent();
    expect(list[0].contacts?.length).toBe(2);
    const ids = list[0].contacts?.map(c => c.id) ?? [];
    expect(ids).toContain('003A');
    expect(ids).toContain('003B');
  });

  it('caps contacts per Opp at 10, dropping the oldest by lastSeenAt', () => {
    const contacts = Array.from({ length: 12 }, (_, i) => ({
      id: `003${String(i).padStart(2, '0')}`,
      name: `Contact ${i}`,
      lastSeenAt: `2026-05-${String(10 + i).padStart(2, '0')}T00:00:00Z`
    }));
    recordVisit({ id: '006A', name: 'Acme', contacts });
    const stored = listRecent()[0].contacts ?? [];
    expect(stored.length).toBe(10);
    const ids = stored.map(c => c.id);
    expect(ids).not.toContain('00300'); // oldest dropped
    expect(ids).toContain('00311'); // newest kept
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

  it('unions opps on repeat Contact visits, keyed by Opp id', () => {
    recordContactVisit({
      id: '003A',
      name: 'Kesem',
      opps: [
        { id: '006A', name: 'Acme', lastSeenAt: '2026-05-27T10:00:00Z' }
      ]
    });
    recordContactVisit({
      id: '003A',
      name: 'Kesem',
      opps: [
        { id: '006B', name: 'Beta', lastSeenAt: '2026-05-27T11:00:00Z' }
      ]
    });
    const list = listRecentContacts();
    expect(list[0].opps?.length).toBe(2);
    const ids = list[0].opps?.map(o => o.id) ?? [];
    expect(ids).toContain('006A');
    expect(ids).toContain('006B');
  });

  it('later writes win on opp metadata (name, accountName, stage)', () => {
    recordContactVisit({
      id: '003A',
      name: 'Kesem',
      opps: [{ id: '006A', name: 'Old Name', lastSeenAt: '2026-05-27T10:00:00Z' }]
    });
    recordContactVisit({
      id: '003A',
      name: 'Kesem',
      opps: [{ id: '006A', name: 'New Name', accountName: 'Acme', stage: 'Prospecting', lastSeenAt: '2026-05-27T11:00:00Z' }]
    });
    const opp = listRecentContacts()[0].opps?.find(o => o.id === '006A');
    expect(opp?.name).toBe('New Name');
    expect(opp?.accountName).toBe('Acme');
    expect(opp?.stage).toBe('Prospecting');
  });

  it('caps opps per Contact at 10, dropping the oldest by lastSeenAt', () => {
    const opps = Array.from({ length: 12 }, (_, i) => ({
      id: `006${String(i).padStart(2, '0')}`,
      name: `Opp ${i}`,
      lastSeenAt: `2026-05-${String(10 + i).padStart(2, '0')}T00:00:00Z`
    }));
    recordContactVisit({ id: '003A', name: 'Kesem', opps });
    const stored = listRecentContacts()[0].opps ?? [];
    expect(stored.length).toBe(10);
    const ids = stored.map(o => o.id);
    expect(ids).not.toContain('00600'); // oldest dropped
    expect(ids).not.toContain('00601');
    expect(ids).toContain('00611'); // newest kept
  });
});
