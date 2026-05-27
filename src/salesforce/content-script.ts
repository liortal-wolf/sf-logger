import { recordVisit, listRecent, recordContactVisit, listRecentContacts } from '../storage/recent-sf';

const POLL_INTERVAL_MS = 2000;
const PENDING_FILL_KEY = 'pending_task_fill';

interface PendingTaskFill {
  description: string;
  expiresAt: number;
}

// Patterns that indicate a link is NOT the canonical Account name link:
//   "Account Team(0)"  → related-list count suffix
//   "View All", "View AllOpportunities", "Edit", "Add" → action button labels
const RELATED_LIST_COUNT_RE = /\(\s*\d+\s*\)\s*$/;
const ACTION_LABEL_RE = /^(View|Add|Edit|New|Delete|Show|Hide|Clone|Share|Print|Export|Import|Manage|All|Save|Cancel)\b/i;
const RELATED_LIST_LABEL_RE = /^(Account Team|Contact Roles|Notes|Files|Activity|Activities|Cases|Opportunities|Tasks|Events|Campaign History|Quotes|Orders)\b/i;

export function startSalesforceWatcher(): void {
  const tick = () => {
    const page = parseLightningUrl(window.location.href);
    if (page) {
      if (page.type === 'Opportunity') updateOpportunity(page.id);
      else if (page.type === 'Contact') updateContact(page.id);
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
  const cachedAccountIsBad = existing?.account?.name ? isBadAccountName(existing.account.name) : false;

  const shouldUpdate =
    !existing ||
    (name && !hasGoodName) ||
    (account && (!existing.account || cachedAccountIsBad)) ||
    cachedAccountIsBad;

  if (!shouldUpdate) {
    recordVisit({ id, name: existing!.name, account: existing!.account });
    return;
  }

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
    console.log(`[discord-sf-logger] no canonical Account link found yet for Opp ${id} — will keep trying`);
  }
}

function updateContact(id: string): void {
  const name = readRecordName();
  const discordUsername = readContactDiscordUsername();

  const existing = listRecentContacts().find(c => c.id === id);
  const hasGoodName = existing && existing.name !== existing.id;
  const hasDiscordUsername = !!existing?.discordUsername;

  const shouldUpdate =
    !existing ||
    (name && !hasGoodName) ||
    (discordUsername && !hasDiscordUsername);

  if (!shouldUpdate) {
    // Bump lastFocusedAt only (recordContactVisit always does that)
    recordContactVisit({
      id,
      name: existing!.name,
      discordUsername: existing!.discordUsername
    });
    return;
  }

  recordContactVisit({
    id,
    name: name ?? existing?.name ?? id,
    discordUsername: discordUsername ?? existing?.discordUsername
  });

  if (!existing || (name && !hasGoodName) || (discordUsername && !hasDiscordUsername)) {
    const parts: string[] = [];
    if (name) parts.push(name);
    if (discordUsername) parts.push(`(@${discordUsername})`);
    showToast(`Cached Contact ${parts.join(' ')}`, 'success');
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

function isBadAccountName(s: string): boolean {
  return (
    RELATED_LIST_COUNT_RE.test(s) ||
    ACTION_LABEL_RE.test(s) ||
    RELATED_LIST_LABEL_RE.test(s) ||
    looksLikeSFId(s)
  );
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

// Walk up through both regular parents and shadow DOM hosts to find where
// the anchor lives. Page-header (highlights) is where the canonical Account
// name link lives. Related-list view-manager wrappers indicate related-list
// shortcut links we want to avoid.
function locateAnchor(link: Element): 'highlights' | 'related-list' | 'other' {
  let el: Node | null = link;
  while (el) {
    if (el instanceof Element) {
      const tag = el.tagName.toUpperCase();
      if (
        tag === 'RECORDS-HIGHLIGHTS2' ||
        tag === 'FORCE-HIGHLIGHTS' ||
        el.classList.contains('slds-page-header')
      ) {
        return 'highlights';
      }
      if (
        tag.startsWith('FORCE-RELATED-LIST') ||
        tag === 'FORCE-LST-COMMON-LIST-VIEW' ||
        el.classList.contains('slds-card') && el.querySelector('header')?.textContent?.match(/\(\d+\)/)
      ) {
        return 'related-list';
      }
    }
    const root = (el as Node).getRootNode();
    if (root instanceof ShadowRoot) {
      el = root.host;
    } else if (el instanceof Element) {
      el = el.parentElement;
    } else {
      el = null;
    }
  }
  return 'other';
}

function readLinkedAccount(): { name: string; id: string } | null {
  const candidates = findAllAccountLinks();

  const scored = candidates.map(link => {
    const text = link.textContent?.trim() ?? '';
    const idMatch = link.href.match(/\/Account\/([a-zA-Z0-9]{11,18})/);
    const id = idMatch?.[1] ?? '';

    if (!id || !text) return { link, text, id, score: 9999, reason: 'no id/text' };
    if (isBadAccountName(text)) return { link, text, id, score: 9999, reason: 'bad text' };

    let score = 0;
    const reasons: string[] = [];

    const loc = locateAnchor(link);
    if (loc === 'highlights') { score -= 50; reasons.push('highlights'); }
    else if (loc === 'related-list') { score += 100; reasons.push('related-list'); }
    else reasons.push('other-location');

    if (/\/Account\/[a-zA-Z0-9]+\/view\s*$/.test(link.href)) { score -= 10; reasons.push('clean-view'); }
    else if (/\/Account\/[a-zA-Z0-9]+\/view\?/.test(link.href)) { score += 30; reasons.push('view-with-query'); }
    else if (/\/Account\/[a-zA-Z0-9]+\/related\//.test(link.href)) { score += 100; reasons.push('related-path'); }
    else reasons.push('other-href');

    return { link, text, id, score, reason: reasons.join(',') };
  });

  scored.sort((a, b) => a.score - b.score);

  // Diagnostic logging so the user can paste back what the scraper sees if
  // it picks the wrong link.
  if (scored.length > 0) {
    console.log(
      '[discord-sf-logger] account candidates:',
      scored.slice(0, 6).map(c => ({
        text: c.text,
        href: c.link.href,
        score: c.score,
        reason: c.reason
      }))
    );
  }

  const best = scored[0];
  if (!best || best.score >= 100) return null;
  return { name: best.text, id: best.id };
}

// Scrape the "Discord" custom field value from a Contact detail page. Looks
// for a layout item whose label is exactly "Discord" and reads the rendered
// value (lightning-formatted-text or similar).
function readContactDiscordUsername(): string | null {
  const items = findAllInShadow<HTMLElement>(
    'records-record-layout-item, .slds-form-element, force-record-layout-row > *'
  );
  for (const item of items) {
    const labelEl = item.querySelector('.slds-form-element__label, .test-id__field-label, label');
    const label = labelEl?.textContent?.trim().toLowerCase();
    if (label !== 'discord') continue;

    const valueEl = item.querySelector(
      'lightning-formatted-text, ' +
      '.slds-form-element__static, ' +
      '.test-id__field-value, ' +
      'records-output-field'
    );
    const value = valueEl?.textContent?.trim();
    if (value && value.length > 0 && value !== '-' && value !== '—') {
      return value.replace(/^@/, ''); // store without leading @
    }
  }
  return null;
}

function findAllInShadow<T extends Element = HTMLElement>(selector: string): T[] {
  const results: T[] = [];
  const visited = new WeakSet<Element | Document | ShadowRoot>();
  const walk = (root: Document | ShadowRoot) => {
    if (visited.has(root)) return;
    visited.add(root);
    for (const el of Array.from(root.querySelectorAll<T>(selector))) results.push(el);
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const sr = (el as Element).shadowRoot;
      if (sr) walk(sr);
    }
  };
  walk(document);
  return results;
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
  const all = findAllInShadow<HTMLTextAreaElement>('textarea');
  if (all.length === 0) return null;
  if (all.length === 1) return all[0];

  for (const ta of all) {
    const container = ta.closest('lightning-textarea, [data-target-selection-name*="Description"], .slds-form-element');
    const label = container?.textContent?.toLowerCase() ?? '';
    if (label.includes('comment') || label.includes('description')) return ta;
  }

  all.sort((a, b) => (b.rows ?? 0) - (a.rows ?? 0));
  return all[0];
}

function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
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

export const __testing__ = { parseLightningUrl, parseSFTitle, isBadAccountName };
