import type { RecentSFRecord } from '../types';

const STORAGE_KEY = 'recent_sf_records';
const MAX_ENTRIES = 20;

export function listRecent(): RecentSFRecord[] {
  return GM_getValue<RecentSFRecord[]>(STORAGE_KEY, []);
}

export function recordVisit(record: {
  id: string;
  name: string;
  type: 'Opportunity' | 'Account';
}): void {
  const now = new Date().toISOString();
  const existing = listRecent();
  const idx = existing.findIndex(r => r.id === record.id);

  let updated: RecentSFRecord;
  if (idx >= 0) {
    // Preserve original visitedAt, update lastFocusedAt and move to front
    updated = { ...existing[idx], name: record.name, lastFocusedAt: now };
    existing.splice(idx, 1);
  } else {
    updated = {
      id: record.id,
      name: record.name,
      type: record.type,
      visitedAt: now,
      lastFocusedAt: now
    };
  }

  // Place at front (most recently focused), then cap
  existing.unshift(updated);
  const capped = existing.slice(0, MAX_ENTRIES);
  GM_setValue(STORAGE_KEY, capped);
}

export function getMostRecentlyFocused(
  type: 'Opportunity' | 'Account'
): RecentSFRecord | null {
  const matching = listRecent().filter(r => r.type === type);
  if (matching.length === 0) return null;
  return matching[0];
}
