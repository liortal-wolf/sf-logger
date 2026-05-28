# Switch Salesforce data layer from DOM scraping to Lightning UI API

**Date:** 2026-05-28
**Author:** Lior (with Claude)
**Status:** Draft, awaiting implementation plan

## Problem

The current Salesforce integration scrapes record data out of the Lightning UI's DOM — Account name from anchor `innerText`, Discord field via shadow-DOM-walking layout-items, related Opportunities by walking related-list containers. Two compounding problems make this approach untenable:

1. **Reliability.** Lightning's DOM shape varies across orgs, layouts, page sections, and Salesforce releases. Even in the user's own org, the scraper can't find an Opportunity that is plainly visible on the Contact's Related tab (verified in `test3.png` — Opp is rendered, scraper returns zero). Closed shadow roots, lookup fields without anchor tags, and shifting class-suffix names all cause silent failures.

2. **UX friction.** Some data only renders when the user navigates to a specific sub-tab — e.g., a Contact's Opportunities live on the "Related" tab, not the default "Details" tab. The tool currently logs hints asking the user to click that tab. That's exactly the kind of busywork the tool is supposed to eliminate. BD/AM users open Contact pages to look at Contacts; they should not have to drill into structural sub-tabs to keep the tool in sync.

The user's principle: the tool should never require visiting SF pages or tabs beyond what the user would naturally visit to do their job.

## Solution

Salesforce ships a structured JSON **Lightning UI API** at `/services/data/<version>/ui-api/...` — the same API its own Lightning components consume. It is accessible to all authenticated users without the "API Enabled" profile permission (that gates only the SOAP/REST APIs, not the UI API), works via standard `fetch()` with `credentials: 'same-origin'` since the userscript runs in the SF browser session, and returns the data we need in a single round-trip per record.

Endpoints verified against the user's Overwolf org on 2026-05-28:

| Purpose | Endpoint | Status |
|---|---|---|
| Contact record fields | `GET /services/data/v60.0/ui-api/records/<contactId>?fields=Contact.Name,Contact.Discord__c,Contact.AccountId,Contact.Account.Name` | ✅ returns `fields.Name.value`, `fields.Discord__c.value`, etc. |
| Contact's related Opps | `GET /services/data/v60.0/ui-api/related-list-records/<contactId>/Opportunities?fields=Opportunity.Name,Opportunity.StageName,Opportunity.Account.Name` | ✅ returns `records[]` with `fields.Name.value`, `fields.StageName.displayValue`, `fields.Account.displayValue`, `fields.Account.value.id` |
| Opp record fields | `GET /services/data/v60.0/ui-api/records/<oppId>?fields=Opportunity.Name,Opportunity.StageName,Opportunity.AccountId,Opportunity.Account.Name` | inferred from Contact endpoint (same shape) |
| Opp's Contact Roles | `GET /services/data/v60.0/ui-api/related-list-records/<oppId>/OpportunityContactRoles?fields=OpportunityContactRole.ContactId,OpportunityContactRole.Contact.Name` | ✅ returns `records[].fields.ContactId.value`, `records[].fields.Contact.displayValue` |

The data we needed to surface — Discord username, Account, related Opps, Contact Roles — lands in a clean JSON response. No shadow-DOM walking, no tab navigation required. Whichever SF page the user is on, the watcher can fetch everything we need about that record.

## Goals

1. **Reliable** — replace DOM scraping for record data and related-list data with deterministic API calls.
2. **Zero extra navigation** — opening a Contact or Opp page is sufficient. No "click Related tab" hints. No "switch to Details tab" hints. No background scraping that depends on what's rendered.
3. **Same end-to-end UX** — the Discord-side Log-to-SF flow, the popup, strategy chain, learned mappings, "Clear local cache" — all unchanged. Only the data acquisition layer changes.
4. **Smaller surface** — delete the DOM-scraping code (`readLinkedAccount`, `readContactDiscordUsername`, `readContactRelatedOpps`, `readOppContactRoles`, `queryDeep`, `readVisibleText`, `findAllAccountLinks`, `locateAnchor`, the related-list parsers, the empty-scrape diagnostic, the retry-until-success machinery). Roughly 250 lines of brittle DOM code retired.

## Non-goals

- **On-demand Contact discovery from Discord side.** Finding an SF Contact you've never visited (e.g., via `ui-api/search-suggestions`) is still future work — captured in `todo.md`. This spec keeps the "user visits Contact in SF at least once" precondition.
- **Cross-origin API calls from Discord.com.** All API calls happen from the SF side of the userscript (within `overwolf.lightning.force.com`). The Discord side reads from the local cache.
- **SOQL via `/services/data/.../query`.** That endpoint requires "API Enabled" permission. We stick to the UI API.
- **Replacing `readRecordName` from `document.title`.** Title parsing is cheap, useful for the toast before the API responds, and harmless to keep. (Optional — could remove if it conflicts.)

