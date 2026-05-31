import { startDiscordIntegration } from './discord/content-script';
import { startSalesforceWatcher } from './salesforce/content-script';
import { registerSettingsMenu } from './settings/settings-ui';

// Bump this string whenever you ship a change you want to verify is loaded.
// Look for "[discord-sf-logger] loaded build" in DevTools console — if the build
// tag doesn't match what you last shipped, the userscript wasn't reinstalled.
const BUILD_TAG = '2026-05-31-discord-title';
console.log(
  `%c[discord-sf-logger] loaded build ${BUILD_TAG} on ${window.location.hostname}`,
  'background: #5865f2; color: #fff; padding: 4px 8px; border-radius: 4px; font-weight: 600;'
);

registerSettingsMenu();

const host = window.location.hostname;

if (host === 'discord.com') {
  startDiscordIntegration();
} else if (host.endsWith('.lightning.force.com')) {
  startSalesforceWatcher();
}
