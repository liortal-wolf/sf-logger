import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { recordMapping, getMappingFor } from '../../src/storage/mappings';

describe('learned mappings (userId-first, username-fallback)', () => {
  beforeEach(() => __resetGM());
  afterEach(() => __resetGM());

  it('stores and retrieves a mapping by username when no userId is provided', () => {
    recordMapping({ username: 'joe' }, '006A', 'Acme');
    const m = getMappingFor({ username: 'joe' });
    expect(m?.oppId).toBe('006A');
  });

  it('prefers a userId-keyed mapping over a username-keyed mapping', () => {
    recordMapping({ username: 'joe' }, '006USERNAME', 'Wrong One');
    recordMapping({ username: 'joe', userId: '111' }, '006USERID', 'Right One');
    const m = getMappingFor({ username: 'joe', userId: '111' });
    expect(m?.oppId).toBe('006USERID');
  });

  it('falls back to username when no userId match is stored', () => {
    recordMapping({ username: 'joe' }, '006A', 'Acme');
    const m = getMappingFor({ username: 'joe', userId: '111' });
    expect(m?.oppId).toBe('006A');
  });

  it('returns null when neither key matches', () => {
    recordMapping({ username: 'joe' }, '006A', 'Acme');
    expect(getMappingFor({ username: 'nobody' })).toBeNull();
  });
});
