import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeDiscordHandle } from '../../src/matching/identify';
import { identifyTarget } from '../../src/matching/identify';

describe('normalizeDiscordHandle', () => {
  it('lowercases', () => {
    expect(normalizeDiscordHandle('KESEM')).toBe('kesem');
  });
  it('strips a leading @', () => {
    expect(normalizeDiscordHandle('@kesem')).toBe('kesem');
  });
  it('trims surrounding whitespace', () => {
    expect(normalizeDiscordHandle('  kesem  ')).toBe('kesem');
  });
  it('combines all three normalizations', () => {
    expect(normalizeDiscordHandle('  @Kesem  ')).toBe('kesem');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeDiscordHandle('')).toBe('');
    expect(normalizeDiscordHandle('   ')).toBe('');
  });
});
import { recordVisit } from '../../src/storage/recent-sf';
import { recordMapping } from '../../src/storage/mappings';

describe('identifyTarget strategy chain', () => {
  beforeEach(() => __resetGM());
  afterEach(() => __resetGM());

  it('returns open-sf-tab when a recently focused Opportunity exists', () => {
    recordVisit({ id: '006OPP', name: 'Acme Opp' });
    const result = identifyTarget({ counterparty: { username: 'joe' } });
    expect(result.kind).toBe('open-sf-tab');
    if (result.kind === 'open-sf-tab') {
      expect(result.record.id).toBe('006OPP');
    }
  });

  it('falls back to learned-mapping when no open SF tab matches', () => {
    recordMapping('joe_acme', '006Hu000ABC', 'Acme Q2 Renewal');
    const result = identifyTarget({ counterparty: { username: 'joe_acme' } });
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
    const result = identifyTarget({ counterparty: { username: 'new_user' } });
    expect(result.kind).toBe('picker');
    if (result.kind === 'picker') {
      expect(result.choices.length).toBeGreaterThan(0);
      expect(result.choices[0].id).toBe('006OLD');
    }
  });

  it('falls back to manual when no history exists at all', () => {
    const result = identifyTarget({ counterparty: { username: 'totally_new' } });
    expect(result.kind).toBe('manual');
  });

  it('prioritizes open-sf-tab over learned-mapping even when both exist', () => {
    recordVisit({ id: '006TAB', name: 'Currently Open Opp' });
    recordMapping('joe', '006LEARNED', 'Learned Opp');
    const result = identifyTarget({ counterparty: { username: 'joe' } });
    expect(result.kind).toBe('open-sf-tab');
    if (result.kind === 'open-sf-tab') {
      expect(result.record.id).toBe('006TAB');
    }
  });
});

import { recordContactVisit } from '../../src/storage/recent-sf';

describe('identifyTarget strategy 3: contact-scoped-picker', () => {
  beforeEach(() => __resetGM());
  afterEach(() => __resetGM());

  it('returns contact-scoped-picker when counterparty username matches a cached Contact with opps', () => {
    recordContactVisit({
      id: '003A',
      name: 'Kesem',
      discordUsername: 'mutualmagic',
      opps: [
        { id: '006A', name: 'Acme', lastSeenAt: '2026-05-27T10:00:00Z' },
        { id: '006B', name: 'Beta', lastSeenAt: '2026-05-27T11:00:00Z' }
      ]
    });

    const result = identifyTarget({ counterparty: { username: 'mutualmagic' } });
    expect(result.kind).toBe('contact-scoped-picker');
    if (result.kind === 'contact-scoped-picker') {
      expect(result.contact.id).toBe('003A');
      expect(result.choices.length).toBe(2);
    }
  });

  it('prefers user-ID match over username match (fold-in D)', () => {
    recordContactVisit({
      id: '003A',
      name: 'Kesem',
      discordUsername: 'old_username',
      discordUserId: '111222333',
      opps: [{ id: '006A', name: 'Acme', lastSeenAt: '2026-05-27T10:00:00Z' }]
    });
    recordContactVisit({
      id: '003B',
      name: 'Other Person',
      discordUsername: 'mutualmagic', // same username as the counterparty's renamed handle
      opps: [{ id: '006Z', name: 'Wrong Opp', lastSeenAt: '2026-05-27T10:00:00Z' }]
    });

    const result = identifyTarget({
      counterparty: { username: 'mutualmagic', userId: '111222333' }
    });
    expect(result.kind).toBe('contact-scoped-picker');
    if (result.kind === 'contact-scoped-picker') {
      expect(result.contact.id).toBe('003A'); // matched by userId, not username
    }
  });

  it('username match is tolerant of case, @-prefix, whitespace', () => {
    recordContactVisit({
      id: '003A',
      name: 'Kesem',
      discordUsername: 'MutualMagic',
      opps: [{ id: '006A', name: 'Acme', lastSeenAt: '2026-05-27T10:00:00Z' }]
    });

    const result = identifyTarget({ counterparty: { username: '  @mutualmagic  ' } });
    expect(result.kind).toBe('contact-scoped-picker');
  });

  it('falls through when Contact matches but has no opps cached yet', () => {
    recordContactVisit({
      id: '003A',
      name: 'Kesem',
      discordUsername: 'mutualmagic'
    });
    const result = identifyTarget({ counterparty: { username: 'mutualmagic' } });
    expect(result.kind).toBe('manual'); // no opps, no open SF tab, no learned mapping, no recent
  });

  it('falls through when no Contact matches the counterparty', () => {
    recordContactVisit({
      id: '003A',
      name: 'Kesem',
      discordUsername: 'someone_else',
      opps: [{ id: '006A', name: 'Acme', lastSeenAt: '2026-05-27T10:00:00Z' }]
    });
    const result = identifyTarget({ counterparty: { username: 'mutualmagic' } });
    expect(result.kind).toBe('manual');
  });

  it('open-sf-tab still takes precedence over contact-scoped-picker', () => {
    recordVisit({ id: '006TAB', name: 'Open Opp' });
    recordContactVisit({
      id: '003A',
      name: 'Kesem',
      discordUsername: 'mutualmagic',
      opps: [{ id: '006A', name: 'Acme', lastSeenAt: '2026-05-27T10:00:00Z' }]
    });
    const result = identifyTarget({ counterparty: { username: 'mutualmagic' } });
    expect(result.kind).toBe('open-sf-tab');
  });
});
