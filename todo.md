# Backlog

Tracked features that aren't yet scheduled. Promote to a spec under `docs/superpowers/specs/` when ready to design properly.

## Big-ticket items

### Salesforce Contact discovery (DEFERRED — investigated 2026-06-01, blocked)
Attempted: discover Contacts the user hasn't yet visited in SF, by calling Lightning UI API endpoints that search or list Contacts.

**Outcome:** all three discovery endpoints we tried are unavailable on the Overwolf SF org / Standard user license:
- `/services/data/v60.0/ui-api/search-suggestions?q=...&types=Contact` → 404 NOT_FOUND
- `/services/data/v60.0/search?q=FIND+{...}+IN+ALL+FIELDS+RETURNING+Contact(...)` → 401 INVALID_SESSION_ID (SOSL requires API-Enabled permission this license doesn't have)
- `/services/data/v60.0/ui-api/list-records/Contact/__Recent` → 404
- `/services/data/v60.0/ui-api/list-info/Contact` → 404

By contrast, these endpoints DO work and power the current data layer:
- `/services/data/v60.0/ui-api/records/<id>?fields=...`
- `/services/data/v60.0/ui-api/related-list-records/<id>/<relName>?fields=...`

**Conclusion:** discovery is blocked without a permission change at the SF org level (likely requires the "API Enabled" profile permission, which Overwolf does not grant Standard users). Workable workarounds (DOM-scraping the Contact list view page, maintaining a hardcoded list of IDs) aren't worth the brittleness.

**Current behavior is acceptable:** visit a Contact in SF once → tool caches Name + Discord field + related Opps → strategy 3 matches by user-ID → Discord field → Contact name first-word. Covers the common case.

### LinkedIn flow
Same end-to-end UX as Discord, but for LinkedIn messages.

- New module: `src/linkedin/` mirroring `src/discord/` (selection, ui, content-script).
- One line in `vite.config.ts` to add `https://www.linkedin.com/messaging/*` to the match list.
- Counterparty key should be the **LinkedIn profile URL** (the `linkedin.com/in/<slug>` part), not the display name — much more stable.
- Need to confirm: what's the SF custom field's API name on Contact for LinkedIn URL? (Probably `LinkedIn_URL__c` or `LinkedIn__c`. Check Contact page in SF.)
- New SF-side reader (analogous to `readContactDiscordUsername`) to capture LinkedIn URL from the Contact page.
- Open question: How does LinkedIn's messaging DOM expose the counterparty's profile URL? Need a brief reconnaissance session before writing the spec.
- Risk: LinkedIn changes their DOM more often than Discord — expect 1-2 selector fixes per year.

### Github Actions: auto-build on push
Right now you have to `npm run build` locally before committing or `dist/` lags the source. A simple Actions workflow can build on every push to `main` and commit the updated `dist/` automatically.

- Triggers on `push` to `main` (skip if commit was made by the bot itself, to avoid loops).
- Runs `npm ci && npm test && npm run build`.
- Commits `dist/discord-sf-logger.user.js` if changed, with a `[skip ci]` flag.
- Effect: you only edit source files; Tampermonkey users still get updates because `dist/` stays current.
- Effort: ~30 min including testing the action.

## Small QoL items

### Stage-based picker filtering
Currently we capture `stage` on cached Opps but show all of them. If the picker gets noisy for long-tenured Contacts (10+ historical Opps), default to showing **open Opps only** with a "show closed too" toggle. Revisit only if it actually becomes a problem.

### Account-scoped picker
A 4.5th strategy: when the Account is known but no specific Contact, show that Account's Opps. Niche — typically Account is only known *because* we found a Contact, in which case strategy 3 already handles it.

### Disambiguation prompt for duplicate Discord handles
Current behaviour for two Contacts sharing a Discord handle: pick the most-recently-focused. If this turns out to bite, add a "we found 2 Contacts with this handle — which one?" prompt before the picker.

### Background pre-warming
A one-time crawl on script install: open SF Contact list view, scrape every Contact's Discord field + linked Opps, cache them. Removes the "you have to visit Contact pages first" requirement entirely. Risky (opens many tabs, may trip SF rate limits) and likely supersedes the UI API fallback anyway.

## Architecture / hygiene

### Cross-user cache sharing
Each Tampermonkey install has its own cache today, by design (no backend). If the tool gets used by a wider team, a shared sync layer (Cloudflare Workers KV, Supabase, etc.) becomes worth considering. Out of scope until there's a clear need.

### Refactor scrapers into a single record-page pass
Today we have multiple SF scrapers that each walk shadow DOM independently (`readRecordName`, `readLinkedAccount`, `readContactDiscordUsername`, soon `readContactRelatedOpps` and `readOppContactRoles`). Could consolidate into one walk that fans out to multiple field readers. Pure-refactor with no user-facing change; defer unless performance becomes an issue.

### Auto-write Discord field back to Salesforce
After a popup pick that includes implicit handle learning (fold-in A from current spec), also queue a tab-open to the Contact's edit page with `defaultFieldValues=Discord__c=<handle>` so the value lands in SF too. Useful but adds tab clutter and a manual Save step. Hold off unless local-only learning proves insufficient.
