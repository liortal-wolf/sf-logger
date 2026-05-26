# Discord-to-Salesforce Activity Logger — Design

**Status:** Design approved by user, pending implementation plan
**Date:** 2026-05-25
**Owner:** Lior Tal (lior.tal@overwolf.com)
**Audience (v1):** Lior + ~5 teammates at Overwolf, with the option to share more broadly later

## 1. Problem

Sales conversations happen in Discord (1:1 DMs, group DMs, and occasionally private channels in customer-run servers). When a conversation contains something significant — a renewal commitment, a pricing objection, a meeting agreement — it needs to be logged on the relevant Salesforce Opportunity so anyone else visiting the account can see the context.

The current workflow is:

1. Finish a Discord chat
2. Manually select messages, copy
3. Switch to Salesforce, search for the Opportunity, open it
4. Click Activities → Log a Call → set Subject = "Discord", paste raw transcript into Comments
5. Save

This is slow, the pasted transcript is unformatted, and there's no summary at the top of the activity timeline — every entry just says "Discord" until you click in.

## 2. Goal

A near-one-click flow that captures a Discord conversation (or a highlighted portion of one), summarizes it with an LLM, and creates a Salesforce activity on the right Opportunity, with minimal manual steps.

## 3. Non-goals

- Real-time / automatic logging of every Discord message. Logging is **user-initiated**, only when something significant happens.
- Reading Discord DMs server-side via the Discord Bot API. Bots cannot access DMs they're not party to. The tool only sees what the user can see in their browser.
- Logging from the Discord desktop app. Web-only for v1; the desktop app would require a different integration model.
- Bidirectional sync. This is a one-way Discord → Salesforce posting tool.
- Editing or updating existing SF activities after they've been created. New activities only.

## 4. Validated assumptions (from manual testing 2026-05-25)

These were verified by manually constructing URLs and inspecting the result in Overwolf's production SF org:

- **Lightning URL hacking is enabled** in the org. `https://overwolf.lightning.force.com/lightning/o/Task/new?defaultFieldValues=...` opens a pre-filled New Task page.
- **The following fields can be set via `defaultFieldValues`**: `Subject`, `Description`, `WhatId` (links to Opportunity), `Status` (e.g. `Completed`), `ActivityDate` (YYYY-MM-DD).
- **Setting `Status=Completed`** places the saved record under "Past Activity" on the Opportunity, matching the placement of manually-logged calls.
- **The user's "Log a Call → Discord" convention does not use the `Type` picklist.** "Discord" is set in the Subject field as a category marker; the Type field is not on the page layout. So our tool does **not** need to set `Type` or `TaskSubtype`.
- **A record created via URL prefill is visually and structurally indistinguishable** from one created via the "Log a Call" composer in this org's setup. Both render with the green Task icon, Status=Completed badge, same field layout.

## 5. Architecture

A **Tampermonkey userscript**, distributed via a public GitHub repo, auto-updating through Tampermonkey's `@updateURL` / `@downloadURL` mechanism.

The script runs in two contexts in the user's browser:

1. **In `discord.com/*`** — injects a "Log to SF" button into the Discord web UI (chat header). Also wires up a right-click menu on selected text.
2. **In `*.lightning.force.com/*`** — listens for navigation events to record the user's recently-viewed Opportunities and Accounts (for the "figures it out on its own" matching logic).

