import type { IdentifyStrategy, RecentOpportunity } from '../types';
import { getMostRecentlyFocused, listRecent } from '../storage/recent-sf';
import { getMappingFor } from '../storage/mappings';

export interface IdentifyInput {
  counterparty: string;
}

export function identifyTarget(input: IdentifyInput): IdentifyStrategy {
  // Strategy A: most-recently-focused Opportunity within recency window
  const openOpp = getMostRecentlyFocused();
  if (openOpp && isRecent(openOpp.lastFocusedAt)) {
    return { kind: 'open-sf-tab', record: openOpp };
  }

  // Strategy B: learned mapping (Discord counterparty → Opportunity)
  const mapping = getMappingFor(input.counterparty);
  if (mapping) {
    const record: RecentOpportunity = {
      id: mapping.oppId,
      name: mapping.oppName,
      visitedAt: mapping.lastUsed,
      lastFocusedAt: mapping.lastUsed
    };
    return { kind: 'learned-mapping', record };
  }

  // Strategy C: picker of recent Opportunities
  const recent = listRecent();
  if (recent.length > 0) {
    return { kind: 'picker', choices: recent };
  }

  // Strategy D: manual entry
  return { kind: 'manual' };
}

// "Recent" means focused within the last 4 hours — covers a normal work session
// where you alt-tab between SF and Discord.
const RECENCY_THRESHOLD_MS = 4 * 60 * 60 * 1000;

function isRecent(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < RECENCY_THRESHOLD_MS;
}
