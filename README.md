# Discord → Salesforce Logger

Tampermonkey userscript for Overwolf BD/AM: capture a Discord conversation, summarize it with Claude, and log it as a Salesforce Activity on the right Opportunity — in two clicks.

## Install (5 minutes, one time)

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome or Edge).
2. With Tampermonkey enabled, click this link — it'll prompt to install:
   `https://raw.githubusercontent.com/liortal-wolf/sf-logger/main/dist/discord-sf-logger.user.js`
3. Open the Tampermonkey extension menu and run **Discord → SF: Set Anthropic API key**. Ask Lior (`lior.tal@overwolf.com`) for the shared team key.

**Auto-updates:** Tampermonkey re-checks the script daily. New versions ship in the background; you'll be prompted in-browser when one is ready.

## Use

1. On `discord.com`, open the conversation.
2. **Highlight** the messages you want to log.
3. Click the **Log to SF** button in the chat header.
4. Review the popup (AI-generated subject, transcript, target Opp/Contact) → **Send to Salesforce**.
5. A new tab opens with a pre-filled Activity — click **Save**. Done.

The tool finds the right target Opportunity automatically when it can:
- If you have a Salesforce Opp tab open, that's used.
- Otherwise, if the Discord username matches a Salesforce Contact you've visited before, the tool surfaces only that Contact's Opportunities in the picker.
- Otherwise, you pick from your recent SF Opps or paste an Opp ID.

For the contact-scoped path to work, visit the relevant Contact's page in Salesforce once — the tool caches their Discord field, Account, and related Opps in one shot via Salesforce's UI API. No need to drill into the Related tab or any sub-page.

## Tampermonkey menu commands

- **Set Anthropic API key** — paste the team key (one-time setup).
- **Set SF domain** — defaults to `overwolf.lightning.force.com`.
- **Set subject prefix** — defaults to `Discord: ` (appears at the start of every logged Activity subject).
- **Clear local cache** — wipes the local Opp/Contact/learned-mapping caches without touching your settings. Useful for debugging or when Salesforce data has changed materially.

## Troubleshooting

- **No "Log to SF" button** — must be `discord.com` (not the desktop app). Check Tampermonkey is enabled on the tab.
- **"Could not detect the conversation"** — open a 1:1 DM or channel and try again. The tool reads the Discord page title to identify the conversation; group DMs may not match.
- **Anthropic API error** — set or refresh the team key via the Tampermonkey extension menu.
- **Popup shows "(not detected)" for Account/Opp** — your local cache is empty for that record. Visit it once in Salesforce, then try again.
- **Updates aren't picking up** — Tampermonkey dashboard → click the script → File → Check for updates.

## Limitations

Discord web only · Logs to Opportunities only · One Salesforce org per install · Contact must be visited in SF once before the contact-scoped picker fires for them.

## For maintainers

```bash
npm install
npm test              # 115 tests across 13 files
npm run build         # produces dist/discord-sf-logger.user.js
npm run dev           # vite dev server with hot reload
```

To ship an update: bump `version` in `vite.config.ts`, push to `main`. The CI workflow (`.github/workflows/build.yml`) rebuilds `dist/` on every push, so source-only commits stay current automatically. Tampermonkey picks the new version up within 24 hours for all installed users.

Specs and plans live in `docs/superpowers/specs/`. Deferred work and known limitations are tracked in `todo.md`.
