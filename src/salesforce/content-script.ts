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
    const account = page.type === 'Opportunity' ? readLinkedAccount() : null;
    recordVisit({
      id: page.id,
      name,
      type: page.type,
      accountName: account?.name,
      accountId: account?.id
    });
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

// Parse the SF tab title — Salesforce sets it to "<RecordName> | <ObjectType> | Salesforce"
// once the page has loaded. Falls back to DOM scraping for early ticks before the title is set.
function readRecordName(): string | null {
  const fromTitle = parseSFTitle(document.title);
  if (fromTitle) return fromTitle;

  // Fallback: scrape from the page header H1 (selectors vary by Lightning version)
  const h1 = document.querySelector(
    'h1.slds-page-header__title, ' +
    'h1.slds-var-p-around_xx-small, ' +
    '[data-target-selection-name*="Name"] lightning-formatted-text, ' +
    'records-highlights2 lightning-formatted-text'
  );
  const text = h1?.textContent?.trim();
  return text && text.length > 0 ? text : null;
}

function parseSFTitle(title: string): string | null {
  // Examples:
  //   "Acme Q2 Renewal | Opportunity | Salesforce"
  //   "Acme Inc | Account | Salesforce"
  const match = title.match(/^(.+?)\s*\|\s*(Opportunity|Account)\s*\|\s*Salesforce/i);
  return match ? match[1].trim() : null;
}

// On an Opportunity page, follow the Account lookup link to extract the
// linked Account's name + ID.
function readLinkedAccount(): { name: string; id: string } | null {
  const link = document.querySelector<HTMLAnchorElement>('a[href*="/lightning/r/Account/"]');
  if (!link) return null;
  const idMatch = link.href.match(/\/lightning\/r\/Account\/([a-zA-Z0-9]{11,18})/);
  const id = idMatch?.[1];
  const name = link.textContent?.trim();
  if (!id || !name) return null;
  return { name, id };
}

export const __testing__ = { parseLightningUrl, parseSFTitle };
