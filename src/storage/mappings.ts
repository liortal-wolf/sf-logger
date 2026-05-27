import type { LearnedMapping, DiscordCounterparty } from '../types';
import { normalizeDiscordHandle } from '../matching/identify';

const STORAGE_KEY = 'learned_mappings';

type MappingsMap = Record<string, LearnedMapping>;

// Storage keys are prefixed so userId-keyed and username-keyed entries can
// coexist without collisions: `uid:<id>` for Discord user-IDs, `un:<normalized>`
// for username fallback.
function userIdKey(userId: string): string { return `uid:${userId}`; }
function usernameKey(username: string): string { return `un:${normalizeDiscordHandle(username)}`; }

export function listMappings(): MappingsMap {
  return GM_getValue<MappingsMap>(STORAGE_KEY, {});
}

export function getMappingFor(cp: DiscordCounterparty): LearnedMapping | null {
  const all = listMappings();
  if (cp.userId) {
    const byId = all[userIdKey(cp.userId)];
    if (byId) return byId;
  }
  if (cp.username) {
    const byName = all[usernameKey(cp.username)];
    if (byName) return byName;
  }
  return null;
}

export function recordMapping(cp: DiscordCounterparty, oppId: string, oppName: string): void {
  const all = listMappings();
  const entry: LearnedMapping = {
    oppId,
    oppName,
    lastUsed: new Date().toISOString()
  };
  if (cp.userId) {
    all[userIdKey(cp.userId)] = entry;
  } else if (cp.username) {
    all[usernameKey(cp.username)] = entry;
  } else {
    return; // nothing to key on
  }
  GM_setValue(STORAGE_KEY, all);
}
