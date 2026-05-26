import { recordVisit, listRecent } from '../storage/recent-sf';

const POLL_INTERVAL_MS = 2000;

export function startSalesforceWatcher(): void {
  const tick = () => {
    const page = parseLightningUrl(window.location.href);
    if (!page) return;

    const name = readRecordName();
    const account = page.type === 'Opportunity' ? readLinkedAccount() : null;

    // Only write if we have a meaningful name OR new account info we didn't have before.
    // This avoids overwriting a previously good name with the ID-fallback during early ticks.
    const existing = listRecent().find(r => r.id === page.id);
    const hasGoodName = existing && existing.name !== existing.id;

    const shouldUpdate =
      // First time we see this record
      !existing ||
      // We finally found a real name where we previously fell back to the ID
      (name && !hasGoodName) ||
      // We finally found the linked Account where we didn't have one before
      (account && !existing.accountName);

    if (!shouldUpdate) {
      // Still bump lastFocusedAt for recency, but don't change anything else
      recordVisit({
        id: page.id,
        name: existing.name,
        type: page.type,
        accountName: existing.accountName,
        accountId: existing.accountId
      });
      return;
    }

    recordVisit({
      id: page.id,
      name: name ?? existing?.name ?? page.id,
      type: page.type,
      accountName: account?.name ?? existing?.accountName,
      accountId: account?.id ?? existing?.accountId
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

function readRecordName(): string | null {
  // Strategy 1: parse the SF tab title — most reliable across orgs
  const fromTitle = parseSFTitle(document.title);
  if (fromTitle) return fromTitle;

  // Strategy 2: scrape page header H1
  const headerH1 = document.querySelector<HTMLElement>(
    'h1.slds-page-header__title, h1.slds-var-p-around_xx-small'
  );
  const headerText = headerH1?.textContent?.trim();
  if (headerText && headerText.length > 0 && !looksLikeSFId(headerText)) {
    return headerText;
  }

  // Strategy 3: highlights panel output field (Lightning Web Components)
  const lwcName = document.querySelector<HTMLElement>(
    'records-highlights2 lightning-formatted-text, ' +
    'records-highlights2 lightning-formatted-name, ' +
    '[data-target-selection-name*="Name"] lightning-formatted-text'
  );
  const lwcText = lwcName?.textContent?.trim();
  if (lwcText && lwcText.length > 0 && !looksLikeSFId(lwcText)) {
    return lwcText;
  }

  return null;
}

function parseSFTitle(title: string): string | null {
  // Match anything before " | <ObjectType> | Salesforce" or before " | Salesforce"
  // Examples:
  //   "Acme Q2 Renewal | Opportunity | Salesforce"
  //   "Acme Inc | Account | Salesforce"
  //   "test opp lior discord tool | Salesforce"   (some orgs)
  const m1 = title.match(/^(.+?)\s*\|\s*(?:Opportunity|Account)\s*\|\s*Salesforce/i);
  if (m1) return m1[1].trim();
  const m2 = title.match(/^(.+?)\s*\|\s*Salesforce\s*$/i);
  if (m2 && !looksLikeSFId(m2[1].trim())) return m2[1].trim();
  return null;
}

function looksLikeSFId(s: string): boolean {
  return /^[a-zA-Z0-9]{15,18}$/.test(s);
}

function readLinkedAccount(): { name: string; id: string } | null {
  // Try several selectors — Lightning renders Account lookups differently across versions
  const candidates = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/lightning/r/Account/"], a[data-refid][href*="/Account/"]'
    )
  );
  for (const link of candidates) {
    const idMatch = link.href.match(/\/Account\/([a-zA-Z0-9]{11,18})/);
    const id = idMatch?.[1];
    const name = link.textContent?.trim();
    if (id && name && name.length > 0 && !looksLikeSFId(name)) {
      return { name, id };
    }
  }
  return null;
}

export const __testing__ = { parseLightningUrl, parseSFTitle };
