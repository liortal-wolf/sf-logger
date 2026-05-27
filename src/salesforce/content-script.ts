import { recordVisit, listRecent, recordContactVisit } from '../storage/recent-sf';

const POLL_INTERVAL_MS = 2000;
const PENDING_FILL_KEY = 'pending_task_fill';

interface PendingTaskFill {
  description: string;
  expiresAt: number;
}

// Anchors whose visible text is "Foo Bar(N)" — used to filter out related-list
// shortcut links when we scrape the Account name.
const RELATED_LIST_TEXT_RE = /\(\s*\d+\s*\)\s*$/;

export function startSalesforceWatcher(): void {
  const tick = () => {
    const page = parseLightningUrl(window.location.href);
    if (page) {
      if (page.type === 'Opportunity') updateOpportunity(page.id);
      else if (page.type === 'Contact') updateContact(page.id);
      // Standalone Account visits are intentionally NOT tracked — the Account
      // lives inline on its Opportunity, so we only care about an Account name
      // when scraping it from an Opp page.
    }
    tryFillPendingTask();
  };

  window.addEventListener('popstate', tick);
  window.addEventListener('hashchange', tick);
  window.addEventListener('focus', tick);
  setInterval(tick, POLL_INTERVAL_MS);
  tick();
}

function updateOpportunity(id: string): void {
  const name = readRecordName();
  const account = readLinkedAccount();

  const existing = listRecent().find(r => r.id === id);
  const hasGoodName = existing && existing.name !== existing.id;
  const cachedAccountIsBad =
    !!existing?.account?.name && RELATED_LIST_TEXT_RE.test(existing.account.name);

  const shouldUpdate =
    !existing ||
    (name && !hasGoodName) ||
    (account && (!existing.account || cachedAccountIsBad)) ||
    cachedAccountIsBad; // always try to fix a known-bad cached value

  if (!shouldUpdate) {
    recordVisit({ id, name: existing.name, account: existing.account });
    return;
  }

  // Decide what account info to persist:
  //  - prefer freshly-scraped account
  //  - if we have nothing fresh AND the existing cached value is "bad" ("(N)"
  //    pattern), drop it rather than re-persisting bad data
  //  - otherwise keep the existing one
  const finalAccount =
    account ?? (cachedAccountIsBad ? undefined : existing?.account);

  recordVisit({
    id,
    name: name ?? existing?.name ?? id,
    account: finalAccount
  });

  if (!existing || (name && !hasGoodName) || (account && (!existing.account || cachedAccountIsBad))) {
    const parts: string[] = [];
    if (name) parts.push(name);
    if (finalAccount?.name) parts.push(`(${finalAccount.name})`);
    showToast(`Cached Opportunity ${parts.join(' ')}`, 'success');
  } else if (!account) {
    console.log(`[discord-sf-logger] no linked Account found yet for Opp ${id} — will keep trying`);
  }
}

