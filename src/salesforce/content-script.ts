import { recordVisit, listRecent } from '../storage/recent-sf';

const POLL_INTERVAL_MS = 2000;

export function startSalesforceWatcher(): void {
  const tick = () => {
    const page = parseLightningUrl(window.location.href);
    if (!page) return;

    const name = readRecordName();
    const account = page.type === 'Opportunity' ? readLinkedAccount() : null;

    const existing = listRecent().find(r => r.id === page.id);
    const hasGoodName = existing && existing.name !== existing.id;

    const shouldUpdate =
      !existing ||
      (name && !hasGoodName) ||
      (account && !existing.accountName);

    if (!shouldUpdate) {
      recordVisit({
        id: page.id,
        name: existing.name,
        type: page.type,
        accountName: existing.accountName,
        accountId: existing.accountId
      });
      return;
    }

    if (page.type === 'Opportunity' && !account && !existing?.accountName) {
      console.log(
        `[discord-sf-logger] no linked Account found yet for Opp ${page.id} — will keep trying`
      );
    } else if (account) {
      console.log(`[discord-sf-logger] linked Account captured: ${account.name} (${account.id})`);
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

function parseLightningUrl(
  url: string
): { id: string; type: 'Opportunity' | 'Account' | 'Contact' } | null {
  const match = url.match(/\/lightning\/r\/(Opportunity|Account|Contact)\/([a-zA-Z0-9]{11,18})/);
  if (!match) return null;
  return { type: match[1] as 'Opportunity' | 'Account' | 'Contact', id: match[2] };
}

function readRecordName(): string | null {
  const fromTitle = parseSFTitle(document.title);
  if (fromTitle) return fromTitle;

  const headerH1 = document.querySelector<HTMLElement>(
    'h1.slds-page-header__title, h1.slds-var-p-around_xx-small'
  );
  const headerText = headerH1?.textContent?.trim();
  if (headerText && headerText.length > 0 && !looksLikeSFId(headerText)) {
    return headerText;
  }

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
  const m1 = title.match(/^(.+?)\s*\|\s*(?:Opportunity|Account|Contact)\s*\|\s*Salesforce/i);
  if (m1) return m1[1].trim();
  const m2 = title.match(/^(.+?)\s*\|\s*Salesforce\s*$/i);
  if (m2 && !looksLikeSFId(m2[1].trim())) return m2[1].trim();
  return null;
}

function looksLikeSFId(s: string): boolean {
  return /^[a-zA-Z0-9]{15,18}$/.test(s);
}

// Lightning often renders Account lookups inside shadow roots (e.g.
// <lightning-formatted-lookup>). Plain document.querySelector won't see them.
// This recursive walker pierces all OPEN shadow roots to find anchor tags
// pointing at /Account/<id>.
function findAllAccountLinks(): HTMLAnchorElement[] {
  const results: HTMLAnchorElement[] = [];
  const visited = new WeakSet<Element | Document | ShadowRoot>();

  const walk = (root: Document | ShadowRoot) => {
    if (visited.has(root)) return;
    visited.add(root);

    const anchors = root.querySelectorAll<HTMLAnchorElement>('a[href*="/Account/"]');
    for (const a of anchors) {
      if (/\/Account\/[a-zA-Z0-9]{11,18}/.test(a.href)) {
        results.push(a);
      }
    }

    const all = root.querySelectorAll('*');
    for (const el of all) {
      const sr = (el as Element).shadowRoot;
      if (sr) walk(sr);
    }
  };

  walk(document);
  return results;
}

function readLinkedAccount(): { name: string; id: string } | null {
  const candidates = findAllAccountLinks();
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
