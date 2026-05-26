import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { identifyTarget } from '../../src/matching/identify';
import { recordVisit } from '../../src/storage/recent-sf';
import { recordMapping } from '../../src/storage/mappings';

describe('identifyTarget strategy chain', () => {
  beforeEach(() => __resetGM());
  afterEach(() => __resetGM());

  it('returns open-sf-tab when a recently focused Opportunity exists', () => {
    recordVisit({ id: '006OPP', name: 'Acme Opp', type: 'Opportunity' });
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

  it('falls back to picker when neither open tab nor learned mapping exists, and history has recent records', () => {
    recordVisit({ id: '001A', name: 'Acme Account', type: 'Account' });
    const result = identifyTarget({ counterparty: 'new_user' });
    expect(result.kind).toBe('picker');
    if (result.kind === 'picker') {
      expect(result.choices.length).toBeGreaterThan(0);
    }
  });

  it('falls back to manual when no history exists at all', () => {
    const result = identifyTarget({ counterparty: 'totally_new' });
    expect(result.kind).toBe('manual');
  });

  it('prioritizes open-sf-tab over learned-mapping even when both exist', () => {
    recordVisit({ id: '006TAB', name: 'Currently Open Opp', type: 'Opportunity' });
    recordMapping('joe', '006LEARNED', 'Learned Opp');
    const result = identifyTarget({ counterparty: 'joe' });
    expect(result.kind).toBe('open-sf-tab');
    if (result.kind === 'open-sf-tab') {
      expect(result.record.id).toBe('006TAB');
    }
  });
});
