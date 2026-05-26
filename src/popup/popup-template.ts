export const popupHTML = (data: {
  opportunityName: string;
  accountName: string;
  strategyLabel: string;
  subject: string;
  description: string;
  pickerChoices: Array<{ id: string; name: string; accountName?: string }>;
  showPicker: boolean;
  showManual: boolean;
  contactChoices: Array<{ id: string; name: string }>;
}) => `
<div class="dsfl-popup">
  <header class="dsfl-popup__header">
    <h2>Log to Salesforce</h2>
    <button class="dsfl-popup__close" data-action="close" aria-label="Close">×</button>
  </header>

  <div class="dsfl-popup__body">
    <div class="dsfl-popup__field">
      <label class="dsfl-popup__strategy-label">Source <span class="dsfl-popup__strategy">(${escapeHTML(data.strategyLabel)})</span></label>
      <div class="dsfl-popup__target-grid">
        <div class="dsfl-popup__target-row">
          <span class="dsfl-popup__target-key">Opportunity</span>
          <span class="dsfl-popup__target-val" id="dsfl-opp-name">${escapeHTML(data.opportunityName || '(none)')}</span>
        </div>
        <div class="dsfl-popup__target-row">
          <span class="dsfl-popup__target-key">Account</span>
          <span class="dsfl-popup__target-val" id="dsfl-acc-name">${escapeHTML(data.accountName || '(not detected)')}</span>
        </div>
      </div>
      ${data.showPicker ? `
        <select class="dsfl-popup__picker" data-action="pick-target">
          <option value="">Pick an Opportunity…</option>
          ${data.pickerChoices.map(c => {
            const label = c.accountName ? `${c.name} — ${c.accountName}` : c.name;
            return `<option value="${escapeHTML(c.id)}" data-name="${escapeHTML(c.name)}" data-account="${escapeHTML(c.accountName ?? '')}">${escapeHTML(label)}</option>`;
          }).join('')}
        </select>
      ` : ''}
      ${data.showManual ? `
        <input class="dsfl-popup__manual-id" data-action="manual-id" placeholder="Paste Opportunity ID (e.g. 006Hu000ABC)" />
      ` : ''}
    </div>

    <div class="dsfl-popup__field">
      <label>Contact (optional, links activity to a Person)</label>
      ${data.contactChoices.length > 0 ? `
        <select class="dsfl-popup__contact-picker" data-action="pick-contact">
          <option value="">No contact</option>
          ${data.contactChoices.map(c =>
            `<option value="${escapeHTML(c.id)}" data-name="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`
          ).join('')}
        </select>
      ` : ''}
      <input class="dsfl-popup__contact-id" data-action="contact-id" placeholder="Or paste Contact ID (e.g. 003Hu000XYZ)" />
    </div>

    <div class="dsfl-popup__field">
      <label>Subject</label>
      <input class="dsfl-popup__subject" data-action="edit-subject" value="${escapeHTML(data.subject)}" />
    </div>

    <div class="dsfl-popup__field">
      <label>Description (TL;DR + full transcript)</label>
      <textarea class="dsfl-popup__description" data-action="edit-description" rows="8">${escapeHTML(data.description)}</textarea>
      <div class="dsfl-popup__hint" id="dsfl-length-hint"></div>
    </div>
  </div>

  <footer class="dsfl-popup__footer">
    <button data-action="cancel">Cancel</button>
    <button data-action="send" class="dsfl-popup__send">Send to Salesforce</button>
  </footer>
</div>
`;

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
