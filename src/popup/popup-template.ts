export const popupHTML = (data: {
  targetLabel: string;
  strategyLabel: string;
  subject: string;
  description: string;
  pickerChoices: Array<{ id: string; name: string }>;
  showPicker: boolean;
  showManual: boolean;
}) => `
<div class="dsfl-popup">
  <header class="dsfl-popup__header">
    <h2>Log to Salesforce</h2>
    <button class="dsfl-popup__close" data-action="close" aria-label="Close">×</button>
  </header>

  <div class="dsfl-popup__field">
    <label>Salesforce target <span class="dsfl-popup__strategy">(${escapeHTML(data.strategyLabel)})</span></label>
    <div class="dsfl-popup__target" id="dsfl-target-label">${escapeHTML(data.targetLabel)}</div>
    ${data.showPicker ? `
      <select class="dsfl-popup__picker" data-action="pick-target">
        <option value="">Pick a record…</option>
        ${data.pickerChoices.map(c =>
          `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`
        ).join('')}
      </select>
    ` : ''}
    ${data.showManual ? `
      <input class="dsfl-popup__manual-id" data-action="manual-id" placeholder="Paste Opportunity ID (e.g. 006Hu000ABC)" />
    ` : ''}
  </div>

  <div class="dsfl-popup__field">
    <label>Subject</label>
    <input class="dsfl-popup__subject" data-action="edit-subject" value="${escapeHTML(data.subject)}" />
  </div>

  <div class="dsfl-popup__field">
    <label>Description</label>
    <textarea class="dsfl-popup__description" data-action="edit-description" rows="10">${escapeHTML(data.description)}</textarea>
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
