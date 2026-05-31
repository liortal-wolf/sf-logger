// Pure helpers for normalizing Discord text + DOM-aware capture of conversation
// transcripts. Two capture modes:
//
//   1. User has a selection: capture the messages that intersect the selection.
//   2. No selection: fall back to the last N visible messages in the channel.
//
// The transcript returned is intended to be used VERBATIM as the description
// content (no AI processing) so the user controls exactly what's logged.

const TYPING_RE = /\[?\s*[\w_]+ is typing\.+\s*\]?/gi;
const DEFAULT_FALLBACK_MESSAGE_COUNT = 8;

const MESSAGE_NODE_SELECTOR =
  '[id^="chat-messages-"], li[id*="message"], [class*="messageListItem"]';

export function extractFromSelectionText(rawText: string): string {
  return rawText
    .split('\n')
    .map(line => line.replace(TYPING_RE, '').trim())
    .filter(line => line.length > 0)
    .join('\n');
}

// Extracts the counterparty handle from Discord's page title. Title formats
// observed in production:
//   "(2) Discord | @Kesem"      — current 2026 format with notification count
//   "Discord | @Kesem"          — current format, no unread
//   "@kesem - Discord"          — older format (kept for backward-compat)
//   "Discord"                   — no DM open; returns empty string
// We strip any "(N) " notification prefix, then look for @<handle> anywhere
// in the title. Handles can be mixed case (display names) or all-lowercase
// (true usernames); normalizeDiscordHandle() at the matching layer downcases.
export function detectCounterpartyFromDocumentTitle(title: string): string {
  const stripped = title.replace(/^\s*\(\d+\)\s*/, '');
  const match = stripped.match(/@([a-zA-Z0-9_.\-]+)/);
  return match ? match[1] : '';
}

// Returns the counterparty's Discord identity by combining two sources:
//   - username comes from document.title (always works for DMs)
//   - userId, when extractable, is the non-self Discord user-ID from a
//     [data-author-id] attribute on a visible message. Discord has renamed
//     this attribute in past redesigns, so this is best-effort — undefined
//     means "couldn't extract", not "no such user".
//
// `currentUserId` is the Discord user-ID of the logged-in user (used to
// exclude self-messages from the userId extraction). Provided by the caller.
//
// Returns null only when BOTH username and userId are missing — i.e. the
// user is on a page that isn't a recognizable DM or channel. When this fires
// we log a diagnostic so future Discord redesigns are visible without
// needing the user to file a bug.
export function detectCounterparty(currentUserId: string | null): import('../types').DiscordCounterparty | null {
  const username = detectCounterpartyFromDocumentTitle(document.title);
  const userId = pickCounterpartyUserId(currentUserId);
  if (!username && !userId) {
    console.warn('[discord-sf-logger] could not detect counterparty', {
      title: document.title,
      url: window.location.pathname,
      authorIdElementCount: document.querySelectorAll('[data-author-id]').length
    });
    return null;
  }
  return { username, userId };
}

function pickCounterpartyUserId(currentUserId: string | null): string | undefined {
  const messages = Array.from(document.querySelectorAll<HTMLElement>('[data-author-id]'));
  const ids = new Set<string>();
  for (const m of messages) {
    const id = m.getAttribute('data-author-id');
    if (id && id !== currentUserId) ids.add(id);
  }
  if (ids.size === 1) return Array.from(ids)[0];
  return undefined;
}

export interface CapturedTranscript {
  text: string;
  source: 'selection' | 'fallback-last-messages' | 'empty';
  messageCount: number;
}

export function captureDiscordTranscript(): CapturedTranscript {
  const selection = window.getSelection();
  const selectionText = selection?.toString() ?? '';

  if (selection && selection.rangeCount > 0 && selectionText.trim().length > 0) {
    const fromSelection = captureFromSelection(selection);
    if (fromSelection.text.length > 0) return fromSelection;
  }

  // Fallback: capture last N visible messages
  return captureLastVisibleMessages(DEFAULT_FALLBACK_MESSAGE_COUNT);
}

function captureFromSelection(selection: Selection): CapturedTranscript {
  const range = selection.getRangeAt(0);
  const allMessages = Array.from(
    document.querySelectorAll<HTMLElement>(MESSAGE_NODE_SELECTOR)
  );
  const inRange = allMessages.filter(node => {
    try {
      return range.intersectsNode(node);
    } catch {
      return false;
    }
  });

  if (inRange.length > 0) {
    const lines = inRange.map(formatMessageNode).filter(l => l.length > 0);
    if (lines.length > 0) {
      return {
        text: lines.join('\n\n'),
        source: 'selection',
        messageCount: lines.length
      };
    }
  }

  // Last-resort: use the plain selection text. Less structured but at least
  // captures what the user explicitly highlighted.
  const cleaned = extractFromSelectionText(selection.toString());
  return {
    text: cleaned,
    source: 'selection',
    messageCount: 0
  };
}

function captureLastVisibleMessages(count: number): CapturedTranscript {
  const allMessages = Array.from(
    document.querySelectorAll<HTMLElement>(MESSAGE_NODE_SELECTOR)
  );
  if (allMessages.length === 0) return { text: '', source: 'empty', messageCount: 0 };

  const last = allMessages.slice(-count);
  const lines = last.map(formatMessageNode).filter(l => l.length > 0);
  return {
    text: lines.join('\n\n'),
    source: 'fallback-last-messages',
    messageCount: lines.length
  };
}

function formatMessageNode(node: HTMLElement): string {
  const usernameEl = node.querySelector(
    '[id^="message-username-"], [class*="username"]'
  );
  const contentEl = node.querySelector(
    '[id^="message-content-"], [class*="markup"][class*="messageContent"], [class*="messageContent"]'
  );
  const timestampEl = node.querySelector('time');

  const username = usernameEl?.textContent?.trim() ?? '';
  const content = contentEl?.textContent?.trim() ?? node.textContent?.trim() ?? '';
  const timestamp = timestampEl?.getAttribute('datetime') ?? '';

  if (!content) return '';

  const header = username ? (timestamp ? `${username} [${timestamp}]` : username) : '';
  return header ? `${header}:\n${content}` : content;
}