## Design

### New module: `src/salesforce/ui-api.ts`

A thin, focused client. Pure functions returning Promises. No side effects beyond `fetch()`.

```ts
const API_VERSION = 'v60.0';

export interface UiApiContact {
  id: string;
  name: string;
  discordUsername: string | null;
  account?: { id: string; name: string };
}

export interface UiApiOpportunity {
  id: string;
  name: string;
  stage?: string;
  account?: { id: string; name: string };
}

export interface UiApiContactRole {
  contactId: string;
  contactName: string;
}

export async function fetchContact(id: string): Promise<UiApiContact | null>;
export async function fetchOpportunity(id: string): Promise<UiApiOpportunity | null>;
export async function fetchContactRelatedOpps(contactId: string): Promise<UiApiOpportunity[]>;
export async function fetchOppContactRoles(oppId: string): Promise<UiApiContactRole[]>;
```

Each function:
- Calls the verified endpoint with `credentials: 'same-origin'`.
- Returns `null` / `[]` on any error (network, 4xx/5xx, JSON parse failure, missing fields). Logs a single line at `console.warn` level so failures are visible without spamming.
- Reads only the fields we documented in the verified responses. No optional or speculative field extraction.

The Discord field's API name on Contact is `Discord__c` (verified). Hardcoded.

### Watcher integration

`src/salesforce/content-script.ts`:

`startSalesforceWatcher` continues to poll every 2 seconds and dispatch by URL via `parseLightningUrl`. On Contact/Opp page detection:

- `updateContact(id)` rewrites:
  - Once per session per Contact id, kick off `Promise.all([fetchContact(id), fetchContactRelatedOpps(id)])`.
  - On success, merge results into local storage via existing `recordContactVisit` (extended input: name, discordUsername, account, opps).
  - On failure, leave the cache untouched; do not retry the same id within the session.
  - Toast `Cached Contact <name> (@<discordUsername>) — <N> Opps` so the user sees confirmation.
- `updateOpportunity(id)` rewrites symmetrically.

The existing `recordVisit` / `recordContactVisit` storage interfaces stay as-is (they already accept the relevant fields). One field shape note: the Account on a Contact comes from `Contact.Account.Name` + `Contact.AccountId`. We can pass this through to the watcher's existing toast logic.

### Dedup and retry

`shouldRetryScrape` / `markScrapeEmpty` / `MAX_EMPTY_SCRAPE_POLLS` / `emptyScrapeCounts` / `scrapedRecordIds` are all removed — the API succeeds or fails deterministically, no retry-until-DOM-renders needed.

Replaced with a single module-level state map:

```ts
type ApiFetchState = 'success' | 'failed-permanently' | { failures: number };
const apiState = new Map<string, ApiFetchState>(); // key: "contact:<id>" or "opp:<id>"
```

Before kicking off `fetchContact(id)`:
- If state is `'success'` or `'failed-permanently'`: skip (already done or aborted).
- If state is `{ failures: n }` and `n >= 3`: mark as `'failed-permanently'`, skip.
- Otherwise: fetch. On success → `'success'`. On retryable error (network, 5xx) → increment failures. On non-retryable (401/403/404, malformed) → `'failed-permanently'`.

This bounds retries while still surviving transient network blips. State is per-session — resets on full page reload.

### Removal of DOM scrapers

Delete from `src/salesforce/content-script.ts`:
- `readLinkedAccount()`, `findAllAccountLinks()`, `locateAnchor()`, `readAccountFromLabeledField()`
- `readContactDiscordUsername()`, `readDiscordFromVisibleText()`
- `readContactRelatedOpps()`, `readOppContactRoles()`
- `parseContactRelatedOppsFromDom()`, `parseOppContactRolesFromDom()`
- `queryDeep()`, `readVisibleText()`, `readLabelInside()`, `readValueInside()`, `looksLikeButtonOrLabel()`, `escapeForRegex()`
- `findAllInShadow()` (no remaining caller after the above are removed)
- `isBadAccountName()` and its regexes (used only by `readLinkedAccount` and `readAccountFromLabeledField`)
- `shouldRetryScrape()`, `markScrapeSuccess()`, `markScrapeEmpty()`, related constants/maps
- The "click Related tab" hint logs
- The "account candidates: N found" log (was logging every 2s)

