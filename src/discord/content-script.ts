import { injectButton } from './ui';
import { captureDiscordTranscript, detectCounterpartyFromDocumentTitle } from './selection';
import { getSettings } from '../storage/settings';
import { summarizeForSalesforce, composeDescription } from '../anthropic/summarize';
import { identifyTarget } from '../matching/identify';
import { showPopup } from '../popup/popup';
import { buildSFTaskUrl } from '../salesforce/url-builder';
import { recordMapping } from '../storage/mappings';
import { listRecent } from '../storage/recent-sf';

// Salesforce's URL prefill silently truncates long defaultFieldValues.
// When the built URL would exceed this length, we fall back to copying the
// full description to the clipboard and putting a short placeholder in the URL.
const URL_SAFE_LENGTH = 1700;

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

  // Offer recent Contacts as picker options for connecting the activity
  const contactChoices = listRecent()
    .filter(r => r.type === 'Contact')
    .slice(0, 10)
    .map(r => ({ id: r.id, name: r.name }));

  const result = await showPopup({
    strategy,
    initialSubject: finalSubject,
    initialDescription: description,
    contactChoices
  });

  if (!result) return;

  const today = new Date().toISOString().slice(0, 10);

  // Try the full URL first. If it would be too long, copy full description to
  // clipboard and use a short placeholder in the URL.
  let urlDescription = result.description;
  let copiedToClipboard = false;
  let fullUrl = buildSFTaskUrl({
    sfDomain: settings.sfDomain,
    subject: result.subject,
    description: urlDescription,
    whatId: result.oppId,
    whoId: result.whoId || undefined,
    activityDate: today
  });

  if (fullUrl.length > URL_SAFE_LENGTH) {
    try {
      GM_setClipboard(result.description, { type: 'text', mimetype: 'text/plain' });
      copiedToClipboard = true;
      urlDescription =
        '[Full description copied to clipboard — please paste into this Comments field. ' +
        'Discord-to-SF logger truncates long content to stay under the Salesforce URL limit.]';
      fullUrl = buildSFTaskUrl({
        sfDomain: settings.sfDomain,
        subject: result.subject,
        description: urlDescription,
        whatId: result.oppId,
        whoId: result.whoId || undefined,
        activityDate: today
      });
    } catch (err) {
      console.error('[discord-sf-logger] clipboard copy failed, sending truncated description', err);
    }
  }

  GM_openInTab(fullUrl, { active: true });

  if (copiedToClipboard) {
    // Use a non-modal hint so we don't block the new tab from opening.
    setTimeout(() => {
      alert(
        'Discord → SF Logger\n\n' +
        'Your description is long, so it was copied to your clipboard instead of being put in the URL.\n\n' +
        'On the new Salesforce tab: click into the Comments field and paste (Ctrl+V) to fill it in.'
      );
    }, 100);
  }

  if (counterparty) {
    recordMapping(counterparty, result.oppId, result.oppName);
  }
}
