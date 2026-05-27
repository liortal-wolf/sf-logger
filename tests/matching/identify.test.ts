import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { identifyTarget } from '../../src/matching/identify';
import { recordVisit } from '../../src/storage/recent-sf';
import { recordMapping } from '../../src/storage/mappings';

describe('identifyTarget strategy chain', () => {
  beforeEach(() => __resetGM());
  afterEach(() => __resetGM());

  it('returns open-sf-tab when a recently focused Opportunity exists', () => {
    recordVisit({ id: '006OPP', name: 'Acme Opp' });
    const result = identifyTarget({ counterparty: 'joe' });
    expect(result.kind).toBe('open-sf-tab');
    if (result.kind === 'open-sf-tab') {
      expect(result.record.id).toBe('006OPP');
    }
  });

  it('falls back to learned-mapping when no open SF tab matches', () => {
    recordMapping('joe_acme', '006Hu000ABC', 'Acme Q2 Renewal');
    const result = identifyTarget({ counterparty: 'joe_acme' });
    expect(result.kind).toBe('learned-mapping');
    if (result.kind === 'learned-mapping') {
      expect(result.record.id).toBe('006Hu000ABC');
      expect(result.record.name).toBe('Acme Q2 Renewal');
    }
  });

  it('falls back to picker when no open tab + no learned mapping but recent Opportunities exist', () => {
    // Insert an old visit that won't qualify as "recent" for strategy A
    GM_setValue('recent_sf_records', [{
      id: '006OLD',
      name: 'Old Opp',
      visitedAt: '2020-01-01T00:00:00Z',
      lastFocusedAt: '2020-01-01T00:00:00Z'
    }]);
    const result = identifyTarget({ counterparty: 'new_user' });
    expect(result.kind).toBe('picker');
    if (result.kind === 'picker') {
      expect(result.choices.length).toBeGreaterThan(0);
      expect(result.choices[0].id).toBe('006OLD');
    }
  });

  it('falls back to manual when no history exists at all', () => {
    const result = identifyTarget({ counterparty: 'totally_new' });
    expect(result.kind).toBe('manual');
  });

  it('prioritizes open-sf-tab over learned-mapping even when both exist', () => {
    recordVisit({ id: '006TAB', name: 'Currently Open Opp' });
    recordMapping('joe', '006LEARNED', 'Learned Opp');
    const result = identifyTarget({ counterparty: 'joe' });
    expect(result.kind).toBe('open-sf-tab');
    if (result.kind === 'open-sf-tab') {
      expect(result.record.id).toBe('006TAB');
    }
  });
});
