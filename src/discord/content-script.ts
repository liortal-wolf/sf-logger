import { injectButton } from './ui';
import { captureDiscordTranscript, detectCounterpartyFromDocumentTitle } from './selection';
import { getSettings } from '../storage/settings';
import { summarizeForSalesforce, composeDescription } from '../anthropic/summarize';
import { identifyTarget } from '../matching/identify';
import { showPopup } from '../popup/popup';
import { buildSFTaskUrl } from '../salesforce/url-builder';
import { recordMapping } from '../storage/mappings';

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

  // Verbatim transcript — never AI-modified. User saw exactly this in the popup.
  const description = composeDescription(aiSummary.tldr, captured.text);
  const cleanedSubject = aiSummary.subject.replace(/^\s*discord\s*:?\s*/i, '').trim() || 'general update';
  const finalSubject = `${settings.subjectPrefix}${cleanedSubject}`;

  const result = await showPopup({
    strategy,
    initialSubject: finalSubject,
    initialDescription: description
  });

  if (!result) return;

  const url = buildSFTaskUrl({
    sfDomain: settings.sfDomain,
    subject: result.subject,
    description: result.description,
    whatId: result.oppId,
    activityDate: new Date().toISOString().slice(0, 10)
  });
  GM_openInTab(url, { active: true });

  if (counterparty) {
    recordMapping(counterparty, result.oppId, result.oppName);
  }
}
