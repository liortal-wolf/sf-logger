import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchContact, fetchOpportunity, fetchContactRelatedOpps, __testing__ } from '../../src/salesforce/ui-api';

function mockFetchResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as unknown as Response;
}

beforeEach(() => {
  __testing__.resetSessionState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchContact', () => {
  it('returns the parsed Contact on a successful response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        id: '003UZ00000nM3JCYA0',
        apiName: 'Contact',
        fields: {
          Name: { value: 'Kesem', displayValue: null },
          Discord__c: { value: 'mutualmagic', displayValue: null },
          AccountId: { value: '001UZ00000qGFZpYAO', displayValue: null },
          Account: {
            displayValue: 'Test Account - Lior Discord Tool',
            value: { id: '001UZ00000qGFZpYAO', fields: { Name: { value: 'Test Account - Lior Discord Tool' } } }
          }
        }
      })
    );

    const c = await fetchContact('003UZ00000nM3JCYA0');
    expect(c).toEqual({
      id: '003UZ00000nM3JCYA0',
      name: 'Kesem',
      discordUsername: 'mutualmagic',
      account: { id: '001UZ00000qGFZpYAO', name: 'Test Account - Lior Discord Tool' }
    });
  });

  it('returns null when the field block is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({ id: '003A' }));
    expect(await fetchContact('003A')).toBeNull();
  });

  it('returns null and sets the session-blocked flag on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ errorCode: 'INVALID_SESSION_ID' }, { ok: false, status: 401 })
    );
    expect(await fetchContact('003A')).toBeNull();
    expect(__testing__.isSessionBlocked()).toBe(true);
  });

  it('returns null on a 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ errorCode: 'NOT_FOUND' }, { ok: false, status: 404 })
    );
    expect(await fetchContact('003A')).toBeNull();
    expect(__testing__.isSessionBlocked()).toBe(false);
  });

  it('returns null when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network error'));
    expect(await fetchContact('003A')).toBeNull();
  });

  it('returns null when the response is not valid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token'); }
    } as unknown as Response);
    expect(await fetchContact('003A')).toBeNull();
  });

  it('skips the fetch entirely once the session is blocked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ errorCode: 'INVALID_SESSION_ID' }, { ok: false, status: 401 })
    );
    await fetchContact('003A');
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({ ok: true }));
    spy.mockClear(); // reset call count after spy-stacking inherits prior calls (vitest 4.x behavior)
    const c = await fetchContact('003B');
    expect(c).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('reads account name from displayValue when present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        id: '003A',
        fields: {
          Name: { value: 'Joe' },
          Discord__c: { value: null },
          Account: { displayValue: 'Acme Inc', value: { id: '001A' } }
        }
      })
    );
    const c = await fetchContact('003A');
    expect(c?.account).toEqual({ id: '001A', name: 'Acme Inc' });
    expect(c?.discordUsername).toBeNull();
  });
});

describe('fetchOpportunity', () => {
  it('returns the parsed Opportunity on a successful response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        id: '006UZ00000ZEz5tYAD',
        apiName: 'Opportunity',
        fields: {
          Name: { value: 'test opp lior discord tool' },
          StageName: { value: 'Reach Out', displayValue: 'Reach Out' },
          AccountId: { value: '001UZ00000qGFZpYAO' },
          Account: {
            displayValue: 'Test Account - Lior Discord Tool',
            value: { id: '001UZ00000qGFZpYAO' }
          }
        }
      })
    );

    const o = await fetchOpportunity('006UZ00000ZEz5tYAD');
    expect(o).toEqual({
      id: '006UZ00000ZEz5tYAD',
      name: 'test opp lior discord tool',
      stage: 'Reach Out',
      account: { id: '001UZ00000qGFZpYAO', name: 'Test Account - Lior Discord Tool' }
    });
  });

  it('returns null when the record has no Name field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ id: '006A', fields: { StageName: { value: 'Closed' } } })
    );
    expect(await fetchOpportunity('006A')).toBeNull();
  });

  it('omits stage when StageName is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        id: '006A',
        fields: { Name: { value: 'Acme Renewal' } }
      })
    );
    const o = await fetchOpportunity('006A');
    expect(o?.name).toBe('Acme Renewal');
    expect(o?.stage).toBeUndefined();
    expect(o?.account).toBeUndefined();
  });

  it('returns null on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({}, { ok: false, status: 404 })
    );
    expect(await fetchOpportunity('006A')).toBeNull();
  });
});

describe('fetchContactRelatedOpps', () => {
  it('returns parsed Opp records from a Contact\'s Opportunities related list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        count: 2,
        records: [
          {
            id: '006UZ00000ZEz5tYAD',
            apiName: 'Opportunity',
            fields: {
              Name: { value: 'test opp lior discord tool' },
              StageName: { value: 'Reach Out', displayValue: 'Reach Out' },
              Account: {
                displayValue: 'Test Account - Lior Discord Tool',
                value: { id: '001UZ00000qGFZpYAO' }
              }
            }
          },
          {
            id: '006UZ00000AbcDef',
            apiName: 'Opportunity',
            fields: {
              Name: { value: 'Other Opp' },
              StageName: { value: 'Closed Won', displayValue: 'Closed Won' }
            }
          }
        ]
      })
    );

    const opps = await fetchContactRelatedOpps('003A');
    expect(opps).toHaveLength(2);
    expect(opps[0]).toEqual({
      id: '006UZ00000ZEz5tYAD',
      name: 'test opp lior discord tool',
      stage: 'Reach Out',
      account: { id: '001UZ00000qGFZpYAO', name: 'Test Account - Lior Discord Tool' }
    });
    expect(opps[1]).toEqual({
      id: '006UZ00000AbcDef',
      name: 'Other Opp',
      stage: 'Closed Won'
    });
  });

  it('returns empty array on 404 (no related list configured)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({}, { ok: false, status: 404 })
    );
    expect(await fetchContactRelatedOpps('003A')).toEqual([]);
  });

  it('returns empty array when records field is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({ count: 0 }));
    expect(await fetchContactRelatedOpps('003A')).toEqual([]);
  });

  it('skips records missing a Name field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        records: [
          { id: '006A', fields: { StageName: { value: 'Prospecting' } } },
          { id: '006B', fields: { Name: { value: 'Real Opp' } } }
        ]
      })
    );
    const opps = await fetchContactRelatedOpps('003A');
    expect(opps).toHaveLength(1);
    expect(opps[0].id).toBe('006B');
  });
});
