# Cache Contact ↔ Opportunity links + four adjacent UX improvements

**Date:** 2026-05-27
**Author:** Lior (with Claude)
**Status:** Draft, awaiting implementation plan

## Problem

When a user clicks "Log to SF" from a Discord conversation today, the tool can identify the target Opportunity in three good cases:

1. A Salesforce Opportunity tab was focused recently (`open-sf-tab` strategy).
2. The user has logged this exact Discord counterparty before (`learned-mapping` strategy).
3. The user is willing to pick from a global recent list, or paste an Opp ID manually.

The gap: a brand-new Discord conversation with someone who is already a known Contact in Salesforce — connected to one or more Opportunities — still forces the user to switch to SF, find the right Opp, and either keep its tab open or copy its ID. The tool already knows the Discord username for cached Contacts (stored in `Contact.Discord__c` and read into `recent_contacts` since the prior fix). What's missing is the Contact ↔ Opportunity link.

## Goals

1. **Primary** — surface the matched Contact's Opportunities in the picker when the Discord counterparty maps to a known Contact, without ever leaving Discord. Auto-select that Contact in the popup's WhoId dropdown.
2. **Adjacent fold-ins** — four small UX wins that touch the same files we're modifying anyway:
   - **A. Implicit Discord-handle learning** — popup picks teach the local cache when SF's Discord field is empty.
   - **B. Single-result auto-select** — pre-select the Opp when the picker has only one choice.
   - **C. "Clear local cache" menu command** — Tampermonkey-menu utility for debugging and org-restructure days.
   - **D. Discord user-ID as the stable counterparty key** — survive username renames; user ID is permanent.

This is "zero **extra** setup" — there's no new user-facing configuration. Coverage grows naturally as the user (and each colleague separately) browses Salesforce.

## Non-goals

The following are explicitly out of scope and tracked in `todo.md`:

- Querying Salesforce programmatically for Contacts/Opps the user has never visited (would require SF UI API or REST access).
- LinkedIn integration (separate spec, separate flow).
- Filtering by Opportunity stage (Closed-Won / Closed-Lost hiding). We capture Stage in the cache but display all Opps for now; revisit if the picker becomes noisy.
- Auto-writing the Discord field back to Salesforce. Fold-in A captures the binding **locally** instead — same UX win, none of the cross-tab risk.
- Cross-user cache sharing. Each Tampermonkey install has its own cache.
- Background pre-warming (e.g., crawling every Contact in SF).
- Account-scoped picker (when the Account is known but no Contact). Niche; can layer on later.

## Design

### Data model

Two existing interfaces in `src/types.ts` grow optional fields. Both new fields default to `undefined` for pre-existing storage entries — no migration step.

```ts
export interface RecentContact {
  id: string;
  name: string;
  visitedAt: string;
  lastFocusedAt: string;
  discordUsername?: string;
  discordUserId?: string;                                                      // NEW (fold-in D)
  opps?: Array<{ id: string; name: string; accountName?: string; stage?: string }>; // NEW (primary)
}

export interface RecentOpportunity {
  id: string;
  name: string;
  visitedAt: string;
  lastFocusedAt: string;
  account?: { id: string; name: string };
  contacts?: Array<{ id: string; name: string }>; // NEW (primary)
}
```

The captured Discord counterparty type (returned by `detectCounterpartyFromDocumentTitle` and friends) also widens, from a bare `string` to:

```ts
export interface DiscordCounterparty {
  username: string;    // always present
  userId?: string;     // present when extractable from page DOM (fold-in D)
}
```

All call sites that previously took a `string` counterparty are updated to take `DiscordCounterparty`. Where only the username is used, they read `.username`.

### Scrapers

Two new functions in `src/salesforce/content-script.ts`, both following the `queryDeep` + `innerText` pattern that worked for the Discord-username reader:

