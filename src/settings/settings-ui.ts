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
}
