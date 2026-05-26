// Pure helpers for normalizing Discord conversation text + a DOM-aware capture
// that walks message elements directly (more reliable than getSelection().toString(),
// which Discord often strips down for embeds and forwarded content).

const TYPING_RE = /\[?\s*[\w_]+ is typing\.+\s*\]?/gi;

export function extractFromSelectionText(rawText: string): string {
  return rawText
    .split('\n')
    .map(line => line.replace(TYPING_RE, '').trim())
    .filter(line => line.length > 0)
    .join('\n');
}

export function detectCounterpartyFromDocumentTitle(title: string): string {
  const match = title.match(/@([a-zA-Z0-9_.]+)\s*-\s*Discord$/);
  return match ? match[1] : '';
}

// Read message DOM elements that intersect the current selection. Falls back
// to plain selection text if no Discord message containers are detected.
export function captureDiscordTranscript(): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return '';

  const range = selection.getRangeAt(0);
  const allMessages = Array.from(
    document.querySelectorAll<HTMLElement>('[id^="chat-messages-"], [class*="messageListItem"], li[id*="message"]')
  );
  const inRange = allMessages.filter(node => {
    try {
      return range.intersectsNode(node);
    } catch {
      return false;
    }
  });

  if (inRange.length === 0) {
    return extractFromSelectionText(selection.toString());
  }

  const lines = inRange.map(formatMessageNode).filter(line => line.length > 0);
  if (lines.length === 0) {
    return extractFromSelectionText(selection.toString());
  }
  return lines.join('\n\n');
}

function formatMessageNode(node: HTMLElement): string {
  const usernameEl = node.querySelector('[id^="message-username-"], [class*="username"]');
  const contentEl = node.querySelector('[id^="message-content-"], [class*="markup"][class*="messageContent"], [class*="messageContent"]');
  const timestampEl = node.querySelector('time');

  const username = usernameEl?.textContent?.trim() ?? '';
  const content = contentEl?.textContent?.trim() ?? node.textContent?.trim() ?? '';
  const timestamp = timestampEl?.getAttribute('datetime') ?? '';

  if (!content) return '';

  const header = username ? (timestamp ? `${username} [${timestamp}]` : username) : '';
  return header ? `${header}:\n${content}` : content;
}
