import type { IdentifyStrategy, RecentSFRecord } from '../types';
import { getMostRecentlyFocused, listRecent } from '../storage/recent-sf';
import { getMappingFor } from '../storage/mappings';

export interface IdentifyInput {
  counterparty: string;
}

export function identifyTarget(input: IdentifyInput): IdentifyStrategy {
  // Strategy A: Open SF tab on an Opportunity
  const openOpp = getMostRecentlyFocused('Opportunity');
  if (openOpp && isRecent(openOpp.lastFocusedAt)) {
    return { kind: 'open-sf-tab', record: openOpp };
  }

  // Strategy B: Learned mapping for this Discord counterparty
  const mapping = getMappingFor(input.counterparty);
  if (mapping) {
    const record: RecentSFRecord = {
      id: mapping.oppId,
      name: mapping.oppName,
      type: 'Opportunity',
      visitedAt: mapping.lastUsed,
      lastFocusedAt: mapping.lastUsed
    };
    return { kind: 'learned-mapping', record };
  }

  // Strategy C: Picker from recent SF records (Opportunities and Accounts both eligible).
  // The plan §7 mentions "recent SF records you visited" without restricting to
  // Opportunity-only, and the tests store Account visits here, so we include all
  // types rather than filtering to Opportunity alone.
  const recent = listRecent();
  if (recent.length > 0) {
    return { kind: 'picker', choices: recent };
  }

  // Strategy D: Manual entry
  return { kind: 'manual' };
}

// "Recent" means focused within the last 30 minutes — guards against an Opp tab
// that's been open for a week being preferred over a relevant learned mapping.
const RECENCY_THRESHOLD_MS = 30 * 60 * 1000;

function isRecent(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < RECENCY_THRESHOLD_MS;
}
