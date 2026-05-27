# Discord → Salesforce Logger

Tampermonkey userscript for Overwolf BD/AM: capture a Discord conversation, summarize it with Claude, and log it as a Salesforce Activity on the right Opportunity — in two clicks.

## Install (5 minutes, one time)

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome or Edge).
2. With Tampermonkey enabled, click this link — it'll prompt to install:
   `https://raw.githubusercontent.com/liortal-wolf/sf-logger/main/dist/discord-sf-logger.user.js`
3. Open the Tampermonkey extension menu and run **Discord → SF: Set Anthropic API key** (grab one from `console.anthropic.com` — cost is pennies per month).

**Auto-updates:** Tampermonkey re-checks the script daily. When a new version ships you'll be prompted in-browser; click update and you're current.

## Use

1. On `discord.com`, open the conversation.
2. **Highlight** the messages you want to log.
3. Click the **Log to SF** button in the chat header.
4. Review the popup (AI-generated subject, transcript, target Opp/Contact) → **Send to Salesforce**.
5. A new tab opens with a pre-filled Activity — click **Save**. Done.

The tool auto-detects the target Opportunity from your open Salesforce tabs and remembers Contact ↔ Discord-username mappings as you visit Contact pages.

## Troubleshooting

- **No "Log to SF" button** — must be `discord.com` (not the desktop app). Check Tampermonkey is enabled on the tab.
- **"Please pick a Salesforce target"** — open the Opportunity tab first, or paste the Opp ID in the popup.
- **Anthropic API error** — set or refresh the key via the Tampermonkey extension menu.
- **Wrong Account name cached** — revisit the Opportunity page once; the script re-verifies on each visit.

## Limitations

Discord web only · Logs to Opportunities only · One Salesforce org per install.

## For maintainers

```bash
npm install
npm test              # 54 tests
npm run build         # produces dist/discord-sf-logger.user.js
```

To ship an update to everyone: bump `version` in `vite.config.ts`, `npm run build`, commit and push to `main`. Tampermonkey picks it up within 24 hours for all installed users.
