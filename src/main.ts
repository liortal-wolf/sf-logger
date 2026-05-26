// Entry point. Dispatch to discord or salesforce based on hostname.
const host = window.location.hostname;

if (host === 'discord.com') {
  console.log('[discord-sf-logger] running on Discord');
} else if (host.endsWith('.lightning.force.com')) {
  console.log('[discord-sf-logger] running on Salesforce Lightning');
}
