import { startDiscordIntegration } from './discord/content-script';
import { startSalesforceWatcher } from './salesforce/content-script';
import { registerSettingsMenu } from './settings/settings-ui';

registerSettingsMenu();

const host = window.location.hostname;

if (host === 'discord.com') {
  startDiscordIntegration();
} else if (host.endsWith('.lightning.force.com')) {
  startSalesforceWatcher();
}
