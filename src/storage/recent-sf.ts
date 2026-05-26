import type { RecentSFRecord } from '../types';

const STORAGE_KEY = 'recent_sf_records';
const MAX_ENTRIES = 20;

export function listRecent(): RecentSFRecord[] {
  return GM_getValue<RecentSFRecord[]>(STORAGE_KEY, []);
}

export interface RecordVisitInput {
  id: string;
  name: string;
  type: 'Opportunity' | 'Account';
  accountName?: string;
  accountId?: string;
}

export function recordVisit(record: RecordVisitInput): void {
  const now = new Date().toISOString();
  const existing = listRecent();
  const idx = existing.findIndex(r => r.id === record.id);

  let updated: RecentSFRecord;
  if (idx >= 0) {
    // Preserve original visitedAt, update mutable fields and move to front
    updated = {
      ...existing[idx],
      name: record.name,
      lastFocusedAt: now,
      accountName: record.accountName ?? existing[idx].accountName,
      accountId: record.accountId ?? existing[idx].accountId
    };
    existing.splice(idx, 1);
  } else {
    updated = {
      id: record.id,
      name: record.name,
      type: record.type,
      visitedAt: now,
      lastFocusedAt: now,
      accountName: record.accountName,
      accountId: record.accountId
    };
  }

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
