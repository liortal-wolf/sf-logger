import { popupHTML } from './popup-template';
import { popupCSS } from './popup-styles';
import type { IdentifyStrategy } from '../types';

export interface PopupInput {
  strategy: IdentifyStrategy;
  initialSubject: string;
  initialDescription: string;
  contactChoices: Array<{ id: string; name: string; discordUsername?: string }>;
}

export interface PopupResult {
  oppId: string;
  oppName: string;
  accountName: string;
  whoId: string;
  subject: string;
  description: string;
}

const URL_WARN_THRESHOLD = 1200;

export function showPopup(input: PopupInput): Promise<PopupResult | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = 'dsfl-popup-host';
    const shadow = host.attachShadow({ mode: 'closed' });
    document.body.appendChild(host);

    const style = document.createElement('style');
    style.textContent = popupCSS;
    shadow.appendChild(style);

    const initial = initialTarget(input.strategy);
    const strategyLabel = strategyDescriptor(input.strategy);
    const showPicker = input.strategy.kind === 'picker';
    const showManual = input.strategy.kind === 'manual';
    const pickerChoices = input.strategy.kind === 'picker'
      ? input.strategy.choices.map(c => ({ id: c.id, name: c.name, accountName: c.account?.name }))
      : [];

    const container = document.createElement('div');
    container.innerHTML = popupHTML({
      opportunityName: initial.oppName,
      accountName: initial.accountName,
      strategyLabel,
      subject: input.initialSubject,
      description: input.initialDescription,
      pickerChoices,
      showPicker,
      showManual,
      contactChoices: input.contactChoices
    });
    shadow.appendChild(container);

    let chosenOppId = initial.oppId;
    let chosenOppName = initial.oppName;
    let chosenAccountName = initial.accountName;
    let chosenContactId = '';

    // Block Discord's window/document keyboard listeners from stealing
    // keystrokes that originate in the popup. We attach at the window in the
    // capture phase so we run before any Discord listener, then check
    // composedPath to see if the event came from our shadow host. If it did,
    // we stopImmediatePropagation — Discord never sees it. The event still
    // reaches its target (our input), and the default action (typing) runs.
    const keyHandler = (e: Event) => {
      const path = (e as Event & { composedPath?: () => EventTarget[] }).composedPath?.() ?? [];
      if (path.includes(host)) {
        e.stopImmediatePropagation();
      }
    };
    const KEY_EVENTS: (keyof WindowEventMap)[] = ['keydown', 'keyup', 'keypress'];
    for (const evt of KEY_EVENTS) {
      window.addEventListener(evt, keyHandler, true);
    }

    const updateLengthHint = () => {
      const desc = (shadow.querySelector('.dsfl-popup__description') as HTMLTextAreaElement | null)?.value ?? '';
      const subj = (shadow.querySelector('.dsfl-popup__subject') as HTMLInputElement | null)?.value ?? '';
      const approxLen = desc.length * 2 + subj.length * 2 + 200;
      const hint = shadow.querySelector('#dsfl-length-hint') as HTMLElement | null;
      if (!hint) return;
      if (approxLen > URL_WARN_THRESHOLD) {
        hint.textContent = `${desc.length} chars — description will auto-fill via DOM after SF opens (URL would truncate).`;
        hint.className = 'dsfl-popup__hint dsfl-popup__hint--warn';
      } else {
        hint.textContent = `${desc.length} characters`;
        hint.className = 'dsfl-popup__hint';
      }
    };
    updateLengthHint();

    const close = (result: PopupResult | null) => {
      for (const evt of KEY_EVENTS) {
        window.removeEventListener(evt, keyHandler, true);
      }
      host.remove();
      resolve(result);
    };

    shadow.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const action = t.getAttribute('data-action');
      if (!action) return;
      if (action === 'close' || action === 'cancel') close(null);
      if (action === 'send') {
        if (!chosenOppId) {
          alert('Please pick a Salesforce target first.');
          return;
        }
        const subject = (shadow.querySelector('.dsfl-popup__subject') as HTMLInputElement).value;
        const description = (shadow.querySelector('.dsfl-popup__description') as HTMLTextAreaElement).value;
        close({
          oppId: chosenOppId,
          oppName: chosenOppName,
          accountName: chosenAccountName,
          whoId: chosenContactId,
          subject,
          description
        });
      }
    });

    shadow.addEventListener('change', (e) => {
      const t = e.target as HTMLElement;
      const action = t.getAttribute('data-action');
      if (action === 'pick-target') {
        const opt = (t as HTMLSelectElement).selectedOptions[0];
        if (opt) {
          chosenOppId = opt.value;
          chosenOppName = opt.getAttribute('data-name') ?? opt.textContent ?? '';
          chosenAccountName = opt.getAttribute('data-account') ?? '';
          const oppEl = shadow.querySelector('#dsfl-opp-name') as HTMLElement | null;
          if (oppEl) oppEl.textContent = chosenOppName || '(none)';
          const accEl = shadow.querySelector('#dsfl-acc-name') as HTMLElement | null;
          if (accEl) accEl.textContent = chosenAccountName || '(not detected)';
        }
      } else if (action === 'pick-contact') {
        const opt = (t as HTMLSelectElement).selectedOptions[0];
        chosenContactId = opt?.value ?? '';
        const manualEl = shadow.querySelector('.dsfl-popup__contact-id') as HTMLInputElement | null;
        if (manualEl && chosenContactId) manualEl.value = '';
      }
    });

    shadow.addEventListener('input', (e) => {
      const t = e.target as HTMLElement;
      const action = t.getAttribute('data-action');
      if (action === 'manual-id') {
        chosenOppId = (t as HTMLInputElement).value.trim();
        chosenOppName = chosenOppId;
        chosenAccountName = '';
        const oppEl = shadow.querySelector('#dsfl-opp-name') as HTMLElement | null;
        if (oppEl) oppEl.textContent = chosenOppName || '(none)';
        const accEl = shadow.querySelector('#dsfl-acc-name') as HTMLElement | null;
        if (accEl) accEl.textContent = '(not detected)';
      } else if (action === 'contact-id') {
        chosenContactId = (t as HTMLInputElement).value.trim();
      } else if (action === 'edit-description' || action === 'edit-subject') {
        updateLengthHint();
      }
    });
  });
}

function initialTarget(s: IdentifyStrategy): { oppId: string; oppName: string; accountName: string } {
  if (s.kind === 'open-sf-tab' || s.kind === 'learned-mapping') {
    return {
      oppId: s.record.id,
      oppName: s.record.name,
      accountName: s.record.account?.name ?? ''
    };
  }
  return { oppId: '', oppName: '', accountName: '' };
}

function strategyDescriptor(s: IdentifyStrategy): string {
  switch (s.kind) {
    case 'open-sf-tab': return 'detected from open SF tab';
    case 'learned-mapping': return 'remembered from last log';
    case 'picker': return 'pick from recent records';
    case 'manual': return 'paste manually';
  }
}
