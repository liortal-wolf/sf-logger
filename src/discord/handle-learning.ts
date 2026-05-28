import type { DiscordCounterparty } from '../types';
import { listRecentContacts, recordContactVisit } from '../storage/recent-sf';

// Fold-in A: when the user manually picks a Contact in the popup whose cached
// Discord handle is empty, write the current counterparty's username/userId
// into local storage so future Log-to-SF clicks auto-match via strategy 3.
// Pure-ish (delegates to GM storage via recordContactVisit). Returns true if
// a write happened, false otherwise — useful for tests and logging.
export function applyDiscordHandleLearning(
  contactId: string,
  counterparty: DiscordCounterparty
): boolean {
  if (!contactId) return false;
  if (!counterparty.username && !counterparty.userId) return false;
  const existing = listRecentContacts().find(c => c.id === contactId);
  if (!existing) return false;
  recordContactVisit({
    id: existing.id,
    name: existing.name,
    discordUsername: counterparty.username || existing.discordUsername,
    discordUserId: counterparty.userId ?? existing.discordUserId,
    opps: existing.opps
  });
  return true;
}

// Popup-side decision: should the caller learn a Discord handle for the
// chosen Contact? Yes iff the user picked a Contact whose cached handle was
// empty. Pure function so the popup can call it inline at Send time.
export function shouldLearnHandle(
  chosenContactId: string,
  contactChoices: ReadonlyArray<{ id: string; discordUsername?: string }>
): string | undefined {
  if (!chosenContactId) return undefined;
  const matched = contactChoices.find(c => c.id === chosenContactId);
  if (matched && !matched.discordUsername) return chosenContactId;
  return undefined;
}