- **`readContactRelatedOpps(): Array<{ id, name, accountName?, stage? }>`** — on a Contact page, walks shadow DOM to locate the "Opportunities" related list (typically `force-related-list-single-container` or similar wrapping a list of rows with `/Opportunity/<id>` anchors). For each row, extract Opp ID from the anchor's href, Opp name from `innerText`, and the Account / Stage from sibling cells if visible. Capped at 10 entries (most recent first).

- **`readOppContactRoles(): Array<{ id, name }>`** — on an Opp page, walks shadow DOM to locate the "Contact Roles" related list. For each row, extract Contact ID from the `/Contact/<id>` anchor and the visible Contact name. Capped at 10.

Both scrapers run at most once per page view, but with retry-until-success: a record id is only added to the `scrapedRecordIds` set once the scraper returns at least one row. If the first poll runs before the related-list DOM has mounted (returns `[]`), the next poll retries; the watcher gives up only after 5 consecutive empty polls (~10 s) for that record id. This keeps the cost low on steady-state pages (one shadow walk per Contact / Opp visit) while tolerating slow LWC mounts.

### Storage merge

Inside `recordContactVisit` (in `src/storage/recent-sf.ts`), when `input.opps` is provided we **union** with the existing entry's `opps` instead of replacing — Salesforce's related-list view sometimes shows only the rows above the fold, so a re-scrape on a different scroll position should add to what we've already captured. Union is keyed by Opp id; later writes win on metadata (name / accountName / stage) so corrections propagate. Then cap at 10 entries, most recently seen first.

Same union-then-cap semantics for `recordVisit` and its new `contacts` input.

### Matching

The strategy chain in `src/matching/identify.ts` gains one new entry, slotted between `learned-mapping` and the global picker:

```
1. open-sf-tab           — Opp tab focused in last 4h (unchanged)
2. learned-mapping       — prior log for this Discord counterparty (unchanged)
3. contact-scoped-picker — NEW: counterparty matches a cached Contact whose opps are known
4. picker                — global recent Opps (unchanged)
5. manual                — paste an Opp ID (unchanged)
```

A new union variant on `IdentifyStrategy`:

```ts
| {
    kind: 'contact-scoped-picker';
    contact: { id: string; name: string; discordUsername: string };
    choices: Array<{ id: string; name: string; accountName?: string; stage?: string }>;
  }
```

Strategy 3 logic, in order:

1. **Prefer user-ID match (fold-in D).** If `counterparty.userId` is set, find the most-recently-focused Contact whose `discordUserId` equals it. Exact-string compare; Discord IDs are numeric snowflakes, no normalization needed.
2. **Fall back to username match.** Normalize both sides with a shared `normalizeDiscordHandle(s)` helper (lowercase, strip leading `@`, trim whitespace), then find the most-recently-focused Contact whose normalized `discordUsername` equals the normalized counterparty username.
3. If a Contact is found and has `opps` with at least one entry, return `contact-scoped-picker`. Otherwise fall through.

`normalizeDiscordHandle` lives in `src/matching/identify.ts` and is exported so the SF scraper (when reading the Discord field) can apply the same normalization at write-time, eliminating any case/whitespace mismatch.

### Popup behaviour

The popup template (`src/popup/popup-template.ts` and `src/popup/popup.ts`) gains a thin branch for the new strategy plus two adjacent UX wins:

- A one-line hint above the picker reads: `Showing 3 Opps for Kesem (@mutualmagic)`.
- The picker dropdown lists only the matched Contact's opps (no global recent mixed in).
- The Contact dropdown (the existing `whoId` selector) **pre-selects** the matched Contact, so the user doesn't have to scroll.
- **Fold-in B — single-result auto-select:** when the contact-scoped picker has exactly one Opp, the picker auto-selects it on render. The user still clicks Send to confirm, so they always see what they're about to log.
- **Fold-in A — implicit handle learning on send:** when the user clicks Send, if the selected Contact's cached `discordUsername` is empty *and* we have a Discord counterparty username for this conversation, we write the counterparty (username + userId if available) onto that Contact's storage entry. From the next Log-to-SF onward the contact-scoped strategy picks up automatically. This is purely local — Salesforce is not modified.

