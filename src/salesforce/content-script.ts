import { recordVisit } from '../storage/recent-sf';

const POLL_INTERVAL_MS = 2000;

let lastSeenUrl = '';

export function startSalesforceWatcher(): void {
  const tick = () => {
    if (window.location.href === lastSeenUrl) return;
    lastSeenUrl = window.location.href;
    const page = parseLightningUrl(window.location.href);
    if (!page) return;
    const name = readRecordName() ?? page.id;
    recordVisit({ id: page.id, name, type: page.type });
  };

  window.addEventListener('popstate', tick);
  window.addEventListener('hashchange', tick);
  window.addEventListener('focus', tick);
  setInterval(tick, POLL_INTERVAL_MS);
  tick();
}

function parseLightningUrl(url: string): { id: string; type: 'Opportunity' | 'Account' } | null {
  const match = url.match(/\/lightning\/r\/(Opportunity|Account)\/([a-zA-Z0-9]{11,18})/);
  if (!match) return null;
  return { type: match[1] as 'Opportunity' | 'Account', id: match[2] };
}

function readRecordName(): string | null {
  const h1 = document.querySelector('h1.slds-page-header__title, h1.slds-var-p-around_xx-small');
  const text = h1?.textContent?.trim();
  return text && text.length > 0 ? text : null;
}

export const __testing__ = { parseLightningUrl };
