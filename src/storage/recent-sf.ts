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
        ?? (r.accountId && r.accountName ? { id: r.accountId, name: r.accountName } : undefined),
      contacts: r.contacts
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
  contacts?: Array<{ id: string; name: string; lastSeenAt: string }>;
}

const MAX_CONTACTS_PER_OPP = 10;

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
      account: input.account,
      contacts: mergeContacts(existing[idx].contacts, input.contacts)
    };
    existing.splice(idx, 1);
  } else {
    updated = {
      id: input.id,
      name: input.name,
      visitedAt: now,
      lastFocusedAt: now,
      account: input.account,
      contacts: input.contacts ? capContacts(input.contacts) : undefined
    };
  }

  existing.unshift(updated);
  GM_setValue(OPPS_KEY, existing.slice(0, MAX_ENTRIES));
}

// Refresh "this Opp tab is currently open" presence by updating
// lastFocusedAt to now. Called every watcher tick on Opp pages so the
// timestamp stays fresh while the tab is loaded. No-op if the Opp isn't
// already in storage (the first visit creates the entry via recordVisit).
export function bumpLastFocused(id: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = GM_getValue<any[]>(OPPS_KEY, []);
  const idx = all.findIndex(r => r && r.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], lastFocusedAt: new Date().toISOString() };
  GM_setValue(OPPS_KEY, all);
}

// Mark an Opp's tab as closed by setting lastFocusedAt to a far-past
// timestamp so the recency check in identifyTarget fails immediately on
// the next Log-to-SF click. Called from the SF page's beforeunload handler.
export function clearLastFocused(id: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = GM_getValue<any[]>(OPPS_KEY, []);
  const idx = all.findIndex(r => r && r.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], lastFocusedAt: '1970-01-01T00:00:00.000Z' };
  GM_setValue(OPPS_KEY, all);
}

function mergeContacts(
  existing: RecentOpportunity['contacts'],
  incoming: OpportunityVisitInput['contacts']
): RecentOpportunity['contacts'] {
  if (!incoming || incoming.length === 0) return existing;
  const byId = new Map<string, NonNullable<RecentOpportunity['contacts']>[number]>();
  for (const c of existing ?? []) byId.set(c.id, c);
  for (const c of incoming) {
    const prior = byId.get(c.id);
    byId.set(c.id, { ...prior, ...c });
  }
  return capContacts(Array.from(byId.values()));
}

function capContacts(contacts: NonNullable<RecentOpportunity['contacts']>): NonNullable<RecentOpportunity['contacts']> {
  return [...contacts]
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, MAX_CONTACTS_PER_OPP);
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
  discordUserId?: string;
  opps?: Array<{ id: string; name: string; accountName?: string; stage?: string; lastSeenAt: string }>;
}

const MAX_OPPS_PER_CONTACT = 10;

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
      discordUsername: input.discordUsername ?? existing[idx].discordUsername,
      discordUserId: input.discordUserId ?? existing[idx].discordUserId,
      opps: mergeOpps(existing[idx].opps, input.opps)
    };
    existing.splice(idx, 1);
  } else {
    updated = {
      id: input.id,
      name: input.name,
      visitedAt: now,
      lastFocusedAt: now,
      discordUsername: input.discordUsername,
      discordUserId: input.discordUserId,
      opps: input.opps ? capOpps(input.opps) : undefined
    };
  }

  existing.unshift(updated);
  GM_setValue(CONTACTS_KEY, existing.slice(0, MAX_ENTRIES));
}

function mergeOpps(
  existing: RecentContact['opps'],
  incoming: ContactVisitInput['opps']
): RecentContact['opps'] {
  if (!incoming || incoming.length === 0) return existing;
  const byId = new Map<string, NonNullable<RecentContact['opps']>[number]>();
  for (const o of existing ?? []) byId.set(o.id, o);
  for (const o of incoming) {
    const prior = byId.get(o.id);
    byId.set(o.id, { ...prior, ...o }); // later writes win on metadata
  }
  return capOpps(Array.from(byId.values()));
}

function capOpps(opps: NonNullable<RecentContact['opps']>): NonNullable<RecentContact['opps']> {
  return [...opps]
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, MAX_OPPS_PER_CONTACT);
}
