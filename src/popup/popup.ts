import { popupHTML } from './popup-template';
import { popupCSS } from './popup-styles';
import type { IdentifyStrategy } from '../types';

export interface PopupInput {
  strategy: IdentifyStrategy;
  initialSubject: string;
  initialDescription: string;
}

export interface PopupResult {
  oppId: string;
  oppName: string;
  subject: string;
  description: string;
}

export function showPopup(input: PopupInput): Promise<PopupResult | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.id = 'dsfl-popup-host';
    const shadow = host.attachShadow({ mode: 'closed' });
    document.body.appendChild(host);

    const style = document.createElement('style');
    style.textContent = popupCSS;
    shadow.appendChild(style);

    const targetLabel = strategyTargetLabel(input.strategy);
    const targetSubLabel = strategyTargetSubLabel(input.strategy);
    const strategyLabel = strategyDescriptor(input.strategy);
    const showPicker = input.strategy.kind === 'picker';
    const showManual = input.strategy.kind === 'manual';
    const pickerChoices = input.strategy.kind === 'picker'
      ? input.strategy.choices.map(c => ({ id: c.id, name: c.name, accountName: c.accountName }))
      : [];

    const container = document.createElement('div');
    container.innerHTML = popupHTML({
      targetLabel,
      targetSubLabel,
      strategyLabel,
      subject: input.initialSubject,
      description: input.initialDescription,
      pickerChoices,
      showPicker,
      showManual
    });
    shadow.appendChild(container);

    let chosenOppId = input.strategy.kind === 'open-sf-tab' || input.strategy.kind === 'learned-mapping'
      ? input.strategy.record.id : '';
    let chosenOppName = input.strategy.kind === 'open-sf-tab' || input.strategy.kind === 'learned-mapping'
      ? input.strategy.record.name : '';

    const close = (result: PopupResult | null) => {
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
        close({ oppId: chosenOppId, oppName: chosenOppName, subject, description });
      }
    });

    shadow.addEventListener('change', (e) => {
      const t = e.target as HTMLElement;
      if (t.getAttribute('data-action') === 'pick-target') {
        const opt = (t as HTMLSelectElement).selectedOptions[0];
        if (opt) {
          chosenOppId = opt.value;
          chosenOppName = opt.getAttribute('data-name') ?? opt.textContent ?? '';
          const accountName = opt.getAttribute('data-account') ?? '';
          const label = shadow.querySelector('#dsfl-target-label') as HTMLElement | null;
          if (label) label.textContent = chosenOppName;
          const sub = shadow.querySelector('#dsfl-target-sublabel') as HTMLElement | null;
          if (sub) {
            if (accountName) {
              sub.textContent = `Account: ${accountName}`;
              sub.style.display = '';
            } else {
              sub.textContent = '';
              sub.style.display = 'none';
            }
          }
        }
      }
    });

    shadow.addEventListener('input', (e) => {
      const t = e.target as HTMLElement;
      if (t.getAttribute('data-action') === 'manual-id') {
        chosenOppId = (t as HTMLInputElement).value.trim();
        chosenOppName = chosenOppId;
        const label = shadow.querySelector('#dsfl-target-label') as HTMLElement | null;
        if (label) label.textContent = chosenOppName;
      }
    });
  });
}

function strategyTargetLabel(s: IdentifyStrategy): string {
  if (s.kind === 'open-sf-tab' || s.kind === 'learned-mapping') return s.record.name;
  if (s.kind === 'picker') return '(pick below)';
  return '(paste ID below)';
}

function strategyTargetSubLabel(s: IdentifyStrategy): string {
  if ((s.kind === 'open-sf-tab' || s.kind === 'learned-mapping') && s.record.accountName) {
    return `Account: ${s.record.accountName}`;
  }
  return '';
}

function strategyDescriptor(s: IdentifyStrategy): string {
  switch (s.kind) {
    case 'open-sf-tab': return 'detected from open SF tab';
    case 'learned-mapping': return 'remembered from last log';
    case 'picker': return 'pick from recent records';
    case 'manual': return 'paste manually';
  }
}