The script also talks to the Anthropic API directly from the browser (no middleman server), and stores state in `GM_setValue` / `GM_getValue` (Tampermonkey's local storage primitive).

Salesforce is updated by opening a new tab with a pre-filled URL hack — no SF API access required, just the user's existing logged-in browser session.

### Why Tampermonkey instead of a Chrome extension (v1)

- Single-file deploy: one `.user.js` file in a public GitHub repo
- Built-in auto-update: bumping `@version` triggers an update prompt for all installed users
- Trivial install for teammates: visit raw GitHub URL, Tampermonkey prompts to install
- No Chrome Web Store review, no manifest config overhead, easy to iterate

If v1 proves out and we want to package more polished UX, we can migrate to a proper Chrome extension later — most of the JS carries over.

## 6. User journey (happy path)

1. User is in `@joe_acme`'s Discord DM. They highlight the last several messages.
2. Right-click → "Log to SF" *(or click the button injected into the Discord chat header).*
3. The script grabs:
   - The selected text (or, if nothing is selected, a fallback: the last ~30 visible messages in the channel)
   - Counterparty username (`joe_acme`)
   - Channel/server metadata for context
4. The script calls the Anthropic API (Haiku 4.5) with the transcript. The model returns:
   - A one-line summary suitable for the Subject (e.g. `Joe confirmed Q2 renewal at current pricing`)
   - A cleaned-up version of the transcript for the Description (with proper attribution, timestamps stripped of clutter)
5. The script identifies the target SF Opportunity using the strategy in §7.
6. A small confirmation popup appears showing: proposed Subject, proposed Description, resolved SF target. User can edit any field, then clicks **Send**.
7. The script opens a new tab to the SF URL with `defaultFieldValues` populated: `Subject=Discord: <summary>`, `Description=<cleaned transcript>`, `WhatId=<OppId>`, `Status=Completed`, `ActivityDate=<today>`.
8. The pre-filled New Task page appears in SF. User reviews, clicks **Save**.
9. The script records the mapping `joe_acme → <OppId>` in local storage for next time.

Total clicks: 3 (Discord button, popup Send, SF Save). Total time: ~5 seconds for the user, plus a 1–2 second LLM call.

## 7. Salesforce record identification ("figures it out on its own")

Three strategies, tried in order:

**Strategy A — Open SF tab.**
The script enumerates the user's open browser tabs (via the Tampermonkey cross-tab messaging primitive) and looks for tabs at `*.lightning.force.com/lightning/r/Opportunity/<id>/...`. If exactly one matches, that record ID is used. If multiple match, the most recently focused one wins (the SF content-script records `lastFocusedAt` per tab). Highest confidence.

**Strategy B — Learned mapping.**
On every successful log, the script records `<discord-counterparty-username> → <OppId>` (plus a `last-used-at` timestamp) in local storage. If a record exists for the current Discord counterparty, it's suggested as the default in the confirmation popup. Gets smarter with use; no manual config.

**Strategy C — Recent SF records picker.**
The salesforce-side content-script also records every Opportunity/Account the user visits (rolling window of the last ~20). If A and B both fail, the popup shows this list as a picker. User picks one.

**Strategy D — Manual entry (fallback of last resort).**
User can paste an Opportunity ID directly. Useful for first-time logs with a brand-new contact who has no recent SF tab and no learned mapping.

The popup always shows the chosen strategy ("Detected from open SF tab" / "Learned from last log" / "Pick from recent" / "Manual"), so the user knows what's happening and can override.

## 8. Components

| File | Context | Responsibility |
|---|---|---|
| `discord-content.js` | `discord.com/*` | Inject button + right-click handler. Capture selection + DM context. Send to bridge. |
| `salesforce-content.js` | `*.lightning.force.com/*` | Watch for Opp/Account page navigation. Record visited record IDs to local storage. |
| `bridge.js` | Both contexts (cross-tab message bus) | Receive log event from Discord side. Run record-identification strategies. Call Anthropic. Construct SF URL. Open it in a new tab. |
| `popup.html` / `popup.js` | Popup UI shown on click | Confirmation panel: shows resolved SF target, lets user edit Subject/Description, has Send button. |
| `settings.html` / `settings.js` | Standalone Tampermonkey menu | Anthropic API key entry, default Opportunity (optional), feature flags (e.g. skip-popup mode). |

Tampermonkey doesn't have a true multi-file model for userscripts — in practice this will be one `.user.js` file with these as logical sections. The split is for clarity; we can keep them in modules if we use a bundler like `vite-plugin-monkey` (decided in implementation plan).

## 9. Storage / state

All in Tampermonkey local storage (browser-local, never leaves the user's machine):

- `anthropic_api_key` — encrypted at rest by the browser
- `learned_mappings`: `{ "<discord-username>": { "oppId": "006...", "oppName": "...", "lastUsed": "2026-05-25T..." } }`
- `recent_sf_records`: `[ { "id": "006...", "name": "...", "type": "Opportunity", "visitedAt": "..." }, ... ]` (rolling window of 20)
- `settings`: `{ "skipPopupWhenConfident": false, "anthropic_model": "claude-haiku-4-5-20251001", "subject_prefix": "Discord: " }`

## 10. Distribution

- Public GitHub repo. Suggested name: `overwolf/discord-sf-logger` (or `lior-tal/discord-sf-logger` if personal).
- The userscript file lives at e.g. `dist/discord-sf-logger.user.js`.
- The script header includes:
  ```
  // @updateURL    https://raw.githubusercontent.com/<owner>/<repo>/main/dist/discord-sf-logger.user.js
  // @downloadURL  https://raw.githubusercontent.com/<owner>/<repo>/main/dist/discord-sf-logger.user.js
  // @version      0.1.0
  ```
- Teammates install once by visiting the raw URL with Tampermonkey installed.
- Bumping `@version` and pushing to `main` triggers Tampermonkey's auto-update on each user's next browser session.
- README documents: install instructions, how to enter Anthropic API key, troubleshooting, known limitations.

## 11. API key handling

- User enters their own Anthropic API key once via the Tampermonkey menu's settings page.
- Stored locally only. Never committed, never transmitted anywhere except to `api.anthropic.com`.
- Estimated cost at a few conversations per week: pennies to single dollars per month using Haiku 4.5.

## 12. Risks and fallbacks

| Risk | Mitigation |
|---|---|
| Discord changes DOM and button injection breaks | Userscript is one file; patch + push + auto-update propagates fix. |
| SF Lightning URL hack format changes | Documented and stable since ~2018; if it ever breaks we add a DOM-fallback that drives the actual "Log a Call" composer (more brittle but precise). |
| User not logged into SF when script fires | Script detects no SF session in any open tab → popup shows "Please log into Salesforce first" before doing anything. |
| User accidentally sends sensitive Discord content to Anthropic | Confirmation popup shows the exact text being sent to the API; user can edit or cancel before send. |
| Two teammates log the same conversation independently | Both Tasks appear in SF; no dedup logic. Acceptable at low volume. Could add a "last logged at" indicator in the popup as future work. |
| Anthropic API down / API key invalid | Popup shows raw transcript as fallback Description; user can still log without summary. Subject defaults to "Discord". |
| User's selection contains @mentions, embeds, or images | v1 captures text only; embeds/images shown as `[image]` placeholder in Description. Future enhancement: optional attachment upload. |
| Org disables URL hacking in the future | Same as DOM-fallback path above. |

## 13. Out of scope for v1

- Logging from Discord desktop app
- Attachment / image upload to SF
- Activity dedup or "already logged?" detection
- Multi-language support in the LLM summary
- Logging to Accounts or Leads (only Opportunities for v1)
- Sandbox / non-prod SF org support (single hardcoded domain for v1)
- Telemetry on tool usage

These can be revisited based on user feedback after v1 ships.

## 14. Success criteria

- Time to log a Discord conversation drops from current (~2 minutes including SF navigation and formatting) to under 30 seconds end-to-end.
- The created activity is visually indistinguishable in the Opportunity timeline from a manually-logged Discord call.
- 3+ teammates install and use it within the first month.
- Zero data leaks: API key never committed; no Discord content transmitted anywhere except to Anthropic (and to Salesforce via the user's own session).
