import {
  recordVisit, listRecent,
  recordContactVisit, listRecentContacts,
  type OpportunityVisitInput, type ContactVisitInput
} from '../storage/recent-sf';
import { fetchContact, fetchContactRelatedOpps } from './ui-api';

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

// Stop retrying after ~3 minutes of empty polls on a single record. Cheap
// enough to keep trying for a while because the user may switch to the
// "Related" tab on a Contact / Opp page after the initial mount and we want
// that switch to trigger a fresh scrape, but unbounded retries would keep
// spinning indefinitely on records that genuinely have zero related items.
const MAX_EMPTY_SCRAPE_POLLS = 100;
const scrapedRecordIds = new Set<string>();
const emptyScrapeCounts = new Map<string, number>();

function shouldRetryScrape(recordId: string): boolean {
  if (scrapedRecordIds.has(recordId)) return false;
  const n = emptyScrapeCounts.get(recordId) ?? 0;
  return n < MAX_EMPTY_SCRAPE_POLLS;
}

function markScrapeSuccess(recordId: string): void {
  scrapedRecordIds.add(recordId);
  emptyScrapeCounts.delete(recordId);
}

function markScrapeEmpty(recordId: string): void {
  const n = (emptyScrapeCounts.get(recordId) ?? 0) + 1;
  emptyScrapeCounts.set(recordId, n);
  if (n >= MAX_EMPTY_SCRAPE_POLLS) scrapedRecordIds.add(recordId);
}

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

  let contactsToWrite: OpportunityVisitInput['contacts'] | undefined;
  if (shouldRetryScrape(`opp-contacts:${id}`)) {
    const contacts = readOppContactRoles();
    if (contacts.length > 0) {
      const now = new Date().toISOString();
      contactsToWrite = contacts.map(c => ({ ...c, lastSeenAt: now }));
      markScrapeSuccess(`opp-contacts:${id}`);
      console.log(`[discord-sf-logger] cached ${contacts.length} Contact Roles for Opp ${id}`);
    } else {
      const emptyCount = (emptyScrapeCounts.get(`opp-contacts:${id}`) ?? 0) + 1;
      if (emptyCount === 1 || emptyCount === 5) {
        console.log(
          `[discord-sf-logger] no Contact Roles found yet for Opp ${id} ` +
          `(poll ${emptyCount}). ` +
          `If this Opp has Contact Roles, click the Opp's "Related" tab so they render.`
        );
      }
      markScrapeEmpty(`opp-contacts:${id}`);
    }
  }

  const existing = listRecent().find(r => r.id === id);
  const hasGoodName = existing && existing.name !== existing.id;
  const cachedAccountIsBad = existing?.account?.name ? isBadAccountName(existing.account.name) : false;

  const shouldUpdate =
    !existing ||
    (name && !hasGoodName) ||
    (account && (!existing.account || cachedAccountIsBad)) ||
    cachedAccountIsBad ||
    !!contactsToWrite;

  if (!shouldUpdate) {
    recordVisit({
      id,
      name: existing!.name,
      account: existing!.account,
      contacts: existing!.contacts
    });
    return;
  }

  const finalAccount = account ?? (cachedAccountIsBad ? undefined : existing?.account);

  recordVisit({
    id,
    name: name ?? existing?.name ?? id,
    account: finalAccount,
    contacts: contactsToWrite ?? existing?.contacts
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
  // Strategy 1: find an actual <a> element pointing at /Account/<id> and score it
  const candidates = findAllAccountLinks();

  const scored = candidates.map(link => {
    // SF Lightning renders the visible Account name inside a closed shadow root
    // (lightning-formatted-text / records-hoverable-link), so a.textContent is "".
    // a.innerText returns the computed visible text across shadow boundaries.
    const text = readVisibleText(link);
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

  console.log(
    `[discord-sf-logger] account candidates: ${scored.length} found`,
    scored.slice(0, 6).map(c => ({
      text: c.text,
      href: c.link.href,
      score: c.score,
      reason: c.reason
    }))
  );

  const best = scored[0];
  if (best && best.score < 100) {
    return { name: best.text, id: best.id };
  }

  // Strategy 2: fallback — look for the "Account Name" labeled field
  // anywhere on the page (including in shadow DOM) and read its visible value.
  // SF sometimes renders the lookup name inside a closed shadow root we can't
  // pierce; the label-and-value pair is often projected to light DOM via slots.
  const fromLabel = readAccountFromLabeledField();
  if (fromLabel) {
    console.log('[discord-sf-logger] account captured via label fallback:', fromLabel);
    return fromLabel;
  }

  return null;
}

// Walk shadow DOM looking for a form-element / layout-item whose label
// contains "Account Name", then extract any /Account/<id> URL from descendant
// hrefs OR the visible name text from the value cell. Either piece alone is
// useful — a name without an id can still go in the popup.
function readAccountFromLabeledField(): { name: string; id: string } | null {
  const items = findAllInShadow<HTMLElement>(
    'records-record-layout-item, ' +
    'records-highlights-details-item, ' +
    'force-record-layout-item, ' +
    '.slds-form-element'
  );

  for (const item of items) {
    const labelText = readLabelInside(item);
    if (!labelText) continue;
    const labelLower = labelText.toLowerCase();
    if (labelLower !== 'account name' && labelLower !== 'account') continue;

    let id = '';
    const innerAnchor = queryDeep<HTMLAnchorElement>(item, 'a[href*="/Account/"]');
    if (innerAnchor) {
      const m = innerAnchor.href.match(/\/Account\/([a-zA-Z0-9]{11,18})/);
      if (m) id = m[1];
    }

    const text = readValueInside(item, labelText);
    if (text && !isBadAccountName(text)) {
      if (id) return { name: text, id };
      console.log('[discord-sf-logger] account name found but no id; storing name only', text);
      return { name: text, id: '' };
    }
  }
  return null;
}

// Scrape the "Discord" custom field value from a Contact detail page.
//
// Two strategies — structural and then visible-text fallback. SF renders the
// label inside each `records-record-layout-item`'s own shadow root, so a plain
// `item.querySelector(...)` returns null; we must descend into `item.shadowRoot`
// (via queryDeep) to find the label/value pair. As a safety net for orgs where
// closed shadow DOM blocks us entirely, we also scan `document.body.innerText`
// for a "Discord\n<value>" pattern — `innerText` sees rendered text regardless
// of shadow mode.
function readContactDiscordUsername(): string | null {
  const items = findAllInShadow<HTMLElement>(
    'records-record-layout-item, records-highlights-details-item, force-record-layout-item, .slds-form-element'
  );
  for (const item of items) {
    const labelText = readLabelInside(item);
    if (!labelText || !/^discord\b/i.test(labelText)) continue;

    const value = readValueInside(item, labelText);
    if (value && value !== '-' && value !== '—') {
      return value.replace(/^@/, '');
    }
  }

  return readDiscordFromVisibleText();
}

// Walk light DOM under `el` AND every nested shadow root inside it. Returns
// the first match for `selector`. SF Lightning nests deeply — Discord field
// value lives inside `records-record-layout-item > records-output-field >
// (shadow) > lightning-formatted-text > (shadow) > text`. A single-level
// shadow descent (the old implementation) reached `records-output-field` but
// not `lightning-formatted-text`. This recursive version traverses the full
// open-shadow subtree.
function queryDeep<T extends Element = Element>(el: Element, selector: string): T | null {
  const visited = new WeakSet<Element | ShadowRoot>();
  let found: T | null = null;
  const walk = (root: Element | ShadowRoot): void => {
    if (found || visited.has(root)) return;
    visited.add(root);
    const hit = root.querySelector<T>(selector);
    if (hit) { found = hit; return; }
    for (const child of Array.from(root.querySelectorAll('*'))) {
      if (found) return;
      const sr = (child as Element).shadowRoot;
      if (sr) walk(sr);
    }
  };
  walk(el);
  return found;
}

function readLabelInside(item: HTMLElement): string | null {
  const sel = '.slds-form-element__label, .test-id__field-label, label, .field-label';
  const el = queryDeep<HTMLElement>(item, sel);
  if (!el) return null;
  const text = readVisibleText(el);
  return text || null;
}

function readValueInside(item: HTMLElement, labelText: string): string | null {
  const sel =
    'a[href*="/Account/"], ' +
    'lightning-formatted-text, ' +
    'lightning-formatted-name, ' +
    'lightning-formatted-rich-text, ' +
    'records-formula-output, ' +
    'records-output-field, ' +
    '.slds-form-element__static, ' +
    '.test-id__field-value';
  const el = queryDeep<HTMLElement>(item, sel);
  if (el) {
    const t = readVisibleText(el);
    if (t && t !== '-' && t !== '—' && t.toLowerCase() !== labelText.toLowerCase() && !looksLikeButtonOrLabel(t, labelText)) {
      return t;
    }
  }
  // Last resort: subtract the label from the item's overall visible text.
  const itemText = readVisibleText(item);
  if (itemText) {
    const remainder = itemText.startsWith(labelText)
      ? itemText.slice(labelText.length).trim()
      : itemText;
    if (
      remainder &&
      remainder !== '-' &&
      remainder !== '—' &&
      remainder.length < 200 &&
      !looksLikeButtonOrLabel(remainder, labelText)
    ) {
      return remainder;
    }
  }
  return null;
}

// SF Lightning renders an "Edit <FieldLabel>" pencil button inside many
// layout-items for inline editing. If queryDeep can't reach the actual value
// element (deeply nested closed shadow root) we can end up reading that
// button's text instead. Same defensive list as the body.innerText regex
// fallback uses, plus an `Edit <labelText>` shape that catches any field.
function looksLikeButtonOrLabel(value: string, labelText: string): boolean {
  if (/^(Edit|View|Add|New|Delete|Clone|Share|Help)\b/i.test(value)) return true;
  if (new RegExp(`^Edit\\s+${escapeForRegex(labelText)}\\b`, 'i').test(value)) return true;
  return false;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Cross-shadow visible-text reader. innerText computes rendered text across
// open shadow roots; falls back to textContent for elements that don't expose
// innerText (e.g. nodes outside the rendered tree in jsdom test environments).
function readVisibleText(el: Element): string {
  const innerText = (el as HTMLElement).innerText;
  const t = (innerText ?? el.textContent ?? '').trim();
  return t;
}

function readDiscordFromVisibleText(): string | null {
  // SF Lightning renders a Contact's detail fields as `Label\nValue\nLabel\nValue…`
  // in body.innerText. Require the literal token "Discord" on its own line so we
  // don't grab "Edit Discord" (inline-edit button) or "Lior Discord Tool" (a
  // company name embedded in a different field).
  const text = document.body?.innerText ?? '';
  const match = text.match(/(?:^|\n)\s*Discord\s*\n+\s*([^\n]+?)\s*(?:\n|$)/);
  if (!match) return null;
  const value = match[1].trim();
  if (!value || value === '-' || value === '—' || value.length > 80) return null;
  // Defensive: bail if the captured value looks like another field's label.
  if (/^(Edit|Title|Phone|Email|Account|Owner|Department|Mailing|Other|Reports To|Birthdate)\b/i.test(value)) {
    return null;
  }
  return value.replace(/^@/, '');
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

// Pure parser, separated for unit testing — given any DOM root, find every
// /Opportunity/<id> anchor and return its id + visible name (and, if siblings
// expose Account / Stage cells, those too). Deduplicates by id.
function parseContactRelatedOppsFromDom(root: ParentNode): Array<{
  id: string;
  name: string;
  accountName?: string;
  stage?: string;
}> {
  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/Opportunity/"]'));
  const seen = new Map<string, { id: string; name: string; accountName?: string; stage?: string }>();
  for (const a of anchors) {
    // Use getAttribute to get the raw href (avoids browser absolute-URL
    // resolution which can interfere with ID extraction in test environments).
    const rawHref = a.getAttribute('href') ?? a.href;
    const m = rawHref.match(/\/Opportunity\/([a-zA-Z0-9]{11,18})/);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    const name = readVisibleText(a);
    if (!name) continue;
    seen.set(id, { id, name });
  }
  return Array.from(seen.values());
}

// Live-page scraper used by the watcher. Walks shadow DOM (open shadow roots
// only) to find the Opportunities related-list anchors, then delegates to the
// pure parser for the actual extraction.
function readContactRelatedOpps(): Array<{ id: string; name: string; accountName?: string; stage?: string }> {
  const containers = findAllInShadow<HTMLElement>(
    'force-related-list-single-container, lst-related-list-single-container, records-related-list-single-container, .forceRelatedList'
  );
  const fakeRoot = document.createElement('div');
  for (const c of containers) fakeRoot.appendChild(c.cloneNode(true));
  if (fakeRoot.children.length === 0) {
    // Fallback: no specific container found — scan the whole document for
    // Opportunity anchors (cheap; we already do shadow-piercing for accounts).
    const allOppAnchors = findAllInShadow<HTMLAnchorElement>('a[href*="/Opportunity/"]');
    for (const a of allOppAnchors) fakeRoot.appendChild(a.cloneNode(true));
  }
  return parseContactRelatedOppsFromDom(fakeRoot);
}

function parseOppContactRolesFromDom(root: ParentNode): Array<{ id: string; name: string }> {
  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/Contact/"]'));
  const seen = new Map<string, { id: string; name: string }>();
  for (const a of anchors) {
    const href = a.getAttribute('href') ?? '';
    const m = href.match(/\/Contact\/([a-zA-Z0-9]{11,18})/);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    const name = readVisibleText(a);
    if (!name) continue;
    seen.set(id, { id, name });
  }
  return Array.from(seen.values());
}

function readOppContactRoles(): Array<{ id: string; name: string }> {
  const containers = findAllInShadow<HTMLElement>(
    'force-related-list-single-container, lst-related-list-single-container, records-related-list-single-container, .forceRelatedList'
  );
  const fakeRoot = document.createElement('div');
  for (const c of containers) fakeRoot.appendChild(c.cloneNode(true));
  if (fakeRoot.children.length === 0) {
    const allContactAnchors = findAllInShadow<HTMLAnchorElement>('a[href*="/Contact/"]');
    for (const a of allContactAnchors) fakeRoot.appendChild(a.cloneNode(true));
  }
  return parseOppContactRolesFromDom(fakeRoot);
}

export const __testing__ = { parseLightningUrl, parseSFTitle, isBadAccountName, readDiscordFromVisibleText, parseContactRelatedOppsFromDom, parseOppContactRolesFromDom };
