import { injectButton } from './ui';
import { captureDiscordTranscript, detectCounterpartyFromDocumentTitle } from './selection';
import { getSettings } from '../storage/settings';
import { summarizeForSalesforce } from '../anthropic/summarize';
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

  const transcript = captureDiscordTranscript();
  if (!transcript.trim()) {
    alert('Discord → SF Logger: please highlight some messages first.');
    return;
  }
  console.log('[discord-sf-logger] captured transcript:', transcript);
  const counterparty = detectCounterpartyFromDocumentTitle(document.title);

  const strategy = identifyTarget({ counterparty });

  let summary;
  try {
    summary = await summarizeForSalesforce({
      apiKey: settings.anthropicApiKey,
      model: settings.anthropicModel,
      transcript,
      counterparty
    });
  } catch (err) {
    console.error('[discord-sf-logger] Anthropic failed, using raw transcript fallback', err);
    summary = { subject: 'general update', description: transcript };
  }

  const cleanedSubject = summary.subject.replace(/^\s*discord\s*:?\s*/i, '').trim() || 'general update';
  const finalSubject = `${settings.subjectPrefix}${cleanedSubject}`;

  const result = await showPopup({
    strategy,
    initialSubject: finalSubject,
    initialDescription: summary.description
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
