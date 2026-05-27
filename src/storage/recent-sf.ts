import type { RecentOpportunity, RecentContact } from '../types';

const OPPS_KEY = 'recent_sf_records';     // keeps the same storage key for back-compat
const CONTACTS_KEY = 'recent_contacts';
const MAX_ENTRIES = 20;

// Migrate legacy entries (which were union-typed Opp|Account|Contact) into the
// new Opp-only shape. Standalone Account/Contact entries are dropped here —
// Contacts now live in `recent_contacts` and standalone Accounts are no longer
// tracked.
export function listRecent(): RecentOpportunity[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = GM_getValue<any[]>(OPPS_KEY, []);
  return raw
    .filter(r => !r.type || r.type === 'Opportunity')
    .map<RecentOpportunity>(r => ({
      id: r.id,
      name: r.name,
      visitedAt: r.visitedAt,
      lastFocusedAt: r.lastFocusedAt,
      account: r.account
        ?? (r.accountId && r.accountName ? { id: r.accountId, name: r.accountName } : undefined)
    }));
}

export interface OpportunityVisitInput {
  id: string;
  name: string;
  // undefined means "no account on this record" — caller is responsible for
  // distinguishing "keep existing" vs "clear" by reading existing first and
  // passing the desired final value. We do NOT silently preserve a previously
  // stored account here, because that prevents callers from clearing a
  // detected-bad cached value.
  account?: { id: string; name: string };
}

export function recordVisit(input: OpportunityVisitInput): void {
  const now = new Date().toISOString();
  const existing = listRecent();
  const idx = existing.findIndex(r => r.id === input.id);

  let updated: RecentOpportunity;
  if (idx >= 0) {
    updated = {
      ...existing[idx],
      name: input.name,
      lastFocusedAt: now,
      account: input.account
    };
    existing.splice(idx, 1);
  } else {
    updated = {
      id: input.id,
      name: input.name,
      visitedAt: now,
      lastFocusedAt: now,
      account: input.account
    };
  }

  existing.unshift(updated);
  GM_setValue(OPPS_KEY, existing.slice(0, MAX_ENTRIES));
}

export function getMostRecentlyFocused(): RecentOpportunity | null {
  const all = listRecent();
  return all[0] ?? null;
}

// ---------- Contacts (separate top-level list) ----------

export function listRecentContacts(): RecentContact[] {
  return GM_getValue<RecentContact[]>(CONTACTS_KEY, []);
}

export interface ContactVisitInput {
  id: string;
  name: string;
  discordUsername?: string;
}

export function recordContactVisit(input: ContactVisitInput): void {
  const now = new Date().toISOString();
  const existing = listRecentContacts();
  const idx = existing.findIndex(r => r.id === input.id);

  let updated: RecentContact;
  if (idx >= 0) {
    updated = {
      ...existing[idx],
      name: input.name,
      lastFocusedAt: now,
      discordUsername: input.discordUsername ?? existing[idx].discordUsername
    };
    existing.splice(idx, 1);
  } else {
    updated = {
      id: input.id,
      name: input.name,
      visitedAt: now,
      lastFocusedAt: now,
      discordUsername: input.discordUsername
    };
  }

  existing.unshift(updated);
  GM_setValue(CONTACTS_KEY, existing.slice(0, MAX_ENTRIES));
}
