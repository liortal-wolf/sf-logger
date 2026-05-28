import { recordVisit, recordContactVisit } from '../storage/recent-sf';
import { fetchContact, fetchContactRelatedOpps, fetchOpportunity, fetchOppContactRoles } from './ui-api';

const POLL_INTERVAL_MS = 2000;
const PENDING_FILL_KEY = 'pending_task_fill';

type ApiFetchState = 'success' | 'failed-permanently' | { failures: number };
const apiFetchState = new Map<string, ApiFetchState>();
const MAX_API_RETRIES = 3;

function shouldCallApi(key: string): boolean {
  const s = apiFetchState.get(key);
  if (s === 'success' || s === 'failed-permanently') return false;
  return true;
}

function recordApiAttemptResult(key: string, ok: boolean): void {
  if (ok) {
    apiFetchState.set(key, 'success');
    return;
  }
  const prior = apiFetchState.get(key);
  const failures = (typeof prior === 'object' ? prior.failures : 0) + 1;
  if (failures >= MAX_API_RETRIES) {
    apiFetchState.set(key, 'failed-permanently');
  } else {
    apiFetchState.set(key, { failures });
  }
}

interface PendingTaskFill {
  description: string;
  expiresAt: number;
}

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
  const key = `opp:${id}`;
  if (!shouldCallApi(key)) return;

  void (async () => {
    try {
      const [opp, contactRoles] = await Promise.all([
        fetchOpportunity(id),
        fetchOppContactRoles(id)
      ]);
      if (!opp) {
        recordApiAttemptResult(key, false);
        return;
      }
      const now = new Date().toISOString();
      recordVisit({
        id: opp.id,
        name: opp.name,
        account: opp.account,
        contacts: contactRoles.map(r => ({
          id: r.contactId,
          name: r.contactName,
          lastSeenAt: now
        }))
      });
      recordApiAttemptResult(key, true);
      const parts: string[] = [opp.name];
      if (opp.account?.name) parts.push(`(${opp.account.name})`);
      showToast(`Cached Opportunity ${parts.join(' ')}`, 'success');
    } catch {
      recordApiAttemptResult(key, false);
    }
  })();
}

function updateContact(id: string): void {
  const key = `contact:${id}`;
  if (!shouldCallApi(key)) return;

  void (async () => {
    try {
      const [contact, opps] = await Promise.all([
        fetchContact(id),
        fetchContactRelatedOpps(id)
      ]);
      if (!contact) {
        recordApiAttemptResult(key, false);
        return;
      }
      const now = new Date().toISOString();
      recordContactVisit({
        id: contact.id,
        name: contact.name,
        discordUsername: contact.discordUsername ?? undefined,
        opps: opps.map(o => ({
          id: o.id,
          name: o.name,
          stage: o.stage,
          accountName: o.account?.name,
          lastSeenAt: now
        }))
      });
      recordApiAttemptResult(key, true);
      const parts: string[] = [contact.name];
      if (contact.discordUsername) parts.push(`(@${contact.discordUsername})`);
      const tail = opps.length > 0 ? ` — ${opps.length} ${opps.length === 1 ? 'Opp' : 'Opps'}` : '';
      showToast(`Cached Contact ${parts.join(' ')}${tail}`, 'success');
    } catch {
      recordApiAttemptResult(key, false);
    }
  })();
}

function parseLightningUrl(
  url: string
): { id: string; type: 'Opportunity' | 'Account' | 'Contact' } | null {
  const match = url.match(/\/lightning\/r\/(Opportunity|Account|Contact)\/([a-zA-Z0-9]{11,18})/);
  if (!match) return null;
  return { type: match[1] as 'Opportunity' | 'Account' | 'Contact', id: match[2] };
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

export const __testing__ = { parseLightningUrl };
