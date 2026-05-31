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
  const byMostRecent = (a: { lastFocusedAt: string }, b: { lastFocusedAt: string }) =>
    b.lastFocusedAt.localeCompare(a.lastFocusedAt);

  // 1. Exact Discord user-ID match — most specific, survives renames.
  if (cp.userId) {
    const byUserId = all.filter(c => c.discordUserId === cp.userId).sort(byMostRecent)[0];
    if (byUserId) return byUserId;
  }

  const normCp = normalizeDiscordHandle(cp.username);
  if (!normCp) return undefined;

  // 2. Discord field (Contact.Discord__c) match — explicitly configured handle.
  const byDiscordField = all
    .filter(c => c.discordUsername && normalizeDiscordHandle(c.discordUsername) === normCp)
    .sort(byMostRecent)[0];
  if (byDiscordField) return byDiscordField;

  // 3. Contact name match — covers the common case where Discord's title shows
  //    the display name (e.g. "@Kesem") and the SF Contact's Discord field has
  //    the actual handle (e.g. "mutualmagic") that doesn't match the title.
  //    Compare the normalized counterparty against each Contact's normalized
  //    name. SF Contact names typically have spaces ("Kesem Smith"); Discord
  //    display names don't — so this is a generous "starts with" match against
  //    the first word of the name.
  const byContactName = all
    .filter(c => {
      const first = c.name.split(/\s+/)[0] ?? '';
      return normalizeDiscordHandle(first) === normCp;
    })
    .sort(byMostRecent)[0];
  return byContactName;
}

// Strategy 1 fires only when an Opp tab is currently open. The SF watcher
// refreshes lastFocusedAt every 2-second tick while the Opp page is loaded,
// and clears it on tab close (beforeunload → '1970-01-01T...'). A 10-second
// recency window reliably captures "tab is open right now" without the old
// 4-hour staleness where closing the tab still triggered strategy 1 for hours.
const OPEN_TAB_PRESENCE_MS = 10 * 1000;

function isRecent(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < OPEN_TAB_PRESENCE_MS;
}
