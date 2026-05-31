import { describe, it, expect, afterEach } from 'vitest';
import { detectCounterparty } from '../../src/discord/selection';

const CURRENT_USER_ID = '999999999';

function mockDocumentTitle(title: string): void {
  Object.defineProperty(document, 'title', {
    configurable: true,
    get: () => title
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  mockDocumentTitle('');
});

describe('detectCounterparty', () => {
  it('returns username only when no message DOM is highlighted', () => {
    mockDocumentTitle('@kesem - Discord');
    document.body.innerHTML = '';
    const cp = detectCounterparty(CURRENT_USER_ID);
    expect(cp?.username).toBe('kesem');
    expect(cp?.userId).toBeUndefined();
  });

  it('extracts the counterparty user-ID from data-author-id on selected messages', () => {
    mockDocumentTitle('@kesem - Discord');
    document.body.innerHTML = `
      <li id="chat-messages-1" data-author-id="${CURRENT_USER_ID}">my message</li>
      <li id="chat-messages-2" data-author-id="111222333">their message</li>
      <li id="chat-messages-3" data-author-id="111222333">another from them</li>
    `;
    const cp = detectCounterparty(CURRENT_USER_ID);
    expect(cp?.username).toBe('kesem');
    expect(cp?.userId).toBe('111222333');
  });

  it('omits userId when the only data-author-id is the current user', () => {
    mockDocumentTitle('@kesem - Discord');
    document.body.innerHTML = `
      <li id="chat-messages-1" data-author-id="${CURRENT_USER_ID}">just me talking</li>
    `;
    const cp = detectCounterparty(CURRENT_USER_ID);
    expect(cp?.username).toBe('kesem');
    expect(cp?.userId).toBeUndefined();
  });

  it('omits userId when multiple non-self IDs are present (ambiguous)', () => {
    mockDocumentTitle('@kesem - Discord');
    document.body.innerHTML = `
      <li id="chat-messages-1" data-author-id="${CURRENT_USER_ID}">mine</li>
      <li id="chat-messages-2" data-author-id="111222333">A</li>
      <li id="chat-messages-3" data-author-id="444555666">B</li>
    `;
    const cp = detectCounterparty(CURRENT_USER_ID);
    expect(cp?.userId).toBeUndefined();
  });

  it('returns null when document.title does not contain a Discord handle and no DOM hooks are available', () => {
    mockDocumentTitle('Some random page title');
    document.body.innerHTML = '';
    expect(detectCounterparty(CURRENT_USER_ID)).toBeNull();
  });

  it('parses the 2026 title format with notification count and pipe separator', () => {
    mockDocumentTitle('(2) Discord | @Kesem');
    document.body.innerHTML = '';
    const cp = detectCounterparty(CURRENT_USER_ID);
    expect(cp?.username).toBe('Kesem');
  });

  it('parses the 2026 title format without a notification count', () => {
    mockDocumentTitle('Discord | @kesem');
    document.body.innerHTML = '';
    const cp = detectCounterparty(CURRENT_USER_ID);
    expect(cp?.username).toBe('kesem');
  });

  it('handles handles containing periods and hyphens', () => {
    mockDocumentTitle('(5) Discord | @kesem.overwolf-bd');
    document.body.innerHTML = '';
    const cp = detectCounterparty(CURRENT_USER_ID);
    expect(cp?.username).toBe('kesem.overwolf-bd');
  });

  it('still parses the legacy "@handle - Discord" title format', () => {
    mockDocumentTitle('@joe - Discord');
    document.body.innerHTML = '';
    const cp = detectCounterparty(CURRENT_USER_ID);
    expect(cp?.username).toBe('joe');
  });
});