In all other strategy kinds the popup renders exactly as it does today — no visual regression for users without cached Contact-Opp links.

### Discord-side counterparty extraction (fold-in D)

`src/discord/selection.ts` grows a helper `detectCounterparty(): DiscordCounterparty | null` that returns both the username (today's behaviour) and, when available, the Discord user ID:

- **Username** continues to come from `document.title` parsing (today's `detectCounterpartyFromDocumentTitle`). Always present for 1:1 DMs.
- **User ID** is extracted from the highlighted-messages DOM. Each Discord message element carries the author's user ID in a `data-author-id` attribute (or, on newer Discord builds, in `aria-labelledby` / message-key formats — exact selector chain belongs in the implementation plan, not here). If the highlighted selection has consistent author IDs *other than the current user's*, that's the counterparty's ID. If the selection is mixed or includes only the current user's messages, `userId` is omitted and we fall back to username matching.

Existing call sites (`identifyTarget`, `recordMapping`, `composeDescription`) are updated to take `DiscordCounterparty`. Learned mappings get keyed by `userId` when present (preferred), `username` otherwise — so a Discord rename doesn't break a previously-learned mapping.

### "Clear local cache" menu command (fold-in C)

`src/settings/settings-ui.ts` registers one new Tampermonkey menu entry: **Discord → SF: Clear local cache**. When invoked it:

1. Shows a `confirm()` dialog listing what will be cleared (`recent_sf_records`, `recent_contacts`, `learned_mappings`).
2. On confirm, deletes those three keys via `GM_deleteValue`. Settings (API key, SF domain, subject prefix) are preserved.
3. Logs a `[discord-sf-logger] local cache cleared` console line. Toast surfaces on the next SF page load via the watcher's normal flow.

No other UI; the command is for org-restructure days and debugging.

### Data flow

```
SF Contact page visited
  → updateContact runs
    → readContactDiscordUsername     (existing)
    → readContactRelatedOpps         (NEW, first-poll-per-id only)
    → recordContactVisit             (extended: unions opps)

SF Opportunity page visited
  → updateOpportunity runs
    → readRecordName                 (existing)
    → readLinkedAccount              (existing)
    → readOppContactRoles            (NEW, first-poll-per-id only)
    → recordVisit                    (extended: unions contacts)

Discord "Log to SF" clicked
  → detectCounterparty()              (NEW: extends today's title-parser, also reads data-author-id)
  → identifyTarget({ username, userId? })
    → tries open-sf-tab               (existing)
    → tries learned-mapping           (existing, now keyed by userId if present)
    → tries contact-scoped-picker     (NEW: userId match preferred, username fallback)
    → tries global picker             (existing)
    → falls through to manual         (existing)

  → user picks Contact + Opp, clicks Send
    → if selected Contact's discordUsername is empty in cache,
      write counterparty.username (and userId if present) into that Contact's storage entry  (fold-in A)
    → existing send flow runs as today
```

### Error and edge cases

| Situation | Behaviour |
|---|---|
| Contact matched but `opps` empty / undefined | Fall through to global picker. No regression vs today. |
| Multiple Contacts share a Discord handle | Take the most-recently-focused. Rare; logged at debug level if it happens. |
| Counterparty is a group DM | `detectCounterparty()` returns falsy → strategy 3 skipped → existing chain proceeds. |
| Discord field on SF Contact is empty | Contact gets cached without `discordUsername` → strategy 3 can't match directly. Fold-in A repairs this on the next manual pick. |
| Discord user ID can't be extracted (highlighted-message DOM lacks `data-author-id`) | `userId` is left undefined, matching falls back to username. Same behaviour as today, no regression. |
| User renames themselves on Discord | If we previously learned a username→Opp mapping, it would break — but the new userId-first learned mapping survives the rename. |
| Related-list DOM not yet mounted on first poll | Scraper returns `[]`; nothing written; next poll retries. After 5 consecutive empty polls (~10 s) the record id is marked done to avoid permanent retry on pages that genuinely have no related list. A subsequent navigation away and back clears the marker. |
| Cache grows past 10 opps for one Contact | Drop the oldest (by last-seen-at) when capping. |
| User triggers "Clear local cache" | All three storage keys deleted. Settings (API key, SF domain, subject prefix) preserved. Tool degrades to "first-use" state and rebuilds the cache as the user browses SF. |

### Performance

- The new scrapers run **only on the first poll after navigation to a new record id**, not every 2-second tick. Total added cost: one shadow-piercing DOM walk per Contact / Opp visit, executed asynchronously inside the existing watcher.
- Storage writes batch in the existing `recordContactVisit` / `recordVisit` calls — no new GM_setValue rounds.
- The new identify strategy executes one `listRecentContacts()` scan plus one `.find()` per Log-to-SF click. Negligible.

## Testing

| File | Coverage |
|---|---|
| `tests/storage/recent-sf.test.ts` (extend) | Union-merge of `opps` and `contacts` on repeat visits; oldest-dropped capping at 10; implicit-handle-learning write (fold-in A) only fires when cached field is empty; existing entries without the new fields deserialize cleanly |
| `tests/matching/identify.test.ts` (extend) | Strategy 3 user-ID match preferred over username match (fold-in D); username match with `@` / casing / whitespace variations via `normalizeDiscordHandle`; falls through when no match; falls through when `opps` is empty; preserves existing strategies' precedence; learned-mapping now keyed by userId when present |
| `tests/salesforce/related-list.test.ts` (new) | Pure-function parsing of related-list row data from snapshot DOM fragments — covers Opportunities list (with and without Stage column) and Contact Roles list |
| `tests/discord/counterparty.test.ts` (new) | `detectCounterparty()` returns `{username, userId}` when message DOM has `data-author-id`; returns `{username}` only when missing or mixed; correctly excludes the current user's own messages |
| `tests/storage/settings.test.ts` (extend) | "Clear local cache" command deletes `recent_sf_records`, `recent_contacts`, `learned_mappings` but preserves `settings` keys |

Real-SF verification of the scrapers is manual — same as `readContactDiscordUsername` — because happy-dom can't emulate Lightning's shadow tree. Verification checklist lives in the implementation plan, not here.

## Backward compatibility

- All new fields are optional and default to `undefined` when reading legacy entries.
- The strategy chain is purely additive — the new strategy only fires when its preconditions are met; everything else routes through the unchanged chain.
- Existing tests remain green without modification (new tests are additive).

## Risks

1. **Related-list DOM is the most variable part of Lightning.** Column visibility changes with layout, and SF occasionally renames internal tags. The scraper must treat optional columns (account, stage) as truly optional and degrade gracefully to id+name.
2. **Discord `data-author-id` attribute might change name.** Discord's web client uses internal attribute names that have shifted across redesigns. The implementation should try multiple known selectors and degrade to username-only when none match — same approach we already use for `readContactDiscordUsername`.
3. **Discord handle uniqueness is not guaranteed.** Two Contacts could share a handle through user error. The most-recently-focused tiebreak is good enough for now; if it bites in practice we revisit by adding a disambiguation prompt. User-ID matching (fold-in D) sidesteps the issue when an ID is available.
4. **Implicit handle learning (fold-in A) can mis-bind.** If the user picks the wrong Contact in the popup once, that Contact gets the wrong Discord handle stored locally. Mitigation: the write only happens when the cached field is *empty* (we never overwrite a known-good value). The "Clear local cache" command (fold-in C) is the escape hatch.
5. **Tampermonkey storage is per-install.** Each colleague's cache is their own — there's no shared state, by design (per the no-API constraint). Documented in `todo.md` as a possible future feature.
