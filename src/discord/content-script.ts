import { injectButton } from './ui';
import { captureDiscordTranscript, detectCounterpartyFromDocumentTitle } from './selection';
import { getSettings } from '../storage/settings';
import { summarizeForSalesforce, composeDescription } from '../anthropic/summarize';
import { identifyTarget } from '../matching/identify';
import { showPopup } from '../popup/popup';
import { buildSFTaskUrl } from '../salesforce/url-builder';
import { recordMapping } from '../storage/mappings';
import { listRecentContacts } from '../storage/recent-sf';

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
  const counterparty = detectCounterpartyFromDocumentTitle(document.title);

  const strategy = identifyTarget({ counterparty });

  let aiSummary: { subject: string; tldr: string };
  try {
    aiSummary = await summarizeForSalesforce({
      apiKey: settings.anthropicApiKey,
      model: settings.anthropicModel,
      transcript: captured.text,
      counterparty
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

  if (counterparty) {
    recordMapping(counterparty, result.oppId, result.oppName);
  }
}