function updateContact(id: string): void {
  const name = readRecordName();
  const existing = listRecent(); // not relevant — contacts are separate
  void existing;

  const finalName = name ?? id;
  recordContactVisit({ id, name: finalName });

  if (name) {
    showToast(`Cached Contact: ${name}`, 'success');
  }
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

function findAllAccountLinks(): HTMLAnchorElement[] {
  const results: HTMLAnchorElement[] = [];
  const visited = new WeakSet<Element | Document | ShadowRoot>();

  const walk = (root: Document | ShadowRoot) => {
    if (visited.has(root)) return;
    visited.add(root);

    const anchors = root.querySelectorAll<HTMLAnchorElement>('a[href*="/Account/"]');
    for (const a of anchors) {
      if (/\/Account\/[a-zA-Z0-9]{11,18}/.test(a.href)) results.push(a);
    }

    for (const el of Array.from(root.querySelectorAll('*'))) {
      const sr = (el as Element).shadowRoot;
      if (sr) walk(sr);
    }
  };

  walk(document);
  return results;
}

function readLinkedAccount(): { name: string; id: string } | null {
  const candidates = findAllAccountLinks();

  // Score each candidate; lower score = better. Canonical /view links beat
  // /related/<list>/view shortcut links; clean text beats "(N)" suffixes.
  const scored = candidates.map(link => {
    const text = link.textContent?.trim() ?? '';
    const idMatch = link.href.match(/\/Account\/([a-zA-Z0-9]{11,18})/);
    const id = idMatch?.[1] ?? '';

    if (!id || !text || looksLikeSFId(text)) return { link, text, id, score: 999 };

    let score = 0;
    // canonical /view URL strongly preferred
    if (!/\/Account\/[a-zA-Z0-9]+\/view(?:\?|$|#)/.test(link.href)) score += 10;
    // related-list shortcut text is disqualifying
    if (RELATED_LIST_TEXT_RE.test(text)) score += 100;
    // text shouldn't be a known related-list label
    if (/^(Account Team|Contact Roles|Notes|Files|Activity|Activities|Cases|Opportunities)/i.test(text)) score += 50;

    return { link, text, id, score };
  });

  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best || best.score >= 100) return null;
  return { name: best.text, id: best.id };
}

// ---------- Auto-fill Task/new Comments ----------

function tryFillPendingTask(): void {
  if (!/\/lightning\/o\/Task\/new/.test(window.location.href)) return;

  const pending = GM_getValue<PendingTaskFill | null>(PENDING_FILL_KEY, null);
  if (!pending) return;
  if (Date.now() > pending.expiresAt) {
    GM_deleteValue(PENDING_FILL_KEY);
    return;
  }

  const textarea = findCommentsTextarea();
  if (!textarea) return;

  if (textarea.value === pending.description) {
    GM_deleteValue(PENDING_FILL_KEY);
    return;
  }

  setNativeValue(textarea, pending.description);
  console.log('[discord-sf-logger] auto-filled Comments textarea via DOM');
  showToast('Description auto-filled', 'success');
  GM_deleteValue(PENDING_FILL_KEY);
}

function findCommentsTextarea(): HTMLTextAreaElement | null {
  const all: HTMLTextAreaElement[] = [];
  const visited = new WeakSet<Element | Document | ShadowRoot>();

  const walk = (root: Document | ShadowRoot) => {
    if (visited.has(root)) return;
    visited.add(root);

    for (const ta of Array.from(root.querySelectorAll<HTMLTextAreaElement>('textarea'))) {
      all.push(ta);
    }

    for (const el of Array.from(root.querySelectorAll('*'))) {
      const sr = (el as Element).shadowRoot;
      if (sr) walk(sr);
    }
  };
  walk(document);

  if (all.length === 0) return null;
  if (all.length === 1) return all[0];

  for (const ta of all) {
    const container = ta.closest('lightning-textarea, [data-target-selection-name*="Description"], .slds-form-element');
    const label = container?.textContent?.toLowerCase() ?? '';
    if (label.includes('comment') || label.includes('description')) {
      return ta;
    }
  }

  all.sort((a, b) => (b.rows ?? 0) - (a.rows ?? 0));
  return all[0];
}

function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = el.tagName === 'TEXTAREA'
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---------- Toasts ----------

let toastContainer: HTMLDivElement | null = null;

function showToast(message: string, kind: 'success' | 'info' = 'info'): void {
  ensureToastContainer();
  if (!toastContainer) return;

  console.log(`[discord-sf-logger] toast: ${message}`);

  const toast = document.createElement('div');
  toast.textContent = `✓ ${message}`;
  Object.assign(toast.style, {
    background: kind === 'success' ? '#04844b' : '#16325c',
    color: '#fff',
    padding: '14px 18px',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
    opacity: '0',
    transition: 'opacity 200ms ease, transform 200ms ease',
    transform: 'translateY(12px)',
    maxWidth: '360px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    pointerEvents: 'auto',
    border: '2px solid rgba(255,255,255,0.2)'
  });

  toastContainer.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => toast.remove(), 250);
  }, 5500);
}

function ensureToastContainer(): void {
  if (toastContainer && document.body.contains(toastContainer)) return;
  toastContainer = document.createElement('div');
  toastContainer.id = 'dsfl-toast-container';
  Object.assign(toastContainer.style, {
    position: 'fixed',
    bottom: '32px',
    right: '32px',
    zIndex: '2147483647',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    pointerEvents: 'none'
  });
  (document.body || document.documentElement).appendChild(toastContainer);
}

export const __testing__ = { parseLightningUrl, parseSFTitle };
