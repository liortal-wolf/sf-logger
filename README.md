# Discord → Salesforce Logger

Tampermonkey userscript that captures highlighted Discord conversations, summarizes them with Anthropic Claude, and creates a pre-filled "Log a Call" activity on the right Salesforce Opportunity. Built for Overwolf's BD / AM team.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome or Edge.
2. Click this link with Tampermonkey installed:
   `https://raw.githubusercontent.com/<REPO_OWNER>/<REPO_NAME>/main/dist/discord-sf-logger.user.js`
   Tampermonkey will prompt to install.
3. Open the Tampermonkey extension menu in your browser. You'll see three commands:
   - **Discord → SF: Set Anthropic API key** — paste your Anthropic API key (get one at console.anthropic.com).
   - **Discord → SF: Set SF domain** — defaults to `overwolf.lightning.force.com`; change if your org uses a different domain.
   - **Discord → SF: Set subject prefix** — defaults to `Discord: `; change if you want a different prefix.

## Use

1. Open a Discord conversation in your web browser (`discord.com`).
2. **Highlight** the messages you want to log.
3. Click the **"Log to SF"** button in the chat header.
4. A confirmation popup appears with an AI-generated subject + cleaned-up transcript.
   - If you have a Salesforce Opportunity tab open recently, that's the default target.
   - Otherwise the popup either remembers your last log for this contact, lets you pick from recent records, or asks you to paste an Opportunity ID.
5. Review, edit if needed, click **Send to Salesforce**.
6. Salesforce opens in a new tab with a pre-filled New Task form. Click **Save**. Done.

## How it works

- Uses **Salesforce Lightning URL prefill** (the documented `defaultFieldValues` query parameter). No SF API access required — runs in your existing logged-in browser session.
- Calls **Anthropic Claude Haiku** via Tampermonkey's `GM_xmlhttpRequest` (bypasses browser CORS).
- Stores everything (API key, learned mappings) in **Tampermonkey local storage** — never leaves your machine except for the Anthropic call.

## Auto-updates

Bump the `version` in `vite.config.ts`, build, push to `main`. Tampermonkey re-checks the script's `@updateURL` daily and prompts users to update.

## Development

```bash
npm install
npm run build       # builds dist/discord-sf-logger.user.js
npm test            # runs the test suite
npm run dev         # starts vite dev server with hot reload
```

## Known limitations

- Discord web only (no desktop app support).
- Logs to Opportunities only (not Accounts or Leads).
- One Salesforce org per installation (hardcoded in settings).
- Discord bot DM access is impossible by design (Discord ToS) — this script reads only what your own browser session can see.

## Troubleshooting

- **Button doesn't appear in Discord** — make sure you're on `discord.com`, not the desktop app. Check the Tampermonkey extension is enabled.
- **"Please pick a Salesforce target"** — the popup needs an Opportunity. Either open the right SF Opp tab first, or paste the Opportunity ID in the popup.
- **Anthropic API error** — check that your API key is valid in the Tampermonkey settings menu. Cost is pennies per month at typical use.
- **Saved Task doesn't appear under Activities** — verify Status was set to Completed; refresh the Opportunity Activity tab.
