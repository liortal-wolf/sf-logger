import { startDiscordIntegration } from './discord/content-script';
import { startSalesforceWatcher } from './salesforce/content-script';
import { registerSettingsMenu } from './settings/settings-ui';

// Bump this string whenever you ship a change you want to verify is loaded.
// Look for "[discord-sf-logger] loaded build" in DevTools console — if the build
// tag doesn't match what you last shipped, the userscript wasn't reinstalled.
const BUILD_TAG = '2026-05-27-account-scrape-fix';
console.log(`[discord-sf-logger] loaded build ${BUILD_TAG} on ${window.location.hostname}`);

registerSettingsMenu();

const host = window.location.hostname;

if (host === 'discord.com') {
  startDiscordIntegration();
} else if (host.endsWith('.lightning.force.com')) {
  startSalesforceWatcher();
}
