import { recordVisit, listRecent } from '../storage/recent-sf';

const POLL_INTERVAL_MS = 2000;
const PENDING_FILL_KEY = 'pending_task_fill';
const PENDING_FILL_TTL_MS = 90 * 1000; // 90s window after Discord triggers the open

interface PendingTaskFill {
  description: string;
  expiresAt: number;
}

export function startSalesforceWatcher(): void {
  const tick = () => {
    const page = parseLightningUrl(window.location.href);

    // Two independent jobs on every tick:
    //  1) On record pages: capture/upgrade storage and show a toast
    //  2) On /Task/new pages: complete any pending auto-fill of Comments
    if (page) {
      updateStoredRecord(page);
    }
    tryFillPendingTask();
  };

  window.addEventListener('popstate', tick);
  window.addEventListener('hashchange', tick);
  window.addEventListener('focus', tick);
  setInterval(tick, POLL_INTERVAL_MS);
  tick();
}

function updateStoredRecord(page: { id: string; type: 'Opportunity' | 'Account' | 'Contact' }): void {
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

  recordVisit({
    id: page.id,
    name: name ?? existing?.name ?? page.id,
    type: page.type,
    accountName: account?.name ?? existing?.accountName,
    accountId: account?.id ?? existing?.accountId
  });

  // Toast feedback when we successfully captured new info
  const upgradedName = name && !hasGoodName;
  const upgradedAccount = account && !existing?.accountName;
  if (upgradedName || upgradedAccount || !existing) {
    const parts: string[] = [];
    if (name) parts.push(name);
    if (account?.name) parts.push(`+ ${account.name}`);
    const message =
      parts.length > 0
        ? `Cached ${page.type}: ${parts.join(' ')}`
        : `Cached ${page.type}: ${page.id}`;
    showToast(message, 'success');
    console.log(`[discord-sf-logger] ${message}`);
  } else if (page.type === 'Opportunity' && !account) {
    console.log(`[discord-sf-logger] no linked Account found yet for Opp ${page.id} — will keep trying`);
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

// Some link patterns to REJECT when scraping the Account from an Opportunity page:
// - related-list shortcuts have text like "Account Team(0)", "Contact Roles(3)"
// - they end with a digit-in-parens suffix
const RELATED_LIST_TEXT_RE = /\(\s*\d+\s*\)\s*$/;

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

  // Prefer canonical /view URLs (page-header Account link) over /related/* shortcuts
  const sorted = [...candidates].sort((a, b) => {
    const aView = /\/view(?:\?|$)/.test(a.href) ? 0 : 1;
    const bView = /\/view(?:\?|$)/.test(b.href) ? 0 : 1;
    return aView - bView;
  });

  for (const link of sorted) {
    const idMatch = link.href.match(/\/Account\/([a-zA-Z0-9]{11,18})/);
    const id = idMatch?.[1];
    const name = link.textContent?.trim();

    if (!id || !name || name.length === 0) continue;
    if (looksLikeSFId(name)) continue;
    if (RELATED_LIST_TEXT_RE.test(name)) continue; // skip "Account Team(0)" etc.

    return { name, id };
  }
  return null;
}

// ---------- Auto-fill Task/new Comments (replaces clipboard fallback) ----------

function tryFillPendingTask(): void {
  if (!/\/lightning\/o\/Task\/new/.test(window.location.href)) return;

  const pending = GM_getValue<PendingTaskFill | null>(PENDING_FILL_KEY, null);
  if (!pending) return;
  if (Date.now() > pending.expiresAt) {
    GM_deleteValue(PENDING_FILL_KEY);
    return;
  }

  const textarea = findCommentsTextarea();
  if (!textarea) return; // form not rendered yet; try again next tick

  // Already filled correctly?
  if (textarea.value === pending.description) {
    GM_deleteValue(PENDING_FILL_KEY);
    return;
  }

  setNativeValue(textarea, pending.description);
  console.log('[discord-sf-logger] auto-filled Comments textarea via DOM');
  showToast('Description auto-filled', 'success');
  GM_deleteValue(PENDING_FILL_KEY);
}

// Walk shadow roots looking for the Task Comments textarea. Lightning renders
// long-text fields as <lightning-textarea> wrapping a native <textarea> inside
// its (open) shadow root.
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

  // Multiple textareas — find the one associated with a "Comments" label.
  for (const ta of all) {
    const container = ta.closest('lightning-textarea, [data-target-selection-name*="Description"], .slds-form-element');
    const label = container?.textContent?.toLowerCase() ?? '';
    if (label.includes('comment') || label.includes('description')) {
      return ta;
    }
  }

  // Fallback: pick the largest textarea (Comments is usually the biggest)
  all.sort((a, b) => (b.rows ?? 0) - (a.rows ?? 0));
  return all[0];
}

// Bypass React/LWC controlled-input behavior by calling the prototype's native
// setter directly, then dispatching the events the framework listens for.
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

// ---------- Toast notifications ----------

let toastContainer: HTMLDivElement | null = null;

function showToast(message: string, kind: 'success' | 'info' = 'info'): void {
  ensureToastContainer();
  if (!toastContainer) return;

  const toast = document.createElement('div');
  toast.textContent = `✓ ${message}`;
  Object.assign(toast.style, {
    background: kind === 'success' ? '#04844b' : '#16325c',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '500',
    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    opacity: '0',
    transition: 'opacity 200ms ease, transform 200ms ease',
    transform: 'translateY(8px)',
    maxWidth: '320px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  });

  toastContainer.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function ensureToastContainer(): void {
  if (toastContainer && document.body.contains(toastContainer)) return;
  toastContainer = document.createElement('div');
  toastContainer.id = 'dsfl-toast-container';
  Object.assign(toastContainer.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: '2147483646',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    pointerEvents: 'none'
  });
  document.body.appendChild(toastContainer);
}

export const __testing__ = { parseLightningUrl, parseSFTitle };
