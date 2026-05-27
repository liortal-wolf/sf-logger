import { injectButton } from './ui';
import { captureDiscordTranscript, detectCounterparty } from './selection';
import { getSettings } from '../storage/settings';
import { summarizeForSalesforce, composeDescription } from '../anthropic/summarize';
import { identifyTarget } from '../matching/identify';
import { showPopup } from '../popup/popup';
import { buildSFTaskUrl } from '../salesforce/url-builder';
import { recordMapping } from '../storage/mappings';
import { recordContactVisit, listRecentContacts } from '../storage/recent-sf';

// Discord's logged-in user has a unique ID embedded in several DOM places. We
// read it once per click. The most reliable source we've found is the user
// account panel at the bottom-left of the channel list — it carries the user's
// own ID on a wrapper element. If we can't find it, fall back to undefined and
// detectCounterparty will degrade to username-only matching.
function readCurrentDiscordUserId(): string | null {
  const candidates = [
    '[class*="panels"] [class*="avatar"]',
    '[data-list-item-id^="me-"]',
    '[class*="container"][class*="userPanelOuter"]'
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    const id =
      el?.getAttribute('data-user-id') ??
      el?.closest('[data-user-id]')?.getAttribute('data-user-id') ??
      el?.closest('[data-list-item-id^="me-"]')?.getAttribute('data-list-item-id')?.replace(/^me-/, '');
    if (id && /^\d{15,21}$/.test(id)) return id;
  }
  return null;
}

// SF's defaultFieldValues silently truncates around 1500-2000 chars of total URL.
// For long descriptions we put a placeholder in the URL and queue the full text
// in storage; the SF content script picks it up and auto-fills the Comments
// textarea after the New Task page renders.
const URL_DESCRIPTION_LIMIT = 1200;
const PENDING_FILL_KEY = 'pending_task_fill';
const PENDING_FILL_TTL_MS = 90 * 1000;

export function startDiscordIntegration(): void {
  injectButton(handleLogClick);
}

async function handleLogClick(): Promise<void> {
  const settings = getSettings();
  if (!settings.anthropicApiKey) {
    alert('Discord → SF Logger: please set your Anthropic API key in the Tampermonkey menu first.');
    return;
  }

  const captured = captureDiscordTranscript();
  if (!captured.text.trim()) {
    alert('Discord → SF Logger: no messages found to log. Try again from inside the channel.');
    return;
  }
  console.log(
    `[discord-sf-logger] captured ${captured.messageCount} messages via ${captured.source}:`,
    captured.text
  );
  const counterparty = detectCounterparty(readCurrentDiscordUserId());
  if (!counterparty) {
    alert('Discord → SF Logger: could not detect the conversation. Open a 1:1 DM or channel and try again.');
    return;
  }

  const strategy = identifyTarget({ counterparty });

  let aiSummary: { subject: string; tldr: string };
  try {
    aiSummary = await summarizeForSalesforce({
      apiKey: settings.anthropicApiKey,
      model: settings.anthropicModel,
      transcript: captured.text,
      counterparty: counterparty.username
    });
  } catch (err) {
    console.error('[discord-sf-logger] Anthropic call failed, falling back to subject="general update"', err);
    aiSummary = { subject: 'general update', tldr: '' };
  }

  const description = composeDescription(aiSummary.tldr, captured.text);
  const cleanedSubject = aiSummary.subject.replace(/^\s*discord\s*:?\s*/i, '').trim() || 'general update';
  const finalSubject = `${settings.subjectPrefix}${cleanedSubject}`;

  const contactChoices = listRecentContacts()
    .slice(0, 10)
    .map(r => ({ id: r.id, name: r.name, discordUsername: r.discordUsername }));

  const result = await showPopup({
    strategy,
    initialSubject: finalSubject,
    initialDescription: description,
    contactChoices
  });

  if (!result) return;

  if (result.learnHandleForContactId) {
    const existing = listRecentContacts().find(c => c.id === result.learnHandleForContactId);
    if (existing) {
      recordContactVisit({
        id: existing.id,
        name: existing.name,
        discordUsername: counterparty.username || existing.discordUsername,
        discordUserId: counterparty.userId ?? existing.discordUserId,
        opps: existing.opps
      });
      console.log(`[discord-sf-logger] learned Discord handle for Contact ${existing.id} = ${counterparty.username}${counterparty.userId ? ` (id ${counterparty.userId})` : ''}`);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  // Queue full description for auto-fill regardless of length. The SF content
  // script picks it up after the Task/new page renders and writes it into the
  // Comments textarea using the native-setter trick (bypasses React/LWC state).
  GM_setValue(PENDING_FILL_KEY, {
    description: result.description,
    expiresAt: Date.now() + PENDING_FILL_TTL_MS
  });

  // Short URL prefill for everything else. If the description is short, also
  // include it in the URL so it appears immediately; the auto-fill is idempotent.
  const urlDescription =
    result.description.length <= URL_DESCRIPTION_LIMIT ? result.description : '';

  const fullUrl = buildSFTaskUrl({
    sfDomain: settings.sfDomain,
    subject: result.subject,
    description: urlDescription,
    whatId: result.oppId,
    whoId: result.whoId || undefined,
    activityDate: today
  });

  GM_openInTab(fullUrl, { active: true });

  recordMapping(counterparty, result.oppId, result.oppName);
}
