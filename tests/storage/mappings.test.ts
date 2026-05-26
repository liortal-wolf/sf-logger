import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { recordMapping, getMappingFor, listMappings } from '../../src/storage/mappings';

describe('learned mappings', () => {
  beforeEach(() => __resetGM());
  afterEach(() => __resetGM());

  it('returns null when no mapping for a username', () => {
    expect(getMappingFor('joe_acme')).toBeNull();
  });

  it('records and retrieves a mapping', () => {
    recordMapping('joe_acme', '006Hu000ABC', 'Acme Q2 Renewal');
    const m = getMappingFor('joe_acme');
    expect(m).not.toBeNull();
    expect(m!.oppId).toBe('006Hu000ABC');
    expect(m!.oppName).toBe('Acme Q2 Renewal');
    expect(typeof m!.lastUsed).toBe('string');
  });

  it('overwrites an existing mapping and updates lastUsed', async () => {
    recordMapping('joe_acme', '006Hu000ABC', 'Acme Q2 Renewal');
    const first = getMappingFor('joe_acme')!.lastUsed;
    await new Promise(r => setTimeout(r, 5));
    recordMapping('joe_acme', '006Hu000XYZ', 'Acme Q3 Expansion');
    const second = getMappingFor('joe_acme')!;
    expect(second.oppId).toBe('006Hu000XYZ');
    expect(second.oppName).toBe('Acme Q3 Expansion');
    expect(second.lastUsed > first).toBe(true);
  });

  it('listMappings returns all stored entries', () => {
    recordMapping('joe_acme', '006A', 'Acme');
    recordMapping('jane_beta', '006B', 'Beta');
    const all = listMappings();
    expect(Object.keys(all).sort()).toEqual(['jane_beta', 'joe_acme']);
  });
});
