import { getSettings, setSetting } from '../storage/settings';

export function registerSettingsMenu(): void {
  GM_registerMenuCommand('Discord → SF: Set Anthropic API key', () => {
    const current = getSettings().anthropicApiKey;
    const next = prompt(
      'Paste your Anthropic API key (sk-ant-...). Leave blank to clear.',
      current
    );
    if (next === null) return;
    setSetting('anthropicApiKey', next.trim());
    alert('API key saved.');
  });

  GM_registerMenuCommand('Discord → SF: Set SF domain', () => {
    const current = getSettings().sfDomain;
    const next = prompt(
      'Salesforce Lightning domain (e.g. overwolf.lightning.force.com).',
      current
    );
    if (next === null) return;
    setSetting('sfDomain', next.trim());
    alert('SF domain saved.');
  });

  GM_registerMenuCommand('Discord → SF: Set subject prefix', () => {
    const current = getSettings().subjectPrefix;
    const next = prompt(
      "Subject prefix added to every logged conversation (default 'Discord: ').",
      current
    );
    if (next === null) return;
    setSetting('subjectPrefix', next);
    alert('Subject prefix saved.');
  });

  GM_registerMenuCommand('Discord → SF: Clear local cache', () => {
    const ok = confirm(
      'Clear all local Discord-SF Logger caches?\n\n' +
      'Will delete:\n' +
      '  • recent_sf_records (visited Opps + cached related Contacts)\n' +
      '  • recent_contacts (visited Contacts + cached related Opps + Discord handles)\n' +
      '  • learned_mappings (Discord counterparty → Opp memory)\n\n' +
      'Settings (API key, SF domain, subject prefix) are preserved.'
    );
    if (!ok) return;
    GM_deleteValue('recent_sf_records');
    GM_deleteValue('recent_contacts');
    GM_deleteValue('learned_mappings');
    console.log('[discord-sf-logger] local cache cleared');
    alert('Local cache cleared. Tool will rebuild as you browse Salesforce.');
  });
}
