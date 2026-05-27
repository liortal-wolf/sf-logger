import type { IdentifyStrategy, RecentOpportunity, DiscordCounterparty } from '../types';
import { getMostRecentlyFocused, listRecent, listRecentContacts } from '../storage/recent-sf';
import { getMappingFor } from '../storage/mappings';

export interface IdentifyInput {
  counterparty: DiscordCounterparty;
}

export function normalizeDiscordHandle(s: string): string {
  return s.trim().replace(/^@/, '').toLowerCase();
}

export function identifyTarget(input: IdentifyInput): IdentifyStrategy {
  // Strategy 1: most-recently-focused Opportunity within recency window
  const openOpp = getMostRecentlyFocused();
  if (openOpp && isRecent(openOpp.lastFocusedAt)) {
    return { kind: 'open-sf-tab', record: openOpp };
  }

  // Strategy 2: learned mapping (Discord counterparty → Opportunity)
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

  // Strategy 3: NEW — counterparty matches a cached Contact, surface that Contact's Opps.
  // User-ID match is preferred; falls back to normalized-username match.
  const contact = findContactForCounterparty(input.counterparty);
  if (contact && contact.opps && contact.opps.length > 0) {
    return {
      kind: 'contact-scoped-picker',
      contact: {
        id: contact.id,
        name: contact.name,
        discordUsername: contact.discordUsername,
        discordUserId: contact.discordUserId
      },
      choices: contact.opps.map(o => ({
        id: o.id,
        name: o.name,
        accountName: o.accountName,
        stage: o.stage
      }))
    };
  }

  // Strategy 4: picker of recent Opportunities
  const recent = listRecent();
  if (recent.length > 0) {
    return { kind: 'picker', choices: recent };
  }

  // Strategy 5: manual entry
  return { kind: 'manual' };
}

function findContactForCounterparty(cp: DiscordCounterparty) {
  const all = listRecentContacts();
  if (cp.userId) {
    const byUserId = all
      .filter(c => c.discordUserId === cp.userId)
      .sort((a, b) => b.lastFocusedAt.localeCompare(a.lastFocusedAt))[0];
    if (byUserId) return byUserId;
  }
  const normCp = normalizeDiscordHandle(cp.username);
  if (!normCp) return undefined;
  return all
    .filter(c => c.discordUsername && normalizeDiscordHandle(c.discordUsername) === normCp)
    .sort((a, b) => b.lastFocusedAt.localeCompare(a.lastFocusedAt))[0];
}

const RECENCY_THRESHOLD_MS = 4 * 60 * 60 * 1000;

function isRecent(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < RECENCY_THRESHOLD_MS;
}
