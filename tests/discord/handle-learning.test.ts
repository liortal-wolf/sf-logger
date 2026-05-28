import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyDiscordHandleLearning, shouldLearnHandle } from '../../src/discord/handle-learning';
import { recordContactVisit, listRecentContacts } from '../../src/storage/recent-sf';

describe('shouldLearnHandle (popup-side decision)', () => {
  it('returns the contact id when the chosen Contact has no cached discordUsername', () => {
    const choices = [
      { id: '003A', name: 'Kesem', discordUsername: undefined },
      { id: '003B', name: 'Joe', discordUsername: 'joe_discord' }
    ];
    expect(shouldLearnHandle('003A', choices)).toBe('003A');
  });

  it('returns undefined when the chosen Contact already has a cached discordUsername', () => {
    const choices = [
      { id: '003B', name: 'Joe', discordUsername: 'joe_discord' }
    ];
    expect(shouldLearnHandle('003B', choices)).toBeUndefined();
  });

  it('returns undefined when no Contact was chosen', () => {
    const choices = [{ id: '003A', name: 'Kesem' }];
    expect(shouldLearnHandle('', choices)).toBeUndefined();
  });

  it('returns undefined when the chosen id is not in the choices list', () => {
    const choices = [{ id: '003A', name: 'Kesem', discordUsername: 'kesem_handle' }];
    expect(shouldLearnHandle('003Z', choices)).toBeUndefined();
  });
});

describe('applyDiscordHandleLearning (content-script side write)', () => {
  beforeEach(() => __resetGM());
  afterEach(() => __resetGM());

  it('writes username + userId to the Contact and returns true', () => {
    recordContactVisit({ id: '003A', name: 'Kesem' });
    const learned = applyDiscordHandleLearning('003A', {
      username: 'mutualmagic',
      userId: '111222333'
    });
    expect(learned).toBe(true);
    const stored = listRecentContacts()[0];
    expect(stored.discordUsername).toBe('mutualmagic');
    expect(stored.discordUserId).toBe('111222333');
  });

  it('preserves existing opps when learning the handle', () => {
    recordContactVisit({
      id: '003A',
      name: 'Kesem',
      opps: [{ id: '006A', name: 'Acme', lastSeenAt: '2026-05-27T10:00:00Z' }]
    });
    applyDiscordHandleLearning('003A', { username: 'mutualmagic' });
    const stored = listRecentContacts()[0];
    expect(stored.opps?.length).toBe(1);
    expect(stored.opps?.[0].id).toBe('006A');
  });

  it('returns false when the Contact is not in the recent cache', () => {
    const learned = applyDiscordHandleLearning('003UNKNOWN', { username: 'kesem' });
    expect(learned).toBe(false);
  });

  it('returns false when contactId is empty', () => {
    expect(applyDiscordHandleLearning('', { username: 'kesem' })).toBe(false);
  });

  it('returns false when counterparty has neither username nor userId', () => {
    recordContactVisit({ id: '003A', name: 'Kesem' });
    expect(applyDiscordHandleLearning('003A', { username: '' })).toBe(false);
  });

  it('does not overwrite an existing username with a falsy counterparty.username', () => {
    recordContactVisit({ id: '003A', name: 'Kesem', discordUsername: 'previous_handle' });
    applyDiscordHandleLearning('003A', { username: '', userId: '111' });
    const stored = listRecentContacts()[0];
    // counterparty.username was empty so it should be a no-op (returns false)
    // and the stored handle stays as-is
    expect(stored.discordUsername).toBe('previous_handle');
  });
});