Keep:
- `parseLightningUrl()` — pure, used to detect record id from URL
- `parseSFTitle()`, `looksLikeSFId()` — used by `readRecordName` for the title-based name fallback
- `readRecordName()` — used for the toast, lightweight, harmless
- `showToast()`, `ensureToastContainer()`, toast container DOM helpers
- `tryFillPendingTask()`, `findCommentsTextarea()`, `setNativeValue()` — completely unrelated to record-data scraping
- `__testing__` export — slim down to just `parseLightningUrl`, `parseSFTitle`

### Delete corresponding tests

- `tests/salesforce/related-list.test.ts` — pure-DOM parser tests for the deleted `parseContactRelatedOppsFromDom` / `parseOppContactRolesFromDom`. Gone.
- `tests/salesforce/read-discord.test.ts` — tests `readDiscordFromVisibleText`. Gone.
- `tests/salesforce/parse-url.test.ts` — kept (still tests `parseLightningUrl`, `parseSFTitle`).

### New tests

- `tests/salesforce/ui-api.test.ts` — unit tests for each `fetch*` function. Mock `globalThis.fetch` with snapshot responses captured from the user's verified test runs (we have the JSON shapes already in this spec). Cover happy path, 404, 401, network error, and malformed JSON.

### Behavior changes

- Toast still appears when a Contact / Opp gets cached; message text now includes Opp count where applicable.
- Watcher's poll cost drops significantly — no more shadow-DOM traversal per tick. The 2s poll is now URL detection + a one-shot API call per new record id.
- After clicking on a Contact page, expect a `Cached Contact <name>` toast within ~1 second instead of the previous behavior where it could take 10s+ of retry polling or never resolve.

### Error handling matrix

| Failure | Behavior |
|---|---|
| Network offline / fetch throws | Mark id as failed, retry up to 2 more times within the session, then give up for this id. Log one warning per id. |
| `401 Unauthorized` (session expired) | Log a single warning per session: "SF session not authenticated; data sync paused." Stop all future API calls for the session. |
| `403 Forbidden` (org-level UI API restriction) | Same as 401 — log once, stop. |
| `404 Not Found` (record deleted or wrong ID) | Log warning, do not cache, do not retry. |
| Field missing from response (e.g., `Discord__c` not on schema) | Use what we got; missing field treated as `null`. No retry. |
| Malformed JSON | Log warning, do not retry. |

### Migration

No storage schema change. Existing caches keep working. New caches are written via the same `recordVisit` / `recordContactVisit` paths — fields populated more reliably and more completely than the DOM scrapers managed, but the shape is unchanged.

Existing tests for `recordVisit` / `recordContactVisit` / `identifyTarget` continue to pass unchanged.

## Testing

| File | What it covers |
|---|---|
| `tests/salesforce/ui-api.test.ts` (new) | Each of the four fetch functions: happy-path parse, 404/401 returning null/empty, network error, malformed JSON, missing field |
| `tests/salesforce/parse-url.test.ts` (kept) | Still relevant for URL routing |
| Existing storage / matching / identify / mappings / handle-learning / clear-cache / counterparty tests | All pass unchanged |

Manual verification (browser):
1. Reinstall script, hard-refresh both Discord and SF tabs.
2. Run "Clear local cache" via Tampermonkey menu.
3. Open a Contact page — expect toast `Cached Contact <name> (@<handle>) — N Opps` within ~1s.
4. Open Tampermonkey storage — Contact has `discordUsername`, `opps` populated.
5. Open an Opp page — expect toast `Cached Opportunity <name> (<account>)`. Storage shows `account` and `contacts`.
6. From Discord, Log-to-SF with a counterparty matching the cached Contact — contact-scoped picker fires with the right Opps.
7. Verify no "account candidates" log spam. No "click Related tab" hints.

## Risks

1. **API version drift.** Pinned to `v60.0`. Salesforce maintains backward compat well; v60 should remain accessible for 3+ years. If they ever retire it, bump the constant and reverify endpoints. Low ongoing maintenance cost.
2. **`Discord__c` API name varies per org.** Verified for Overwolf's org. If colleagues' orgs use a different API name, the field comes back undefined and the Contact gets cached without a Discord handle. The structural fall-through to the popup's manual Contact picker still works (fold-in A learns the handle on first manual pick).
3. **Related-list relationship API names vary.** `Opportunities` and `OpportunityContactRoles` are standard Salesforce names. If a colleague's org has renamed them via custom relationship config, the related-list fetch returns 404. Defer handling — confirm with the user if it ever happens in practice.
4. **`OpportunityContactRoles` may not exist on every Opp record type.** SF allows disabling Contact Roles on specific record types. If so, the endpoint returns 404; we cache the Opp without contacts. No regression vs current behavior.
5. **Account is fetched as a nested record** (`Account.value.id`, `Account.displayValue`). If the user lacks read access to the Account, the field comes back as `null`. Handle defensively.
